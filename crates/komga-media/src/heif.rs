//! HEIF, HEIC and AVIF pages through `image`'s decoding hooks, next to the JXL and JPEG 2000 ones.

use image::error::{DecodingError, ImageFormatHint};
use image::hooks::{register_decoding_hook, register_format_detection_hook, GenericReader};
use image::{ColorType, ImageDecoder, ImageError, ImageResult};
use libheif_rs::{ColorSpace, HeifContext, LibHeif, RgbChroma};
use std::fmt::Display;
use std::io::Read;

const EXTENSION: &str = "heic";

/// The `ftyp` brands `detect::detect_media_type` reports as HEIF, HEIC or AVIF.
static SIGNATURES: [[u8; 12]; 12] = [
    *b"\0\0\0\0ftypmif1",
    *b"\0\0\0\0ftypmsf1",
    *b"\0\0\0\0ftypheic",
    *b"\0\0\0\0ftypheix",
    *b"\0\0\0\0ftyphevc",
    *b"\0\0\0\0ftyphevx",
    *b"\0\0\0\0ftypheim",
    *b"\0\0\0\0ftypheis",
    *b"\0\0\0\0ftyphevm",
    *b"\0\0\0\0ftyphevs",
    *b"\0\0\0\0ftypavif",
    *b"\0\0\0\0ftypavis",
];

/// Skips the leading box size.
static SIGNATURE_MASK: [u8; 12] = [0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

pub(crate) fn register_hook() {
    if register_decoding_hook(
        EXTENSION.into(),
        Box::new(|reader| Ok(Box::new(HeifDecoder::new(reader)?))),
    ) {
        for signature in &SIGNATURES {
            register_format_detection_hook(EXTENSION.into(), signature, Some(&SIGNATURE_MASK));
        }
    }
}

struct HeifDecoder {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
    color_type: ColorType,
}

impl HeifDecoder {
    fn new(mut reader: GenericReader<'_>) -> ImageResult<Self> {
        let mut bytes = Vec::new();
        reader
            .read_to_end(&mut bytes)
            .map_err(ImageError::IoError)?;
        let (width, height, color_type) = {
            let context = HeifContext::read_from_bytes(&bytes).map_err(decoding_error)?;
            let handle = context.primary_image_handle().map_err(decoding_error)?;
            let color_type = match (handle.has_alpha_channel(), handle.luma_bits_per_pixel() > 8) {
                (false, false) => ColorType::Rgb8,
                (true, false) => ColorType::Rgba8,
                (false, true) => ColorType::Rgb16,
                (true, true) => ColorType::Rgba16,
            };
            (handle.width(), handle.height(), color_type)
        };
        Ok(Self {
            bytes,
            width,
            height,
            color_type,
        })
    }
}

impl ImageDecoder for HeifDecoder {
    fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn color_type(&self) -> ColorType {
        self.color_type
    }

    fn read_image(self, buf: &mut [u8]) -> ImageResult<()> {
        let chroma = match self.color_type {
            ColorType::Rgba8 => RgbChroma::Rgba,
            ColorType::Rgb16 => RgbChroma::HdrRgbLe,
            ColorType::Rgba16 => RgbChroma::HdrRgbaLe,
            _ => RgbChroma::Rgb,
        };
        let context = HeifContext::read_from_bytes(&self.bytes).map_err(decoding_error)?;
        let handle = context.primary_image_handle().map_err(decoding_error)?;
        let image = LibHeif::new()
            .decode(&handle, ColorSpace::Rgb(chroma), None)
            .map_err(decoding_error)?;
        let planes = image.planes();
        let plane = planes
            .interleaved
            .ok_or_else(|| decoding_error("no interleaved plane"))?;

        let wide = self.color_type.bytes_per_pixel() > self.color_type.channel_count();
        let row_size = self.width as usize * self.color_type.bytes_per_pixel() as usize;
        let max = ((1u32 << plane.bits_per_pixel) - 1) as f32;
        for (out, row) in buf
            .chunks_exact_mut(row_size)
            .zip(plane.data.chunks_exact(plane.stride))
        {
            if wide {
                // Samples are stored at their coded depth, in the low bits.
                let samples = row.as_chunks::<2>().0;
                for (out, sample) in out.as_chunks_mut::<2>().0.iter_mut().zip(samples) {
                    let sample = u16::from_le_bytes(*sample) as f32 / max;
                    *out = ((sample * u16::MAX as f32).round() as u16).to_ne_bytes();
                }
            } else {
                out.copy_from_slice(&row[..row_size]);
            }
        }
        Ok(())
    }

    fn read_image_boxed(self: Box<Self>, buf: &mut [u8]) -> ImageResult<()> {
        (*self).read_image(buf)
    }
}

fn decoding_error(error: impl Display) -> ImageError {
    ImageError::Decoding(DecodingError::new(
        ImageFormatHint::Name("HEIF".to_string()),
        error.to_string(),
    ))
}
