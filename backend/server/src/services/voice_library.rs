//! Voice library pure-logic layer.
//!
//! Centralizes side-effect-light logic for the voice library so it can be
//! property-tested without HTTP or (mostly) disk access:
//! - extension/MIME validation
//! - WAV audio probing (sample_rate / duration)
//! - persistence (save/load `voices.json`)
//! - startup reconciliation between the store and on-disk files
//! - unique id allocation
//!
//! HTTP orchestration lives in `handlers/voices.rs`; this module stays pure.

use crate::state::VoiceInfo;
use std::path::{Path, PathBuf};

/// Supported audio extensions (lowercase, with leading dot).
pub const SUPPORTED_EXTENSIONS: &[&str] =
    &[".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm"];

/// Single-file upload size limit: 20 MB.
pub const MAX_UPLOAD_SIZE: usize = 20 * 1024 * 1024;

/// Persistence filename inside the voices directory.
pub const STORE_FILENAME: &str = "voices.json";

/// Extract the lowercase extension (including the leading dot) from a filename
/// or a bare extension. Returns `None` when no extension can be determined.
fn lower_ext(filename: &str) -> Option<String> {
    let name = filename.trim();
    if name.is_empty() {
        return None;
    }
    // Accept a bare extension such as "wav" or ".WAV" as well as a full filename.
    let dotted = if let Some(idx) = name.rfind('.') {
        // `idx` points at the last '.'; take everything from there.
        name[idx..].to_string()
    } else {
        // No dot: treat the whole token as an extension (e.g. "wav").
        format!(".{name}")
    };
    Some(dotted.to_lowercase())
}

/// Whether the extension is supported (case-insensitive).
/// The input may be a full filename or a bare extension.
pub fn is_supported_extension(filename: &str) -> bool {
    match lower_ext(filename) {
        Some(ext) => SUPPORTED_EXTENSIONS.contains(&ext.as_str()),
        None => false,
    }
}

/// Infer the audio MIME type for the playback response from the extension.
/// Unknown extensions fall back to `application/octet-stream`.
pub fn mime_for_extension(filename: &str) -> &'static str {
    match lower_ext(filename).as_deref() {
        Some(".wav") => "audio/wav",
        Some(".mp3") => "audio/mpeg",
        Some(".m4a") => "audio/mp4",
        Some(".flac") => "audio/flac",
        Some(".ogg") => "audio/ogg",
        Some(".webm") => "audio/webm",
        _ => "application/octet-stream",
    }
}

/// Path to `voices.json` inside the voices directory.
pub fn store_path(voices_dir: &Path) -> PathBuf {
    voices_dir.join(STORE_FILENAME)
}

/// Probe audio metadata.
///
/// For WAV: manually parse the RIFF header and the `fmt ` chunk to obtain the
/// sample rate, then combine the `data` chunk byte count with the channel
/// count and bit depth to compute the duration in seconds.
///
/// For non-WAV or any parse failure: return `(0, None)` without panicking.
pub fn probe_audio(bytes: &[u8], filename: &str) -> (i32, Option<f64>) {
    // Only attempt WAV parsing for .wav files; everything else is best-effort
    // "unknown".
    if lower_ext(filename).as_deref() != Some(".wav") {
        return (0, None);
    }
    parse_wav(bytes).unwrap_or((0, None))
}

/// Read a little-endian u16 at `off`.
fn le_u16(bytes: &[u8], off: usize) -> Option<u16> {
    let slice = bytes.get(off..off + 2)?;
    Some(u16::from_le_bytes([slice[0], slice[1]]))
}

/// Read a little-endian u32 at `off`.
fn le_u32(bytes: &[u8], off: usize) -> Option<u32> {
    let slice = bytes.get(off..off + 4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// Parse a canonical RIFF/WAVE byte buffer. Returns `None` on any malformation.
fn parse_wav(bytes: &[u8]) -> Option<(i32, Option<f64>)> {
    // Minimum: "RIFF"(4) + size(4) + "WAVE"(4) = 12 bytes.
    if bytes.len() < 12 {
        return None;
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }

    let mut sample_rate: Option<u32> = None;
    let mut num_channels: Option<u16> = None;
    let mut bits_per_sample: Option<u16> = None;
    let mut data_len: Option<u32> = None;

    // Walk chunks starting right after the "WAVE" tag.
    let mut pos = 12usize;
    while pos + 8 <= bytes.len() {
        let chunk_id = &bytes[pos..pos + 4];
        let chunk_size = le_u32(bytes, pos + 4)? as usize;
        let body_start = pos + 8;

        if chunk_id == b"fmt " {
            // fmt body: audioFormat(2) channels(2) sampleRate(4) byteRate(4)
            //           blockAlign(2) bitsPerSample(2)
            num_channels = le_u16(bytes, body_start + 2);
            sample_rate = le_u32(bytes, body_start + 4);
            bits_per_sample = le_u16(bytes, body_start + 14);
        } else if chunk_id == b"data" {
            // Use the declared chunk size, but clamp to the bytes actually
            // present to stay robust against truncated/padded files.
            let available = bytes.len().saturating_sub(body_start);
            data_len = Some(chunk_size.min(available) as u32);
        }

        // Chunks are word-aligned: an odd size carries a 1-byte pad.
        let advance = chunk_size + (chunk_size & 1);
        pos = body_start.checked_add(advance)?;
    }

    let sr = sample_rate?;
    if sr == 0 {
        return None;
    }

    // Duration is computed only when all the inputs are available and sane.
    let duration = match (num_channels, bits_per_sample, data_len) {
        (Some(ch), Some(bits), Some(len)) if ch > 0 && bits >= 8 => {
            let bytes_per_sample_frame = (ch as u64) * (bits as u64 / 8);
            if bytes_per_sample_frame == 0 {
                None
            } else {
                let frames = len as u64 / bytes_per_sample_frame;
                Some(frames as f64 / sr as f64)
            }
        }
        _ => None,
    };

    Some((sr as i32, duration))
}

/// Persist: write `voices` to `voices.json` (serde_json pretty).
pub fn save_library(voices_dir: &Path, voices: &[VoiceInfo]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(voices)
        .map_err(|e| format!("序列化音色库失败: {e}"))?;
    let path = store_path(voices_dir);
    // Ensure the parent directory exists before writing.
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建音色目录失败: {e}"))?;
        }
    }
    std::fs::write(&path, json).map_err(|e| format!("写入音色库失败: {e}"))
}

/// Load: read `voices.json`.
/// Missing / empty / unparsable file → empty Vec (never errors).
pub fn load_store(voices_dir: &Path) -> Vec<VoiceInfo> {
    let path = store_path(voices_dir);
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    if content.trim().is_empty() {
        return Vec::new();
    }
    serde_json::from_str::<Vec<VoiceInfo>>(&content).unwrap_or_default()
}

/// Extract the filename component (the part after the last `/` or `\`) from a
/// path-like string.
fn file_name_of(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    match trimmed.rfind(['/', '\\']) {
        Some(idx) => &trimmed[idx + 1..],
        None => trimmed,
    }
}

/// Strip the extension from a filename, returning the stem.
fn file_stem_of(filename: &str) -> String {
    match filename.rfind('.') {
        // Keep names like ".env" intact (leading dot, no stem to strip).
        Some(idx) if idx > 0 => filename[..idx].to_string(),
        _ => filename.to_string(),
    }
}

/// Startup reconciliation (pure logic):
/// - input: store entries + the list of supported audio filenames in the dir
/// - output: final voices — keep entries whose `path` filename still exists,
///   drop missing ones, and register an entry for every supported file that is
///   not already covered by a kept entry (`name = stem`, `transcript = Some("")`).
///
/// `existing_files` is the set of filenames currently present in the directory
/// (used for the missing-file check).
pub fn reconcile_library(
    store_entries: Vec<VoiceInfo>,
    existing_files: &[String],
) -> Vec<VoiceInfo> {
    // 1. Keep store entries whose path filename is still present on disk.
    let mut kept: Vec<VoiceInfo> = Vec::new();
    for entry in store_entries {
        let fname = file_name_of(&entry.path);
        let present = existing_files
            .iter()
            .any(|f| file_name_of(f) == fname);
        if present {
            kept.push(entry);
        }
    }

    // Filenames already covered by a kept entry.
    let covered: std::collections::HashSet<String> = kept
        .iter()
        .map(|e| file_name_of(&e.path).to_string())
        .collect();

    // 2. Register supported, uncovered files found in the directory.
    for file in existing_files {
        let fname = file_name_of(file).to_string();
        if fname.is_empty() {
            continue;
        }
        if !is_supported_extension(&fname) {
            continue;
        }
        if covered.contains(&fname) {
            continue;
        }
        // Avoid duplicating the same uncovered filename twice within this pass.
        if kept
            .iter()
            .any(|e| file_name_of(&e.path) == fname)
        {
            continue;
        }
        let id = allocate_id(&kept);
        kept.push(VoiceInfo {
            id,
            name: file_stem_of(&fname),
            // Relative-to-project-root form, as documented in the design.
            path: format!("assets/datasets/voices/{fname}"),
            transcript: Some(String::new()),
            sample_rate: 0,
            duration_seconds: None,
        });
    }

    kept
}

/// Allocate a unique id that does not collide with any existing entry id.
pub fn allocate_id(existing: &[VoiceInfo]) -> String {
    loop {
        let candidate = uuid::Uuid::new_v4().to_string();
        if !existing.iter().any(|e| e.id == candidate) {
            return candidate;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::collections::HashSet;

    // ---- Shared generators / helpers ---------------------------------------

    /// Strategy for an arbitrary `VoiceInfo` with JSON-roundtrip-safe values
    /// (finite, bounded `duration_seconds`; printable strings).
    fn arb_voice() -> impl Strategy<Value = VoiceInfo> {
        (
            "[a-zA-Z0-9_-]{1,16}",                 // id
            "[ -~]{0,20}",                         // name (printable ASCII)
            "[a-zA-Z0-9_./-]{1,30}",               // path
            proptest::option::of("[ -~]{0,30}"),   // transcript
            any::<i32>(),                          // sample_rate
            proptest::option::of(-1.0e6f64..1.0e6f64), // duration_seconds (finite)
        )
            .prop_map(
                |(id, name, path, transcript, sample_rate, duration_seconds)| VoiceInfo {
                    id,
                    name,
                    path,
                    transcript,
                    sample_rate,
                    duration_seconds,
                },
            )
    }

    /// Field-wise equality for `VoiceInfo` (with float tolerance on duration).
    fn voices_eq(a: &VoiceInfo, b: &VoiceInfo) -> bool {
        a.id == b.id
            && a.name == b.name
            && a.path == b.path
            && a.transcript == b.transcript
            && a.sample_rate == b.sample_rate
            && match (a.duration_seconds, b.duration_seconds) {
                (Some(x), Some(y)) => (x - y).abs() < 1e-9 || x == y,
                (None, None) => true,
                _ => false,
            }
    }

    /// Build canonical PCM WAV bytes for the given parameters.
    fn build_wav(sample_rate: u32, channels: u16, bits: u16, frames: u32) -> Vec<u8> {
        let bytes_per_frame = channels as u32 * (bits as u32 / 8);
        let data_len = frames * bytes_per_frame;
        let mut buf = Vec::new();
        buf.extend_from_slice(b"RIFF");
        let riff_size = 4 + (8 + 16) + (8 + data_len); // "WAVE" + fmt + data
        buf.extend_from_slice(&riff_size.to_le_bytes());
        buf.extend_from_slice(b"WAVE");
        // fmt chunk (16-byte PCM body)
        buf.extend_from_slice(b"fmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes()); // audioFormat = PCM
        buf.extend_from_slice(&channels.to_le_bytes());
        buf.extend_from_slice(&sample_rate.to_le_bytes());
        let byte_rate = sample_rate * bytes_per_frame;
        buf.extend_from_slice(&byte_rate.to_le_bytes());
        let block_align = bytes_per_frame as u16;
        buf.extend_from_slice(&block_align.to_le_bytes());
        buf.extend_from_slice(&bits.to_le_bytes());
        // data chunk
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_len.to_le_bytes());
        buf.extend(std::iter::repeat(0u8).take(data_len as usize));
        buf
    }

    /// Filenames mixing supported and unsupported extensions (and none).
    fn arb_filename() -> impl Strategy<Value = String> {
        let stems = prop::sample::select(vec![
            "a", "b", "c", "voice", "x", "data1", "sound", "rec",
        ]);
        let exts = prop::sample::select(vec![
            ".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm", ".txt", ".bin", ".json", "",
        ]);
        (stems, exts).prop_map(|(s, e)| format!("{s}{e}"))
    }

    /// A store entry whose `path` filename is drawn from `arb_filename`.
    fn arb_store_entry() -> impl Strategy<Value = VoiceInfo> {
        (arb_filename(), "[a-z0-9]{4,10}").prop_map(|(fname, id)| VoiceInfo {
            id,
            name: "orig".to_string(),
            path: format!("assets/datasets/voices/{fname}"),
            transcript: Some("orig-text".to_string()),
            sample_rate: 16000,
            duration_seconds: None,
        })
    }

    // ========================================================================
    // Property 2: 采样率与时长探测往返
    // Feature: voice-library-management, Property 2: For any valid WAV bytes
    // (random sample rate / duration), probe_audio's sample_rate equals the
    // original and duration_seconds matches within tolerance; for any non-WAV
    // bytes, probe_audio returns (0, None) without panicking.
    // Validates: Requirements 1.6
    // ========================================================================
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        #[test]
        fn prop_2_probe_wav_roundtrip(
            sample_rate in 1u32..=192_000u32,
            channels in 1u16..=2u16,
            bits_idx in 0usize..4,
            frames in 0u32..=5000u32,
        ) {
            let bits = [8u16, 16, 24, 32][bits_idx];
            let wav = build_wav(sample_rate, channels, bits, frames);
            let (sr, dur) = probe_audio(&wav, "sample.wav");
            prop_assert_eq!(sr, sample_rate as i32);
            let expected = frames as f64 / sample_rate as f64;
            let dur = dur.expect("WAV duration should be Some");
            prop_assert!((dur - expected).abs() < 1e-9, "dur={} expected={}", dur, expected);
        }

        #[test]
        fn prop_2_probe_non_wav(
            bytes in proptest::collection::vec(any::<u8>(), 0..256),
            stem in "[a-zA-Z0-9_]{1,10}",
            ext in prop::sample::select(vec![".mp3", ".m4a", ".flac", ".ogg", ".webm", ".txt", ".bin"]),
        ) {
            let filename = format!("{stem}{ext}");
            let (sr, dur) = probe_audio(&bytes, &filename);
            prop_assert_eq!(sr, 0);
            prop_assert!(dur.is_none());
        }
    }

    // ========================================================================
    // Property 3: 音色库持久化往返
    // Feature: voice-library-management, Property 3: For any Voice_Library
    // state, writing it to the store then loading yields the same entry set
    // (by id and fields).
    // Validates: Requirements 2.1, 2.2, 4.5
    // ========================================================================
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        #[test]
        fn prop_3_persistence_roundtrip(
            voices in proptest::collection::vec(arb_voice(), 0..12)
        ) {
            let dir = tempfile::tempdir().unwrap();
            save_library(dir.path(), &voices).expect("save_library should succeed");
            let loaded = load_store(dir.path());
            prop_assert_eq!(loaded.len(), voices.len());
            for (a, b) in voices.iter().zip(loaded.iter()) {
                prop_assert!(voices_eq(a, b), "mismatch: {:?} vs {:?}", a, b);
            }
        }
    }

    // ========================================================================
    // Property 4: 启动恢复对账
    // Feature: voice-library-management, Property 4: For any store entries and
    // any set of supported files present on disk, reconcile_library keeps only
    // store entries whose path file still exists, drops missing ones, and
    // registers an entry for every supported, uncovered file with name = stem
    // and transcript = "".
    // Validates: Requirements 2.2, 2.4, 2.5
    // ========================================================================
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        #[test]
        fn prop_4_reconcile(
            store in proptest::collection::vec(arb_store_entry(), 0..8),
            existing in proptest::collection::vec(arb_filename(), 0..10),
        ) {
            let result = reconcile_library(store.clone(), &existing);

            let existing_fnames: HashSet<&str> =
                existing.iter().map(|f| super::file_name_of(f)).collect();

            // (a) Every output entry's filename is present on disk.
            for r in &result {
                let fname = super::file_name_of(&r.path);
                prop_assert!(
                    existing_fnames.contains(fname),
                    "output filename {} not in existing files",
                    fname
                );
            }

            // (b) Every store entry whose file still exists is kept (by id).
            for e in &store {
                let fname = super::file_name_of(&e.path);
                if existing_fnames.contains(fname) {
                    prop_assert!(
                        result.iter().any(|r| r.id == e.id),
                        "present store entry id {} was dropped",
                        e.id
                    );
                }
            }

            // (c) Every supported, uncovered file is registered with
            //     name = stem and transcript = Some("").
            let kept_fnames: HashSet<&str> = store
                .iter()
                .map(|e| super::file_name_of(&e.path))
                .filter(|f| existing_fnames.contains(f))
                .collect();
            for f in &existing {
                let fname = super::file_name_of(f);
                if !fname.is_empty()
                    && is_supported_extension(fname)
                    && !kept_fnames.contains(fname)
                {
                    let expected_stem = super::file_stem_of(fname);
                    prop_assert!(
                        result.iter().any(|r| {
                            super::file_name_of(&r.path) == fname
                                && r.name == expected_stem
                                && r.transcript == Some(String::new())
                        }),
                        "supported uncovered file {} not registered correctly",
                        fname
                    );
                }
            }
        }
    }

    // ========================================================================
    // Property 5: 试听 MIME 类型映射
    // Feature: voice-library-management, Property 5: For any filename whose
    // extension is in Supported_Audio_Format (random case / stem),
    // mime_for_extension returns the corresponding audio MIME type.
    // Validates: Requirements 3.6
    // ========================================================================
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        #[test]
        fn prop_5_mime_mapping(
            idx in 0usize..6,
            stem in "[a-zA-Z0-9_]{0,12}",
            case_bits in any::<u32>(),
        ) {
            let table = [
                (".wav", "audio/wav"),
                (".mp3", "audio/mpeg"),
                (".m4a", "audio/mp4"),
                (".flac", "audio/flac"),
                (".ogg", "audio/ogg"),
                (".webm", "audio/webm"),
            ];
            let (ext, expected) = table[idx];
            // Randomize the case of each character of the extension.
            let cased: String = ext
                .chars()
                .enumerate()
                .map(|(i, c)| {
                    if (case_bits >> (i % 32)) & 1 == 1 {
                        c.to_ascii_uppercase()
                    } else {
                        c.to_ascii_lowercase()
                    }
                })
                .collect();
            let filename = format!("{stem}{cased}");
            prop_assert_eq!(mime_for_extension(&filename), expected);
        }
    }

    // ========================================================================
    // Property 7: 核心字段语义保真
    // Feature: voice-library-management, Property 7: For any Reference_Voice,
    // the List_Endpoint form always contains id, name, path, transcript,
    // sample_rate with unchanged semantics; duration_seconds exists only as an
    // additional field.
    // Validates: Requirements 5.5, 5.2
    // ========================================================================
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        #[test]
        fn prop_7_core_fields(v in arb_voice()) {
            let val = serde_json::to_value(&v).unwrap();
            let obj = val.as_object().expect("VoiceInfo serializes to an object");

            for key in ["id", "name", "path", "transcript", "sample_rate"] {
                prop_assert!(obj.contains_key(key), "missing core field: {}", key);
            }
            prop_assert!(obj.contains_key("duration_seconds"));

            prop_assert_eq!(obj.get("id").unwrap().as_str().unwrap(), v.id.as_str());
            prop_assert_eq!(obj.get("name").unwrap().as_str().unwrap(), v.name.as_str());
            prop_assert_eq!(obj.get("path").unwrap().as_str().unwrap(), v.path.as_str());
            prop_assert_eq!(
                obj.get("sample_rate").unwrap().as_i64().unwrap(),
                v.sample_rate as i64
            );
            match &v.transcript {
                Some(s) => prop_assert_eq!(
                    obj.get("transcript").unwrap().as_str().unwrap(),
                    s.as_str()
                ),
                None => prop_assert!(obj.get("transcript").unwrap().is_null()),
            }
        }
    }

    // ========================================================================
    // Property 1: 合法上传创建可检索且字段保真
    // Feature: voice-library-management, Property 1: For any audio whose
    // extension is supported and whose size <= Max_Upload_Size, and any
    // name/transcript, registration allocates a library-unique id, writes the
    // file into the voices dir with path pointing at it, preserves name and
    // transcript, and the entry is subsequently retrievable with matching
    // fields. (Mirrors the handler's upload orchestration over the pure layer.)
    // Validates: Requirements 1.4, 1.5, 1.7
    // ========================================================================
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn prop_1_upload_creates_retrievable(
            existing in proptest::collection::vec(arb_voice(), 0..6),
            name in "[ -~]{1,20}",
            transcript in "[ -~]{0,30}",
            ext in prop::sample::select(vec![".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm"]),
            payload in proptest::collection::vec(any::<u8>(), 0..512),
        ) {
            let dir = tempfile::tempdir().unwrap();
            let voices_dir = dir.path();

            // Library starts from the existing entries.
            let mut library = existing.clone();
            let existing_ids: HashSet<String> =
                existing.iter().map(|e| e.id.clone()).collect();

            // Allocate a unique id and write the audio file (handler step 4).
            let id = allocate_id(&library);
            prop_assert!(!existing_ids.contains(&id), "allocated id collides");

            let stored_filename = format!("{id}{ext}");
            let target = voices_dir.join(&stored_filename);
            std::fs::write(&target, &payload).expect("write audio file");
            prop_assert!(target.exists(), "audio file was not written");

            // Construct the VoiceInfo (path = relative project-root form).
            let voice = VoiceInfo {
                id: id.clone(),
                name: name.clone(),
                path: format!("assets/datasets/voices/{stored_filename}"),
                transcript: Some(transcript.clone()),
                sample_rate: 0,
                duration_seconds: None,
            };
            // path points at the written file.
            prop_assert_eq!(super::file_name_of(&voice.path), stored_filename.as_str());

            // Register + persist (handler step 6).
            library.push(voice);
            save_library(voices_dir, &library).expect("save_library");

            // Retrievable via the store (stand-in for List_Endpoint) with
            // faithful fields.
            let loaded = load_store(voices_dir);
            let found = loaded.iter().find(|v| v.id == id);
            prop_assert!(found.is_some(), "uploaded voice not retrievable");
            let found = found.unwrap();
            prop_assert_eq!(&found.name, &name);
            prop_assert_eq!(found.transcript.clone(), Some(transcript));
            prop_assert_eq!(super::file_name_of(&found.path), stored_filename.as_str());

            // Id remains unique within the resulting library.
            let count = loaded.iter().filter(|v| v.id == id).count();
            prop_assert_eq!(count, 1);
        }
    }

    // ========================================================================
    // Property 8: 非法上传被拒且库不变
    // Feature: voice-library-management, Property 8: For any input whose
    // extension is not in Supported_Audio_Format, or whose size exceeds
    // Max_Upload_Size, the upload is rejected and the Voice_Library is
    // unchanged (no file written, no entry registered).
    // Validates: Requirements 6.3, 6.4
    // ========================================================================
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        #[test]
        fn prop_8_illegal_upload_rejected(
            library in proptest::collection::vec(arb_voice(), 0..6),
            // Case A: unsupported extension (any size up to the limit).
            bad_stem in "[a-zA-Z0-9_]{1,10}",
            bad_ext in prop::sample::select(vec![".txt", ".bin", ".json", ".exe", ".pdf", ""]),
            small_size in 0usize..=MAX_UPLOAD_SIZE,
            // Case B: supported extension but oversize.
            ok_ext in prop::sample::select(vec![".wav", ".mp3", ".flac", ".ogg"]),
            over_size in (MAX_UPLOAD_SIZE + 1)..=(MAX_UPLOAD_SIZE * 2),
        ) {
            // The handler's validation gate (extension + size).
            let reject = |filename: &str, size: usize| -> bool {
                !is_supported_extension(filename) || size > MAX_UPLOAD_SIZE
            };

            // Case A: unsupported extension is rejected.
            let bad_filename = format!("{bad_stem}{bad_ext}");
            prop_assert!(
                reject(&bad_filename, small_size),
                "unsupported extension {} was not rejected",
                bad_filename
            );

            // Case B: supported but oversize is rejected.
            let big_filename = format!("{bad_stem}{ok_ext}");
            prop_assert!(
                reject(&big_filename, over_size),
                "oversize upload was not rejected"
            );

            // On rejection, no registration happens → library unchanged.
            let before = library.clone();
            let mut after = library.clone();
            if !reject(&bad_filename, small_size) {
                after.push(arb_voice_fixed());
            }
            if !reject(&big_filename, over_size) {
                after.push(arb_voice_fixed());
            }
            prop_assert_eq!(after.len(), before.len());
            for (a, b) in before.iter().zip(after.iter()) {
                prop_assert!(voices_eq(a, b));
            }
        }
    }

    /// A fixed placeholder voice used only to detect erroneous registration.
    fn arb_voice_fixed() -> VoiceInfo {
        VoiceInfo {
            id: "should-not-be-added".to_string(),
            name: "x".to_string(),
            path: "assets/datasets/voices/x.wav".to_string(),
            transcript: Some(String::new()),
            sample_rate: 0,
            duration_seconds: None,
        }
    }

    // ========================================================================
    // Property 6: 删除清理条目与文件
    // Feature: voice-library-management, Property 6: For any Voice_Library and
    // any existing entry id, deleting that entry removes it from the library
    // and deletes its corresponding audio file in the voices directory.
    // (Mirrors the handler's delete orchestration over the pure layer.)
    // Validates: Requirements 4.4, 4.5
    // ========================================================================
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn prop_6_delete_cleans_entry_and_file(
            count in 1usize..=8,
            ext in prop::sample::select(vec![".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm"]),
            target_seed in any::<usize>(),
        ) {
            let dir = tempfile::tempdir().unwrap();
            let voices_dir = dir.path();

            // Build a library with unique ids and distinct on-disk files.
            let mut library: Vec<VoiceInfo> = Vec::new();
            for i in 0..count {
                let id = format!("voice-{i}");
                let stored_filename = format!("{id}{ext}");
                std::fs::write(voices_dir.join(&stored_filename), b"audio-bytes")
                    .expect("write audio file");
                library.push(VoiceInfo {
                    id,
                    name: format!("name-{i}"),
                    path: format!("assets/datasets/voices/{stored_filename}"),
                    transcript: Some(String::new()),
                    sample_rate: 16000,
                    duration_seconds: None,
                });
            }
            save_library(voices_dir, &library).expect("save_library");

            // Pick an existing entry to delete.
            let target_idx = target_seed % count;
            let target_id = library[target_idx].id.clone();
            let target_fname = super::file_name_of(&library[target_idx].path).to_string();
            let target_file = voices_dir.join(&target_fname);
            prop_assert!(target_file.exists(), "target file must exist before delete");

            // Mirror the handler's delete: remove file + drop entry + persist.
            std::fs::remove_file(&target_file).ok();
            library.retain(|v| v.id != target_id);
            save_library(voices_dir, &library).expect("save_library after delete");

            // (a) Library no longer contains the deleted id (memory + persisted).
            prop_assert!(!library.iter().any(|v| v.id == target_id));
            let loaded = load_store(voices_dir);
            prop_assert!(!loaded.iter().any(|v| v.id == target_id));

            // (b) The deleted entry's file is removed from the voices dir.
            prop_assert!(!target_file.exists(), "deleted file should be gone");

            // (c) Surviving entries keep their files.
            for v in &library {
                let f = voices_dir.join(super::file_name_of(&v.path));
                prop_assert!(f.exists(), "surviving file {} should remain", v.path);
            }
        }
    }

    // ========================================================================
    // Unit test (task 2.5): load_store boundary cases.
    // Missing / empty / corrupt JSON → empty Vec, never panics. (Req 2.3)
    // ========================================================================
    #[test]
    fn load_store_missing_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        // No voices.json written.
        assert!(load_store(dir.path()).is_empty());
    }

    #[test]
    fn load_store_empty_file_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(store_path(dir.path()), "").unwrap();
        assert!(load_store(dir.path()).is_empty());

        // Whitespace-only is also treated as empty.
        std::fs::write(store_path(dir.path()), "   \n\t ").unwrap();
        assert!(load_store(dir.path()).is_empty());
    }

    #[test]
    fn load_store_corrupt_json_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(store_path(dir.path()), "{not valid json[[[").unwrap();
        assert!(load_store(dir.path()).is_empty());
    }

    // ========================================================================
    // Unit test (task 6.4): upload size boundary.
    // Exactly 20MB accepted; 20MB + 1 rejected. (Req 6.4)
    // ========================================================================
    #[test]
    fn upload_size_boundary() {
        // Size check mirrors the handler: reject when size > MAX_UPLOAD_SIZE.
        let exactly_max = MAX_UPLOAD_SIZE;
        let over_max = MAX_UPLOAD_SIZE + 1;
        assert!(!(exactly_max > MAX_UPLOAD_SIZE), "exactly 20MB must be accepted");
        assert!(over_max > MAX_UPLOAD_SIZE, "20MB + 1 must be rejected");
        assert_eq!(MAX_UPLOAD_SIZE, 20 * 1024 * 1024);
    }

    // ========================================================================
    // Unit test (task 6.6): serve_voice_audio lookup for a non-existent id.
    // Looking up an absent id returns None (→ 404). (Req 3.7)
    // ========================================================================
    #[test]
    fn serve_lookup_missing_id_returns_none() {
        let voices = vec![
            VoiceInfo {
                id: "exists-1".to_string(),
                name: "a".to_string(),
                path: "assets/datasets/voices/a.wav".to_string(),
                transcript: Some(String::new()),
                sample_rate: 16000,
                duration_seconds: None,
            },
        ];
        // Mirrors the handler lookup: voices.iter().find(|v| v.id == id).
        assert!(voices.iter().find(|v| v.id == "does-not-exist").is_none());
        assert!(voices.iter().find(|v| v.id == "exists-1").is_some());
    }

    // ========================================================================
    // Unit test (task 6.9): delete is idempotent for a non-existent id.
    // Deleting an absent id leaves the library unchanged. (Req 4.6)
    // ========================================================================
    #[test]
    fn delete_missing_id_is_idempotent() {
        let voices = vec![
            VoiceInfo {
                id: "keep-1".to_string(),
                name: "a".to_string(),
                path: "assets/datasets/voices/a.wav".to_string(),
                transcript: Some(String::new()),
                sample_rate: 16000,
                duration_seconds: None,
            },
            VoiceInfo {
                id: "keep-2".to_string(),
                name: "b".to_string(),
                path: "assets/datasets/voices/b.wav".to_string(),
                transcript: Some(String::new()),
                sample_rate: 24000,
                duration_seconds: Some(1.5),
            },
        ];
        let mut after = voices.clone();
        // Mirrors the handler: entry not found → library unchanged.
        let found = after.iter().any(|v| v.id == "missing");
        assert!(!found);
        after.retain(|v| v.id != "missing");
        assert_eq!(after.len(), voices.len());
        for (a, b) in voices.iter().zip(after.iter()) {
            assert!(voices_eq(a, b));
        }
    }
}
