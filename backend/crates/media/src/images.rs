// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::io::Cursor;

use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};

pub const LARGE_EDGE: u32 = 1024;
pub const FULL_EDGE: u32 = 640;
pub const THUMB_EDGE: u32 = 256;
pub const EDGES: [u32; 3] = [LARGE_EDGE, FULL_EDGE, THUMB_EDGE];

const MAX_PIXELS: u64 = 12_000_000;
const WEBP_QUALITY: f32 = 82.0;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ImageError {
    #[error("That image has too many pixels to process.")]
    TooManyPixels,
    #[error("That file could not be read as an image.")]
    Unreadable,
}

#[derive(Debug, Clone)]
pub struct Rendition {
    pub edge: u32,
    pub webp: Vec<u8>,
}

pub fn plan_renditions(edges: &[u32], source_edge: u32) -> Vec<(u32, u32)> {
    let mut sorted: Vec<u32> = edges.to_vec();
    sorted.sort_unstable();
    sorted.dedup();

    let mut plan: Vec<(u32, u32)> = Vec::new();
    for edge in sorted {
        let target = edge.min(source_edge);
        if plan.last().is_none_or(|&(_, last)| last < target) {
            plan.push((edge, target));
        }
    }
    plan.reverse();
    plan
}

pub fn square_webp_set(bytes: &[u8], edges: &[u32]) -> Result<Vec<Rendition>, ImageError> {
    let image = decode(bytes)?;
    let side = image.width().min(image.height());
    if side == 0 {
        return Err(ImageError::Unreadable);
    }
    let square = image.crop_imm((image.width() - side) / 2, (image.height() - side) / 2, side, side);

    plan_renditions(edges, side)
        .into_iter()
        .map(|(edge, target)| {
            let resized =
                if target == side { square.clone() } else { square.resize_exact(target, target, FilterType::Lanczos3) };
            let rgba = resized.to_rgba8();
            let encoded = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height()).encode(WEBP_QUALITY);
            Ok(Rendition { edge, webp: encoded.to_vec() })
        })
        .collect()
}

/// JPEG front art for portable audio tags (ID3 APIC / FLAC PICTURE).
pub fn cover_jpeg(bytes: &[u8]) -> Result<Vec<u8>, ImageError> {
    let image = decode(bytes)?.to_rgb8();
    let mut result = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut result, 90)
        .encode_image(&image)
        .map_err(|_| ImageError::Unreadable)?;
    Ok(result)
}

fn decode(bytes: &[u8]) -> Result<DynamicImage, ImageError> {
    let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|_| ImageError::Unreadable)?;
    if !matches!(reader.format(), Some(ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP)) {
        return Err(ImageError::Unreadable);
    }

    let mut decoder = reader.into_decoder().map_err(|_| ImageError::Unreadable)?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(ImageError::TooManyPixels);
    }

    let orientation = decoder.orientation().ok();
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| ImageError::Unreadable)?;
    if let Some(orientation) = orientation {
        image.apply_orientation(orientation);
    }
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_source_keeps_its_size_as_full_and_skips_large() {
        assert_eq!(plan_renditions(&EDGES, 600), [(640, 600), (256, 256)]);
    }

    #[test]
    fn big_source_gets_every_size() {
        assert_eq!(plan_renditions(&EDGES, 3000), [(1024, 1024), (640, 640), (256, 256)]);
    }

    #[test]
    fn tiny_source_becomes_one_rendition() {
        assert_eq!(plan_renditions(&EDGES, 100), [(256, 100)]);
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbImage::from_pixel(width, height, image::Rgb([200, 40, 40]));
        let mut bytes = Vec::new();
        DynamicImage::ImageRgb8(image).write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).unwrap();
        bytes
    }

    #[test]
    fn landscape_png_becomes_square_webp_set() {
        let set = square_webp_set(&png(600, 500), &EDGES).unwrap();
        assert_eq!(set.iter().map(|r| r.edge).collect::<Vec<_>>(), [640, 256]);
        assert!(set.iter().all(|r| r.webp.starts_with(b"RIFF")));
    }

    #[test]
    fn garbage_is_unreadable() {
        assert_eq!(square_webp_set(b"definitely not an image", &EDGES).unwrap_err(), ImageError::Unreadable);
    }
}
