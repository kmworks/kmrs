//! AVIF pages through `image`'s decoding hooks: `avif-parse` reads the container, `rav1d` the AV1.
//!
//! The container parser exposes neither grids nor `irot`/`imir`: grid files fail with an error and
//! rotated files decode as coded.

use crate::heif::{decoding_error, guarded};
use avif_parse::AvifData;
use image::hooks::{register_decoding_hook, register_format_detection_hook};
use image::{ColorType, ImageDecoder, ImageError, ImageResult};
use re_rav1d::dav1d::pixel::{MatrixCoefficients, YUVRange};
use re_rav1d::dav1d::{
    Decoder, Error as Dav1dError, Picture, PixelLayout, PlanarImageComponent, Plane, Settings,
};
use std::io::{Cursor, Read};

pub(crate) const FORMAT: &str = "AVIF";
const EXTENSION: &str = "avif";

/// `get_picture` and `send_pending_data` alternate until the single frame comes out; a truncated
/// bitstream would otherwise leave them asking for more data forever.
const MAX_DECODE_STEPS: usize = 64;

static SIGNATURES: [[u8; 12]; 2] = [*b"\0\0\0\0ftypavif", *b"\0\0\0\0ftypavis"];

/// Skips the leading box size.
static SIGNATURE_MASK: [u8; 12] = [0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

pub(crate) fn register_hook() {
    if register_decoding_hook(
        EXTENSION.into(),
        Box::new(|mut reader| {
            let mut bytes = Vec::new();
            reader
                .read_to_end(&mut bytes)
                .map_err(ImageError::IoError)?;
            Ok(Box::new(AvifDecoder::new(&bytes)?))
        }),
    ) {
        for signature in &SIGNATURES {
            register_format_detection_hook(EXTENSION.into(), signature, Some(&SIGNATURE_MASK));
        }
    }
}

/// Whether the `ftyp` box lists `avif` as a compatible brand: AVIF files may lead with `mif1`.
pub(crate) fn has_avif_brand(bytes: &[u8]) -> bool {
    let Some(size) = bytes.first_chunk::<4>() else {
        return false;
    };
    if bytes.get(4..8) != Some(b"ftyp") {
        return false;
    }
    let end = (u32::from_be_bytes(*size) as usize).min(bytes.len());
    bytes
        .get(16..end)
        .is_some_and(|brands| brands.as_chunks::<4>().0.contains(b"avif"))
}

pub(crate) struct AvifDecoder {
    primary: Vec<u8>,
    alpha: Option<Vec<u8>>,
    premultiplied: bool,
    width: u32,
    height: u32,
    color_type: ColorType,
}

impl AvifDecoder {
    pub(crate) fn new(bytes: &[u8]) -> ImageResult<Self> {
        let data = guarded(FORMAT, || AvifData::from_reader(&mut Cursor::new(bytes)))?;
        let metadata = guarded(FORMAT, || data.primary_item_metadata())?;
        let color_type = match (data.alpha_item.is_some(), metadata.bit_depth > 8) {
            (false, false) => ColorType::Rgb8,
            (true, false) => ColorType::Rgba8,
            (false, true) => ColorType::Rgb16,
            (true, true) => ColorType::Rgba16,
        };
        Ok(Self {
            primary: data.primary_item.to_vec(),
            alpha: data.alpha_item.as_deref().map(<[u8]>::to_vec),
            premultiplied: data.premultiplied_alpha,
            width: metadata.max_frame_width.get(),
            height: metadata.max_frame_height.get(),
            color_type,
        })
    }

    fn decode_into(&self, buf: &mut [u8]) -> ImageResult<()> {
        let color = self.decode_item(&self.primary)?;
        let alpha = self
            .alpha
            .as_ref()
            .map(|item| self.decode_item(item).map(|p| Samples::luma(&p)))
            .transpose()?;
        let yuv = Yuv::new(&color)?;

        let pixel_size = self.color_type.bytes_per_pixel() as usize;
        let row_size = self.width as usize * pixel_size;
        for (y, row) in buf.chunks_exact_mut(row_size).enumerate() {
            for (x, pixel) in row.chunks_exact_mut(pixel_size).enumerate() {
                let rgb = yuv.rgb(x, y);
                match &alpha {
                    Some(alpha) => {
                        let a = alpha.sample(x, y);
                        let [r, g, b] = rgb.map(|c| {
                            if self.premultiplied && a > 0.0 {
                                c / a
                            } else {
                                c
                            }
                        });
                        write_samples(pixel, &[r, g, b, a]);
                    }
                    None => write_samples(pixel, &rgb),
                }
            }
        }
        Ok(())
    }

    fn decode_item(&self, item: &[u8]) -> ImageResult<Picture> {
        let picture = decode_picture(item).map_err(|e| decoding_error(FORMAT, e))?;
        if (picture.width(), picture.height()) != (self.width, self.height) {
            return Err(decoding_error(
                FORMAT,
                "decoded size differs from the sequence header's",
            ));
        }
        Ok(picture)
    }
}

impl ImageDecoder for AvifDecoder {
    fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn color_type(&self) -> ColorType {
        self.color_type
    }

    fn read_image(self, buf: &mut [u8]) -> ImageResult<()> {
        guarded(FORMAT, || self.decode_into(buf))
    }

    fn read_image_boxed(self: Box<Self>, buf: &mut [u8]) -> ImageResult<()> {
        (*self).read_image(buf)
    }
}

fn decode_picture(item: &[u8]) -> Result<Picture, Dav1dError> {
    let mut settings = Settings::new();
    // Pages already decode in parallel, one image per task.
    settings.set_n_threads(1);
    let mut decoder = Decoder::with_settings(&settings)?;
    match decoder.send_data(item.to_vec(), None, None, None) {
        Err(Dav1dError::Again) | Ok(()) => {}
        Err(e) => return Err(e),
    }
    for _ in 0..MAX_DECODE_STEPS {
        match decoder.get_picture() {
            Err(Dav1dError::Again) => match decoder.send_pending_data() {
                Err(Dav1dError::Again) | Ok(()) => {}
                Err(e) => return Err(e),
            },
            result => return result,
        }
    }
    Err(Dav1dError::Again)
}

/// One plane's samples, normalized to 0.0..=1.0 on read.
struct Samples {
    plane: Plane,
    stride: usize,
    wide: bool,
    x_shift: usize,
    y_shift: usize,
    offset: f32,
    scale: f32,
}

impl Samples {
    fn new(picture: &Picture, component: PlanarImageComponent, offset: f32, scale: f32) -> Self {
        let (x_shift, y_shift) = match (component, picture.pixel_layout()) {
            (PlanarImageComponent::Y, _) | (_, PixelLayout::I444 | PixelLayout::I400) => (0, 0),
            (_, PixelLayout::I422) => (1, 0),
            (_, PixelLayout::I420) => (1, 1),
        };
        Self {
            plane: picture.plane(component),
            stride: picture.stride(component) as usize,
            wide: picture.bit_depth() > 8,
            x_shift,
            y_shift,
            offset,
            scale,
        }
    }

    /// The Y plane as luma or alpha: limited range starts at 16 and spans 219, at 8 bits.
    fn luma(picture: &Picture) -> Self {
        let (offset, scale) = luma_range(picture);
        Self::new(picture, PlanarImageComponent::Y, offset, scale)
    }

    fn sample(&self, x: usize, y: usize) -> f32 {
        let (x, y) = (x >> self.x_shift, y >> self.y_shift);
        let raw = if self.wide {
            let at = y * self.stride + x * 2;
            u16::from_ne_bytes([self.plane[at], self.plane[at + 1]]) as f32
        } else {
            self.plane[y * self.stride + x] as f32
        };
        (raw - self.offset) / self.scale
    }
}

fn luma_range(picture: &Picture) -> (f32, f32) {
    let depth = picture.bit_depth() as i32;
    match picture.color_range() {
        YUVRange::Full => (0.0, ((1 << depth) - 1) as f32),
        YUVRange::Limited => ((16 << (depth - 8)) as f32, (219 << (depth - 8)) as f32),
    }
}

/// Chroma normalized to -0.5..=0.5 around its midpoint.
fn chroma_range(picture: &Picture) -> (f32, f32) {
    let depth = picture.bit_depth() as i32;
    let scale = match picture.color_range() {
        YUVRange::Full => (1 << depth) - 1,
        YUVRange::Limited => 224 << (depth - 8),
    };
    ((1 << (depth - 1)) as f32, scale as f32)
}

enum Matrix {
    Identity,
    /// Luma weights of red and blue.
    Luma(f32, f32),
}

impl Matrix {
    fn new(coefficients: MatrixCoefficients) -> ImageResult<Self> {
        Ok(match coefficients {
            MatrixCoefficients::Identity => Self::Identity,
            MatrixCoefficients::BT709 => Self::Luma(0.2126, 0.0722),
            MatrixCoefficients::BT470M => Self::Luma(0.30, 0.11),
            // libavif's default for unspecified matrices
            MatrixCoefficients::BT470BG | MatrixCoefficients::Unspecified => {
                Self::Luma(0.299, 0.114)
            }
            MatrixCoefficients::ST240M => Self::Luma(0.212, 0.087),
            MatrixCoefficients::BT2020NonConstantLuminance => Self::Luma(0.2627, 0.0593),
            other => {
                return Err(decoding_error(
                    FORMAT,
                    format!("unsupported matrix coefficients {other:?}"),
                ));
            }
        })
    }
}

struct Yuv {
    y: Samples,
    chroma: Option<(Samples, Samples)>,
    matrix: Matrix,
}

impl Yuv {
    fn new(picture: &Picture) -> ImageResult<Self> {
        let chroma = (picture.pixel_layout() != PixelLayout::I400).then(|| {
            let (offset, scale) = chroma_range(picture);
            (
                Samples::new(picture, PlanarImageComponent::U, offset, scale),
                Samples::new(picture, PlanarImageComponent::V, offset, scale),
            )
        });
        Ok(Self {
            y: Samples::luma(picture),
            chroma,
            matrix: Matrix::new(picture.matrix_coefficients())?,
        })
    }

    fn rgb(&self, x: usize, y: usize) -> [f32; 3] {
        let luma = self.y.sample(x, y);
        let Some((u, v)) = &self.chroma else {
            return [luma; 3];
        };
        let (cb, cr) = (u.sample(x, y), v.sample(x, y));
        match self.matrix {
            Matrix::Identity => [cr + 0.5, luma, cb + 0.5],
            Matrix::Luma(kr, kb) => {
                let r = luma + 2.0 * (1.0 - kr) * cr;
                let b = luma + 2.0 * (1.0 - kb) * cb;
                [r, (luma - kr * r - kb * b) / (1.0 - kr - kb), b]
            }
        }
    }
}

fn write_samples(pixel: &mut [u8], samples: &[f32]) {
    let sample_size = pixel.len() / samples.len();
    for (out, sample) in pixel.chunks_exact_mut(sample_size).zip(samples) {
        let sample = sample.clamp(0.0, 1.0);
        if sample_size == 2 {
            let value = (sample * u16::MAX as f32).round() as u16;
            out.copy_from_slice(&value.to_ne_bytes());
        } else {
            out[0] = (sample * u8::MAX as f32).round() as u8;
        }
    }
}
