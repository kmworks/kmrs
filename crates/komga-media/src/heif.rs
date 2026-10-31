//! HEIF/HEIC pages through `image`'s decoding hooks, next to the JXL and JPEG 2000 ones.

use crate::avif::{self, AvifDecoder};
use heic_rs::{DecodeOptions, PixelLayout};
use image::error::{DecodingError, ImageFormatHint};
use image::hooks::{register_decoding_hook, register_format_detection_hook};
use image::{ColorType, ImageDecoder, ImageError, ImageResult};
use std::fmt::Display;
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};

const FORMAT: &str = "HEIF";
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
        Box::new(|mut reader| {
            let mut bytes = Vec::new();
            reader
                .read_to_end(&mut bytes)
                .map_err(ImageError::IoError)?;
            if avif::has_avif_brand(&bytes) {
                // `avif-parse` only accepts `avif` in the major brand slot.
                bytes[8..12].copy_from_slice(b"avif");
                return Ok(Box::new(AvifDecoder::new(&bytes)?));
            }
            Ok(Box::new(HeifDecoder::new(bytes)?))
        }),
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
    fn new(bytes: Vec<u8>) -> ImageResult<Self> {
        let info = guarded(FORMAT, || heic_rs::probe(&bytes))?;
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
        let decoded = guarded(FORMAT, || heic_rs::decode(&self.bytes, &options))?;
        if decoded.data.len() != buf.len() {
            return Err(decoding_error(
                FORMAT,
                "decoded size differs from the container's",
            ));
        }
        buf.copy_from_slice(&decoded.data);
        Ok(())
    }

    fn read_image_boxed(self: Box<Self>, buf: &mut [u8]) -> ImageResult<()> {
        (*self).read_image(buf)
    }
}

/// These decoders are young: a panic on a malformed page must fail that page, not its worker.
pub(crate) fn guarded<T, E: Display>(
    format: &str,
    decode: impl FnOnce() -> Result<T, E>,
) -> ImageResult<T> {
    catch_unwind(AssertUnwindSafe(decode))
        .map_err(|_| decoding_error(format, "decoder panicked"))?
        .map_err(|e| decoding_error(format, e))
}

pub(crate) fn decoding_error(format: &str, error: impl Display) -> ImageError {
    ImageError::Decoding(DecodingError::new(
        ImageFormatHint::Name(format.to_string()),
        error.to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_becomes_a_decoding_error() {
        let result: ImageResult<()> =
            guarded(FORMAT, || -> Result<(), &str> { panic!("malformed") });
        assert!(matches!(result, Err(ImageError::Decoding(_))));
    }
}
