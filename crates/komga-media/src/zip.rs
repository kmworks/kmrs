//! ZIP entry extraction, ported from `ZipFileUtils.kt` (`getZipEntryBytes`).
//!
//! The rust `zip` crate resolves names from the central directory only; the commons-compress
//! slow path that re-reads local file headers for unicode extra fields has no equivalent.
//! That only affects archives whose central directory names are mojibake, which is accepted.

use crate::error::{MediaError, Result};
use std::io::Read;
use std::path::Path;

/// A ZIP archive opened once, with per-entry reads on the same handle. Lazy: only the
/// requested entry is touched per call, so a scan can stop early without touching the
/// remaining candidates (network mounts charge per open, not per read).
pub struct ZipEntries {
    archive: zip::ZipArchive<std::fs::File>,
}

impl ZipEntries {
    pub fn open(path: &Path) -> Result<Self> {
        let file = std::fs::File::open(path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => MediaError::NoSuchFile(path.display().to_string()),
            _ => MediaError::Other(e.into()),
        })?;
        let archive = zip::ZipArchive::new(file)
            .map_err(|e| MediaError::unsupported(format!("could not open zip archive: {e}")))?;
        Ok(Self { archive })
    }

    /// Reads one entry on the held archive; repeated calls reuse the same handle.
    pub fn read(&mut self, entry_name: &str) -> Result<Vec<u8>> {
        read_entry(&mut self.archive, entry_name)
    }
}

/// Returns the bytes of `entry_name` inside the zip at `path`.
pub fn get_entry_bytes(path: &Path, entry_name: &str) -> Result<Vec<u8>> {
    ZipEntries::open(path)?.read(entry_name)
}

/// Reads several entries with a single archive open, in the order given. Network mounts
/// charge per open, so hashing the first and last pages must not reopen the archive for
/// every page.
pub fn get_entries_bytes(path: &Path, entry_names: &[&str]) -> Result<Vec<Vec<u8>>> {
    let mut entries = ZipEntries::open(path)?;
    entry_names.iter().map(|name| entries.read(name)).collect()
}

/// `ZipArchive::by_name` matches the raw central-directory bytes, but callers pass the
/// decoded name (`ZipFile::name`, as stored in MEDIA_PAGE): for non-ASCII names without
/// the UTF-8 flag, the CP437-decoded string's bytes differ from the raw ones and the raw
/// lookup misses. commons-compress keys its name map by the decoded name, so such archives
/// work in Java komga; fall back to a decoded-name scan to match.
pub(crate) fn by_name_decoded<'a, R: std::io::Read + std::io::Seek>(
    archive: &'a mut zip::ZipArchive<R>,
    entry_name: &str,
) -> std::result::Result<zip::read::ZipFile<'a, R>, zip::result::ZipError> {
    match archive
        .index_for_name(entry_name)
        .or_else(|| (0..archive.len()).find(|&i| archive.name_for_index(i) == Some(entry_name)))
    {
        Some(index) => archive.by_index(index),
        None => Err(zip::result::ZipError::FileNotFound),
    }
}

fn read_entry(archive: &mut zip::ZipArchive<std::fs::File>, entry_name: &str) -> Result<Vec<u8>> {
    let mut entry = match by_name_decoded(archive, entry_name) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => {
            return Err(MediaError::EntryNotFound(entry_name.to_string()))
        }
        Err(e) => {
            return Err(MediaError::unsupported(format!(
                "could not read zip entry: {e}"
            )))
        }
    };
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf).map_err(|e| {
        MediaError::unsupported(format!("could not extract zip entry {entry_name}: {e}"))
    })?;
    Ok(buf)
}

#[cfg(test)]
pub(crate) fn write_zip_raw(path: &Path, entries: &[(&[u8], &[u8])]) {
    fn crc32(data: &[u8]) -> u32 {
        let mut crc: u32 = 0xFFFF_FFFF;
        for &b in data {
            crc ^= b as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    // minimal stored zip: local headers, then the central directory, then EOCD; flags stay
    // 0, so non-ASCII raw names are written without the UTF-8 flag, like Windows tools do
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    for (name, data) in entries {
        let crc = crc32(data);
        let offset = out.len() as u32;
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&[0; 8]);
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(name);
        out.extend_from_slice(data);

        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&[0; 4]);
        central.extend_from_slice(&[0; 8]);
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(name.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0; 12]);
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name);
    }
    let cd_offset = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    std::fs::write(path, out).unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archives() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/resources/archives")
    }

    #[test]
    fn extract_existing_entry() {
        let bytes = get_entry_bytes(&archives().join("zip.zip"), "komga.png").unwrap();
        assert_eq!(bytes.len(), 3108);
        assert_eq!(&bytes[0..4], b"\x89PNG");
    }

    #[test]
    fn missing_entry_is_entry_not_found() {
        assert!(matches!(
            get_entry_bytes(&archives().join("zip.zip"), "nope.png"),
            Err(MediaError::EntryNotFound(_))
        ));
    }

    #[test]
    fn missing_file_is_no_such_file() {
        assert!(matches!(
            get_entry_bytes(&archives().join("missing.zip"), "komga.png"),
            Err(MediaError::NoSuchFile(_))
        ));
    }

    #[test]
    fn stored_and_deflate_variants() {
        for name in ["zip-copy.zip", "zip.zip", "zip-bzip2.zip"] {
            let bytes = get_entry_bytes(&archives().join(name), "komga.png").unwrap();
            assert_eq!(bytes.len(), 3108, "{name}");
        }
    }

    #[test]
    fn get_entries_bytes_matches_individual_reads() {
        let path = archives().join("zip.zip");
        let batch = get_entries_bytes(&path, &["komga.png"]).unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0], get_entry_bytes(&path, "komga.png").unwrap());

        // missing entries surface EntryNotFound like the single-entry function
        assert!(matches!(
            get_entries_bytes(&path, &["nope.png"]),
            Err(MediaError::EntryNotFound(_))
        ));
    }

    /// GBK "封面.jpg": Windows tools write non-ASCII entry names without the UTF-8 flag;
    /// the central directory then decodes (CP437) to a mojibake string whose bytes differ
    /// from the raw ones. Readers look entries up by that decoded name (as stored in
    /// MEDIA_PAGE), like commons-compress's name map.
    #[test]
    fn read_by_decoded_name_when_raw_bytes_are_not_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gbk.zip");
        let name_gbk: &[u8] = &[0xB7, 0xE2, 0xC3, 0xE6, 0x2E, 0x6A, 0x70, 0x67];
        write_zip_raw(&path, &[(name_gbk, b"jpeg-bytes")]);

        let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
        let decoded = archive.by_index(0).unwrap().name().to_string();
        assert_ne!(decoded.as_bytes(), name_gbk, "fixture must decode the name");

        assert_eq!(get_entry_bytes(&path, &decoded).unwrap(), b"jpeg-bytes");
        assert_eq!(
            get_entries_bytes(&path, &[decoded.as_str()]).unwrap(),
            vec![b"jpeg-bytes".to_vec()]
        );
        // no charset guessing: the UTF-8 spelling of the same text is not a key
        assert!(matches!(
            get_entry_bytes(&path, "封面.jpg"),
            Err(MediaError::EntryNotFound(_))
        ));
    }

    /// The same failure shape with UTF-8 name bytes but no UTF-8 flag (old/buggy writers):
    /// the reader still decodes CP437 (the flag, not validity, picks the charset), so the
    /// stored name is mojibake and only the decoded name resolves the entry.
    #[test]
    fn read_by_decoded_name_when_utf8_name_lacks_the_flag() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("utf8-no-flag.zip");
        write_zip_raw(&path, &[("封面.jpg".as_bytes(), b"jpeg-bytes")]);

        let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
        let decoded = archive.by_index(0).unwrap().name().to_string();
        assert_ne!(decoded, "封面.jpg", "fixture must decode as CP437");

        assert_eq!(get_entry_bytes(&path, &decoded).unwrap(), b"jpeg-bytes");
    }
}
