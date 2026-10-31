//! HEIF/HEIC pages through `image`'s decoding hooks, next to the JXL and JPEG 2000 ones.

use heic_rs::{DecodeOptions, PixelLayout};
use image::error::{DecodingError, ImageFormatHint};
use image::hooks::{register_decoding_hook, register_format_detection_hook, GenericReader};
use image::{ColorType, ImageDecoder, ImageError, ImageResult};
use std::fmt::Display;
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};

const EXTENSION: &str = "heic";

/// The `ftyp` brands `detect::detect_media_type` reports as HEIF or HEIC.
static SIGNATURES: [[u8; 12]; 10] = [
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
    layout: PixelLayout,
}

impl HeifDecoder {
    fn new(mut reader: GenericReader<'_>) -> ImageResult<Self> {
        let mut bytes = Vec::new();
        reader
            .read_to_end(&mut bytes)
            .map_err(ImageError::IoError)?;
        let info = guarded(|| heic_rs::probe(&bytes))?;
        let layout = match (info.has_alpha, info.bit_depth > 8) {
            (false, false) => PixelLayout::Rgb8,
            (true, false) => PixelLayout::Rgba8,
            (false, true) => PixelLayout::Rgb16,
            (true, true) => PixelLayout::Rgba16,
        };
        Ok(Self {
            bytes,
            width: info.width,
            height: info.height,
            layout,
        })
    }
}

impl ImageDecoder for HeifDecoder {
    fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn color_type(&self) -> ColorType {
        match self.layout {
            PixelLayout::Rgba8 => ColorType::Rgba8,
            PixelLayout::Rgb16 => ColorType::Rgb16,
            PixelLayout::Rgba16 => ColorType::Rgba16,
            _ => ColorType::Rgb8,
        }
    }

    fn read_image(self, buf: &mut [u8]) -> ImageResult<()> {
        let options = DecodeOptions::default()
            .with_layout(self.layout)
            .with_alpha(self.layout.has_alpha())
            .with_transforms(true);
        let decoded = guarded(|| heic_rs::decode(&self.bytes, &options))?;
        if decoded.data.len() != buf.len() {
            return Err(decoding_error("decoded size differs from the container's"));
        }
        buf.copy_from_slice(&decoded.data);
        Ok(())
    }

    fn read_image_boxed(self: Box<Self>, buf: &mut [u8]) -> ImageResult<()> {
        (*self).read_image(buf)
    }
}

/// `heic-rs` is pinned and young: a panic on a malformed page must fail that page, not its worker.
fn guarded<T>(decode: impl FnOnce() -> heic_rs::Result<T>) -> ImageResult<T> {
    catch_unwind(AssertUnwindSafe(decode))
        .map_err(|_| decoding_error("decoder panicked"))?
        .map_err(decoding_error)
}

fn decoding_error(error: impl Display) -> ImageError {
    ImageError::Decoding(DecodingError::new(
        ImageFormatHint::Name("HEIF".to_string()),
        error.to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_becomes_a_decoding_error() {
        let result: ImageResult<()> = guarded(|| panic!("malformed"));
        assert!(matches!(result, Err(ImageError::Decoding(_))));
    }
}
