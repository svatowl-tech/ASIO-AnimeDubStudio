use serde::{Deserialize, Serialize};
use std::env;
// sync
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::process::Command;
use tokio::sync::Semaphore;
use rayon::prelude::*;
use zip::ZipWriter;
use zip::write::SimpleFileOptions;
use crate::db::AppState;
use hound::{WavReader, WavWriter, WavSpec, SampleFormat};
use std::io::Write;
use sqlx::Row;

#[inline]
pub fn new_ffmpeg_command() -> Command {
    let mut cmd = Command::new(crate::get_ffmpeg_path());
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

#[inline]
pub fn new_ffprobe_command() -> Command {
    let mut cmd = Command::new(crate::get_ffprobe_path());
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

// ... inside export_engine.rs ...

#[tauri::command]
pub async fn export_all_stems(
    _app_handle: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    _project_name: String,
    output_path: String,
) -> Result<String, String> {
    // 1. Fetch project data from DB
    let project = crate::db::load_project_from_db(state, project_id.clone()).await?;
    
    // Calculate project duration to know when to stop
    let mut total_duration = 0.0;
    for track in &project.tracks {
        for seg in &track.segments {
            let end_time = seg.start_time + seg.duration;
            if end_time > total_duration {
                total_duration = end_time;
            }
        }
    }

    // 2. Prepare directories
    let temp_dir = env::temp_dir().join(format!("export_all_{}", project_id));
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    // 3. Process tracks in parallel with rayon
    let track_results: Vec<Result<(String, PathBuf), String>> = project.tracks.par_iter().map(|track| {
        let temp_stem_path = temp_dir.join(format!("{}.wav", track.name.replace(" ", "_")));
        
        // --- Create full-timeline WAV with silence filling ---
        // (Simplified: assuming 44.1kHz 16bit, should ideally match project settings)
        let spec = WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };
        
        let mut writer = WavWriter::create(&temp_stem_path, spec).map_err(|e| e.to_string())?;
        let mut current_pos_samples: u64 = 0;
        let total_samples = (total_duration * 48000.0) as u64;

        let mut segments: Vec<_> = track.segments.iter()
            .cloned()
            .collect();
        segments.sort_by(|a, b| a.start_time.partial_cmp(&b.start_time).unwrap_or(std::cmp::Ordering::Equal));

        for seg in segments {
            let adjusted_start = seg.start_time;
            let seg_start_samples = (adjusted_start.max(0.0) * 48000.0) as u64;
            
            // Fill gap
            if seg_start_samples > current_pos_samples {
                for _ in 0..(seg_start_samples - current_pos_samples) {
                    writer.write_sample(0i16).map_err(|e| e.to_string())?;
                }
                current_pos_samples = seg_start_samples;
            }

                // Write segment
            if let Some(path) = seg.file_path {
                let resolved = crate::file_io::resolve_existing_media_path(&path, None, Some(&output_path), &[]);
                if let Ok(mut reader) = WavReader::open(&resolved) {
                    for sample in reader.samples::<i16>() {
                        if let Ok(s) = sample {
                            writer.write_sample(s).map_err(|e| e.to_string())?;
                            current_pos_samples += 1;
                        }
                    }
                }
            }
        }

        // Fill remaining
        if total_samples > current_pos_samples {
            for _ in 0..(total_samples - current_pos_samples) {
                writer.write_sample(0i16).map_err(|e| e.to_string())?;
            }
        }
        
        writer.finalize().map_err(|e| e.to_string())?;
        
        Ok((track.name.clone(), temp_stem_path))
    }).collect();

    let mut stems = Vec::new();
    for res in track_results {
        stems.push(res?);
    }

    // 4. Zip
    let final_zip_path = PathBuf::from(output_path);
    
    let file = File::create(&final_zip_path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);

    for (name, path) in stems {
        zip.start_file::<String, ()>(format!("{}.wav", name), SimpleFileOptions::default()).map_err(|e| e.to_string())?;
        zip.write_all(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;

    // Cleanup
    let _ = fs::remove_dir_all(&temp_dir);

    Ok(final_zip_path.to_string_lossy().to_string())
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ExportSegmentData {
    #[serde(default)]
    pub id: String,
    pub start_time: f64,
    pub duration: f64,
    pub file_path: Option<String>,
    #[serde(default)]
    pub gain: f64,
    #[serde(default)]
    pub file_offset: f64,
    #[serde(default)]
    pub file_duration: f64,
    pub playback_rate: Option<f64>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ProjectTrack {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub is_muted: Option<bool>,
    pub is_solo: Option<bool>,
    pub volume: Option<f64>,
    #[serde(default)]
    pub segments: Vec<ExportSegmentData>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportProjectData {
    #[serde(default)]
    pub tracks: Vec<ProjectTrack>,
    #[serde(default)]
    #[allow(dead_code)]
    pub audio_offset_ms: f64,
    #[serde(default)]
    pub project_path: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct StemOptions {
    pub bit_depth: String, // "16", "24", "32float"
    pub output_dir: String,
    pub normalize: Option<bool>,
    pub target_lufs: Option<f64>,
    pub max_peak: Option<f64>,
    pub normalization_mode: Option<String>,
}

#[derive(Serialize, Clone)]
struct StemProgress {
    current: usize,
    total: usize,
    track_name: String,
}

fn read_wav_mono_48k(path: &str) -> Result<Vec<f32>, String> {
    let mut reader = WavReader::open(path).map_err(|e| format!("Failed to open WAV {}: {}", path, e))?;
    let spec = reader.spec();
    let channels = (spec.channels as usize).max(1);
    let src_rate = spec.sample_rate.max(1);

    let raw_samples: Vec<f32> = match spec.sample_format {
        SampleFormat::Int => {
            if spec.bits_per_sample == 16 {
                reader.samples::<i16>().map(|s| s.unwrap_or(0) as f32 / i16::MAX as f32).collect()
            } else if spec.bits_per_sample == 24 {
                reader.samples::<i32>().map(|s| s.unwrap_or(0) as f32 / 8_388_607.0).collect()
            } else if spec.bits_per_sample == 32 {
                reader.samples::<i32>().map(|s| s.unwrap_or(0) as f32 / i32::MAX as f32).collect()
            } else if spec.bits_per_sample == 8 {
                reader.samples::<i8>().map(|s| s.unwrap_or(0) as f32 / i8::MAX as f32).collect()
            } else {
                let max_val = ((1i64 << (spec.bits_per_sample.saturating_sub(1))) - 1).max(1) as f32;
                reader.samples::<i32>().map(|s| s.unwrap_or(0) as f32 / max_val).collect()
            }
        }
        SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap_or(0.0)).collect(),
    };

    let frames = raw_samples.len() / channels;
    let mut mono = Vec::with_capacity(frames);
    if channels == 1 {
        mono = raw_samples;
    } else {
        for f in 0..frames {
            let mut sum = 0.0f32;
            for c in 0..channels {
                sum += raw_samples[f * channels + c];
            }
            mono.push(sum / channels as f32);
        }
    }

    if src_rate == 48000 || mono.is_empty() {
        return Ok(mono);
    }

    let out_len = ((mono.len() as f64) * 48000.0 / (src_rate as f64)).round() as usize;
    let mut resampled = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = (i as f64) * (src_rate as f64) / 48000.0;
        let idx = pos.floor() as usize;
        let frac = (pos - idx as f64) as f32;
        let s0 = mono.get(idx).copied().unwrap_or(0.0);
        let s1 = mono.get(idx + 1).copied().unwrap_or(s0);
        resampled.push(s0 + (s1 - s0) * frac);
    }
    Ok(resampled)
}

pub fn mix_segments_to_mono_48k_pure_rust(
    segments: &[ExportSegmentData],
    normalize: bool,
    target_lufs: f64,
    max_peak_db: f64,
    normalization_mode: &str,
    fixed_duration: Option<f64>,
    project_path_hint: Option<&str>,
    output_path_hint: Option<&str>,
) -> Vec<f32> {
    let sample_rate = 48000usize;
    let mut total_duration = fixed_duration.unwrap_or(0.0);
    if fixed_duration.is_none() {
        for seg in segments {
            let end_t = (seg.start_time.max(0.0)) + seg.duration.max(0.0);
            if end_t > total_duration {
                total_duration = end_t;
            }
        }
    }

    let total_samples = ((total_duration.max(0.1)) * sample_rate as f64).ceil() as usize;
    let mut mix_buf = vec![0.0f32; total_samples];

    for seg in segments {
        let Some(ref path_str) = seg.file_path else { continue };
        if path_str.is_empty() {
            continue;
        }
        let resolved_path = crate::file_io::resolve_existing_media_path(
            path_str,
            project_path_hint,
            output_path_hint,
            &[],
        );
        if !resolved_path.exists() {
            continue;
        }
        let resolved_str = resolved_path.to_string_lossy().to_string();
        let Ok(file_samples) = read_wav_mono_48k(&resolved_str) else { continue };
        if file_samples.is_empty() {
            continue;
        }

        let rate = seg.playback_rate.unwrap_or(1.0).clamp(0.25, 4.0);
        let gain = if seg.gain > 0.0 { seg.gain as f32 } else { 1.0 };
        let start_in_file = (seg.file_offset.max(0.0) * sample_rate as f64) as usize;
        let out_dur_samples = (seg.duration.max(0.0) * sample_rate as f64).round() as usize;
        let dest_start = (seg.start_time.max(0.0) * sample_rate as f64).round() as usize;

        for i in 0..out_dur_samples {
            let dest_idx = dest_start + i;
            if dest_idx >= mix_buf.len() {
                break;
            }
            let src_pos = start_in_file as f64 + (i as f64) * rate;
            let src_idx = src_pos.floor() as usize;
            if src_idx >= file_samples.len() {
                break;
            }
            let frac = (src_pos - src_idx as f64) as f32;
            let s0 = file_samples[src_idx];
            let s1 = file_samples.get(src_idx + 1).copied().unwrap_or(s0);
            let sample = (s0 + (s1 - s0) * frac) * gain;
            mix_buf[dest_idx] += sample;
        }
    }

    if normalize && !mix_buf.is_empty() {
        let max_peak_linear = 10.0f32.powf((max_peak_db as f32) / 20.0);
        let mut current_peak = 0.0f32;
        for &s in &mix_buf {
            let a = s.abs();
            if a > current_peak {
                current_peak = a;
            }
        }

        if normalization_mode == "peak" {
            if current_peak > 1e-6 {
                let gain_factor = max_peak_linear / current_peak;
                for s in &mut mix_buf {
                    *s = (*s * gain_factor).clamp(-1.0, 1.0);
                }
            }
        } else {
            let mut gain_factor = 1.0f32;
            if let Ok(mut meter) = ebur128::EbuR128::new(1, sample_rate as u32, ebur128::Mode::I) {
                let _ = meter.add_frames_f32(&mix_buf);
                if let Ok(measured_lufs) = meter.loudness_global() {
                    if measured_lufs.is_finite() && measured_lufs > -70.0 {
                        let delta_db = (target_lufs - measured_lufs).clamp(-24.0, 24.0) as f32;
                        gain_factor = 10.0f32.powf(delta_db / 20.0);
                    }
                }
            }
            if current_peak * gain_factor > max_peak_linear && current_peak > 1e-6 {
                gain_factor = max_peak_linear / current_peak;
            }
            for s in &mut mix_buf {
                *s = (*s * gain_factor).clamp(-1.0, 1.0);
            }
        }
    }

    mix_buf
}

fn flac_crc8(data: &[u8]) -> u8 {
    let mut crc = 0u8;
    for &b in data {
        crc ^= b;
        for _ in 0..8 {
            if (crc & 0x80) != 0 {
                crc = (crc << 1) ^ 0x07;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

fn flac_crc16(data: &[u8]) -> u16 {
    let mut crc = 0u16;
    for &b in data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            if (crc & 0x8000) != 0 {
                crc = (crc << 1) ^ 0x8005;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

fn encode_flac_utf8_u64(val: u64, out: &mut Vec<u8>) {
    if val < 0x80 {
        out.push(val as u8);
    } else if val < (1 << 11) {
        out.push((0xC0 | (val >> 6)) as u8);
        out.push((0x80 | (val & 0x3F)) as u8);
    } else if val < (1 << 16) {
        out.push((0xE0 | (val >> 12)) as u8);
        out.push((0x80 | ((val >> 6) & 0x3F)) as u8);
        out.push((0x80 | (val & 0x3F)) as u8);
    } else if val < (1 << 21) {
        out.push((0xF0 | (val >> 18)) as u8);
        out.push((0x80 | ((val >> 12) & 0x3F)) as u8);
        out.push((0x80 | ((val >> 6) & 0x3F)) as u8);
        out.push((0x80 | (val & 0x3F)) as u8);
    } else if val < (1 << 26) {
        out.push((0xF8 | (val >> 24)) as u8);
        out.push((0x80 | ((val >> 18) & 0x3F)) as u8);
        out.push((0x80 | ((val >> 12) & 0x3F)) as u8);
        out.push((0x80 | ((val >> 6) & 0x3F)) as u8);
        out.push((0x80 | (val & 0x3F)) as u8);
    } else {
        out.push((0xFC | (val >> 30)) as u8);
        out.push((0x80 | ((val >> 24) & 0x3F)) as u8);
        out.push((0x80 | ((val >> 18) & 0x3F)) as u8);
        out.push((0x80 | ((val >> 12) & 0x3F)) as u8);
        out.push((0x80 | ((val >> 6) & 0x3F)) as u8);
        out.push((0x80 | (val & 0x3F)) as u8);
    }
}

/// Pure-Rust lossless FLAC encoder (RFC 9639) for 48kHz 16-bit mono audio.
/// Uses SUBFRAME_CONSTANT for silent/uniform blocks and SUBFRAME_VERBATIM for active audio blocks,
/// with full STREAMINFO MD5 checksum, CRC-8 frame headers, and CRC-16 frame footers.
pub fn write_flac_mono_16bit_pure_rust(samples: &[f32], out_file: &Path) -> Result<(), String> {
    if let Some(parent) = out_file.parent() {
        if !parent.exists() {
            let _ = fs::create_dir_all(parent);
        }
    }

    let pcm_samples: Vec<i16> = if samples.is_empty() {
        vec![0i16; 4800]
    } else {
        samples
            .iter()
            .map(|&s| (s.clamp(-1.0, 1.0) * 32_767.0) as i16)
            .collect()
    };

    let mut pcm_le_bytes = Vec::with_capacity(pcm_samples.len() * 2);
    for &s in &pcm_samples {
        pcm_le_bytes.extend_from_slice(&s.to_le_bytes());
    }
    let md5_digest = md5::compute(&pcm_le_bytes);

    let mut out_bytes = Vec::with_capacity(42 + pcm_samples.len() * 2);
    // 1. Magic "fLaC"
    out_bytes.extend_from_slice(b"fLaC");

    // 2. STREAMINFO metadata block header (last block = 1, type = 0, length = 34)
    out_bytes.extend_from_slice(&[0x80, 0x00, 0x00, 34]);

    let block_size: u16 = 4096;
    out_bytes.extend_from_slice(&block_size.to_be_bytes()); // min block size
    out_bytes.extend_from_slice(&block_size.to_be_bytes()); // max block size
    out_bytes.extend_from_slice(&[0x00, 0x00, 0x00]); // min frame size (0 = unknown)
    out_bytes.extend_from_slice(&[0x00, 0x00, 0x00]); // max frame size (0 = unknown)

    // 20 bits sample rate (48000 = 0x0BB80), 3 bits channels-1 (0), 5 bits bps-1 (15 = 0x0F), 36 bits total samples
    let sr: u64 = 48000;
    let ch_minus_1: u64 = 0;
    let bps_minus_1: u64 = 15;
    let total_samples: u64 = (pcm_samples.len() as u64) & 0x0F_FFFF_FFFF;
    let packed_64: u64 = (sr << 44) | (ch_minus_1 << 41) | (bps_minus_1 << 36) | total_samples;
    out_bytes.extend_from_slice(&packed_64.to_be_bytes());
    out_bytes.extend_from_slice(&md5_digest.0);

    // 3. Encode frames of up to 4096 samples
    let mut frame_Bytes = Vec::with_capacity(8224);
    for (frame_idx, chunk) in pcm_samples.chunks(4096).enumerate() {
        frame_Bytes.clear();
        // Sync code 0b11111111111110 + reserved(0) + blocking_strategy(0 = fixed-blocksize)
        frame_Bytes.push(0xFF);
        frame_Bytes.push(0xF8);

        let is_standard_4096 = chunk.len() == 4096;
        // Block size bits: 0b1100 (4096) or 0b0111 (16-bit block_size-1 at end of header)
        // Sample rate bits: 0b1010 (48 kHz)
        if is_standard_4096 {
            frame_Bytes.push(0xCA); // 0b1100_1010
        } else {
            frame_Bytes.push(0x7A); // 0b0111_1010
        }

        // Channel assignment: 0b0000 (1 channel mono), Sample size: 0b100 (16 bits), Reserved: 0
        frame_Bytes.push(0x08);

        encode_flac_utf8_u64(frame_idx as u64, &mut frame_Bytes);

        if !is_standard_4096 {
            let bs_minus_1 = (chunk.len().saturating_sub(1)) as u16;
            frame_Bytes.extend_from_slice(&bs_minus_1.to_be_bytes());
        }

        let crc8 = flac_crc8(&frame_Bytes);
        frame_Bytes.push(crc8);

        // Check if all samples in chunk are identical (e.g. silence)
        let first_sample = chunk[0];
        let is_constant = chunk.iter().all(|&s| s == first_sample);
        if is_constant {
            // SUBFRAME_CONSTANT: pad(0) + type(000000) + wasted(0) = 0x00
            frame_Bytes.push(0x00);
            frame_Bytes.extend_from_slice(&first_sample.to_be_bytes());
        } else {
            // SUBFRAME_VERBATIM: pad(0) + type(000001) + wasted(0) = 0x02
            frame_Bytes.push(0x02);
            for &s in chunk {
                frame_Bytes.extend_from_slice(&s.to_be_bytes());
            }
        }

        let crc16 = flac_crc16(&frame_Bytes);
        frame_Bytes.extend_from_slice(&crc16.to_be_bytes());

        out_bytes.extend_from_slice(&frame_Bytes);
    }

    fs::write(out_file, &out_bytes)
        .map_err(|e| format!("Failed to write FLAC file {}: {}", out_file.display(), e))?;
    Ok(())
}

pub fn render_segments_to_wav_pure_rust(
    segments: &[ExportSegmentData],
    out_file: &Path,
    bit_depth: &str,
    normalize: bool,
    target_lufs: f64,
    max_peak_db: f64,
    fixed_duration: Option<f64>,
) -> Result<(), String> {
    let sample_rate = 48000usize;
    let out_hint = out_file.to_string_lossy().to_string();
    let mix_buf = mix_segments_to_mono_48k_pure_rust(
        segments,
        normalize,
        target_lufs,
        max_peak_db,
        "lufs",
        fixed_duration,
        None,
        Some(&out_hint),
    );

    if let Some(parent) = out_file.parent() {
        if !parent.exists() {
            let _ = fs::create_dir_all(parent);
        }
    }

    match bit_depth {
        "32float" | "32" => {
            let spec = WavSpec {
                channels: 1,
                sample_rate: sample_rate as u32,
                bits_per_sample: 32,
                sample_format: SampleFormat::Float,
            };
            let mut writer = WavWriter::create(out_file, spec).map_err(|e| e.to_string())?;
            for s in mix_buf {
                writer.write_sample(s.clamp(-1.0, 1.0)).map_err(|e| e.to_string())?;
            }
            writer.finalize().map_err(|e| e.to_string())?;
        }
        "24" => {
            let spec = WavSpec {
                channels: 1,
                sample_rate: sample_rate as u32,
                bits_per_sample: 24,
                sample_format: SampleFormat::Int,
            };
            let mut writer = WavWriter::create(out_file, spec).map_err(|e| e.to_string())?;
            for s in mix_buf {
                let v = (s.clamp(-1.0, 1.0) * 8_388_607.0) as i32;
                writer.write_sample(v).map_err(|e| e.to_string())?;
            }
            writer.finalize().map_err(|e| e.to_string())?;
        }
        _ => {
            let spec = WavSpec {
                channels: 1,
                sample_rate: sample_rate as u32,
                bits_per_sample: 16,
                sample_format: SampleFormat::Int,
            };
            let mut writer = WavWriter::create(out_file, spec).map_err(|e| e.to_string())?;
            for s in mix_buf {
                let v = (s.clamp(-1.0, 1.0) * 32_767.0) as i16;
                writer.write_sample(v).map_err(|e| e.to_string())?;
            }
            writer.finalize().map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn export_stems(
    app_handle: AppHandle,
    project_json: String,
    options: StemOptions,
) -> Result<(), String> {
    let project: ExportProjectData = serde_json::from_str(&project_json)
        .map_err(|e| format!("Failed to parse project JSON: {}", e))?;

    let output_dir = Path::new(&options.output_dir);
    if !output_dir.exists() {
        fs::create_dir_all(output_dir).map_err(|e| e.to_string())?;
    }

    let encoder = match options.bit_depth.as_str() {
        "24" => "pcm_s24le",
        "32float" => "pcm_f32le",
        _ => "pcm_s16le",
    };

    let total_tracks = project.tracks.len();
    let semaphore = Arc::new(Semaphore::new(
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)
    ));

    let mut handles = Vec::new();

    let norm_clone = options.normalize;
    let lufs_clone = options.target_lufs;
    let peak_clone = options.max_peak;
    let project_path_hint = project.project_path.clone();

    for (i, track) in project.tracks.into_iter().enumerate() {
        let sem_clone = Arc::clone(&semaphore);
        let app_clone = app_handle.clone();
        let enc_clone = encoder.to_string();
        let out_dir_clone = output_dir.to_path_buf();
        let track_idx = i + 1;
        let norm_enabled = norm_clone.unwrap_or(false);
        let target_lufs_val = lufs_clone.unwrap_or(-20.0).clamp(-70.0, -5.0);
        let max_peak_val = peak_clone.unwrap_or(-9.0).clamp(-9.0, 0.0);
        let proj_hint_clone = project_path_hint.clone();

        let handle = tokio::spawn(async move {
            let _permit = sem_clone.acquire().await.map_err(|e| e.to_string())?;

            let sanitized_name = track.name.replace(|c: char| !c.is_alphanumeric(), "_");
            let file_name = format!("{:02}_{}.wav", track_idx, sanitized_name);
            let out_file = out_dir_clone.join(file_name);
            let out_dir_str = out_dir_clone.to_string_lossy().to_string();

            let _ = app_clone.emit("stem-progress", StemProgress {
                current: track_idx,
                total: total_tracks,
                track_name: track.name.clone(),
            });

            let mut valid_segments: Vec<ExportSegmentData> = Vec::new();
            for seg in &track.segments {
                if let Some(ref raw_p) = seg.file_path {
                    if !raw_p.is_empty() {
                        let resolved = crate::file_io::resolve_existing_media_path(
                            raw_p,
                            proj_hint_clone.as_deref(),
                            Some(&out_dir_str),
                            &[],
                        );
                        if resolved.exists() {
                            let mut cloned = seg.clone();
                            cloned.file_path = Some(resolved.to_string_lossy().to_string());
                            valid_segments.push(cloned);
                        }
                    }
                }
            }

            if valid_segments.is_empty() {
                return Ok::<(), String>(());
            }

            let depth = match enc_clone.as_str() {
                "pcm_s24le" => "24",
                "pcm_f32le" => "32float",
                _ => "16",
            };

            // Use pure-Rust stem renderer first if all segments are WAV, or FFmpeg with pure-Rust fallback
            let all_wav = valid_segments.iter().all(|s| {
                s.file_path
                    .as_ref()
                    .map(|p| p.to_lowercase().ends_with(".wav"))
                    .unwrap_or(false)
            });

            if all_wav || !crate::is_ffmpeg_available() {
                render_segments_to_wav_pure_rust(
                    &valid_segments,
                    &out_file,
                    depth,
                    norm_enabled,
                    target_lufs_val,
                    max_peak_val,
                    None,
                )?;
                return Ok(());
            }

            let mut cmd = new_ffmpeg_command();
            cmd.arg("-nostdin");
            cmd.arg("-y");

            for seg in &valid_segments {
                cmd.arg("-i").arg(seg.file_path.as_ref().unwrap());
            }

            let mut filter = String::new();
            for (idx, seg) in valid_segments.iter().enumerate() {
                let delay_ms = (seg.start_time * 1000.0) as i64;
                let playback_rate = seg.playback_rate.unwrap_or(1.0);
                filter.push_str(&format!(
                    "[{}:a]atrim=start={}:duration={},asetpts=PTS-STARTPTS",
                    idx, seg.file_offset, seg.duration * playback_rate
                ));
                if (playback_rate - 1.0).abs() > 0.001 {
                    filter.push_str(&format!(",atempo={}", playback_rate));
                }
                filter.push_str(&format!(",volume={},adelay={}|{}[a{}];", seg.gain, delay_ms, delay_ms, idx));
            }

            for idx in 0..valid_segments.len() {
                filter.push_str(&format!("[a{}]", idx));
            }
            filter.push_str(&format!(
                "amix=inputs={}:duration=longest:dropout_transition=0:normalize=0",
                valid_segments.len()
            ));

            if norm_enabled {
                filter.push_str(&format!(",loudnorm=I={:.1}:TP={:.1}:LRA=11", target_lufs_val, max_peak_val));
            }

            cmd.arg("-filter_complex").arg(filter);
            cmd.arg("-c:a").arg(&enc_clone);
            cmd.arg(out_file.to_string_lossy().to_string());

            match cmd.output().await {
                Ok(status) if status.status.success() => {}
                _ => {
                    render_segments_to_wav_pure_rust(
                        &valid_segments,
                        &out_file,
                        depth,
                        norm_enabled,
                        target_lufs_val,
                        max_peak_val,
                        None,
                    )?;
                }
            }

            Ok(())
        });

        handles.push(handle);
    }

    for h in handles {
        h.await.map_err(|e| e.to_string())??;
    }

    Ok(())
}

/// Discovers orphaned `take_*.wav` files in `takes/` directories near `project_path` or `output_path`
/// when a project's segments list became empty or had stale paths after moving folders.
fn discover_orphaned_takes(project_path_hint: Option<&str>, output_path_hint: Option<&str>) -> Vec<ExportSegmentData> {
    let mut candidate_takes_dirs = Vec::new();
    if let Some(proj) = project_path_hint {
        let p = PathBuf::from(proj);
        candidate_takes_dirs.push(p.join("takes"));
        if let Some(parent) = p.parent() {
            candidate_takes_dirs.push(parent.join("takes"));
        }
    }
    if let Some(out) = output_path_hint {
        let out_p = PathBuf::from(out);
        let base_dir = if out_p.extension().is_some() {
            out_p.parent().map(|p| p.to_path_buf()).unwrap_or(out_p)
        } else {
            out_p
        };
        let mut curr: Option<&Path> = Some(base_dir.as_path());
        for _ in 0..3 {
            if let Some(dir) = curr {
                candidate_takes_dirs.push(dir.join("takes"));
                if let Ok(entries) = fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let ep = entry.path();
                        if ep.is_dir() {
                            candidate_takes_dirs.push(ep.join("takes"));
                        }
                    }
                }
                curr = dir.parent();
            } else {
                break;
            }
        }
    }

    let mut found_files: Vec<(u128, PathBuf)> = Vec::new();
    for takes_dir in candidate_takes_dirs {
        if takes_dir.exists() && takes_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&takes_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_file() {
                        continue;
                    }
                    let fname = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if !fname.to_lowercase().ends_with(".wav") || fname == "original_audio.wav" {
                        continue;
                    }
                    if !fname.starts_with("take_") {
                        continue;
                    }
                    let stem = fname.trim_end_matches(".wav").trim_end_matches(".WAV");
                    let parts: Vec<&str> = stem.split('_').collect();
                    let epoch = parts
                        .last()
                        .and_then(|s| s.parse::<u128>().ok())
                        .or_else(|| parts.get(1).and_then(|s| s.parse::<u128>().ok()))
                        .unwrap_or(0);
                    found_files.push((epoch, path));
                }
            }
            if !found_files.is_empty() {
                break;
            }
        }
    }

    found_files.sort_by_key(|(epoch, _)| *epoch);
    let mut recovered = Vec::new();
    let mut cursor = 0.0f64;
    for (idx, (_, wav_path)) in found_files.into_iter().enumerate() {
        let mut dur = 2.5f64;
        if let Ok(reader) = WavReader::open(&wav_path) {
            let spec = reader.spec();
            if spec.sample_rate > 0 && spec.channels > 0 {
                let d = (reader.duration() as f64) / (spec.sample_rate as f64);
                if d.is_finite() && d > 0.05 {
                    dur = d;
                }
            }
        }
        recovered.push(ExportSegmentData {
            id: format!("recovered_{}", idx),
            start_time: cursor,
            duration: dur,
            file_path: Some(wav_path.to_string_lossy().to_string().replace('\\', "/")),
            gain: 1.0,
            file_offset: 0.0,
            file_duration: dur,
            playback_rate: Some(1.0),
        });
        cursor += dur + 0.35;
    }
    recovered
}

#[tauri::command]
pub async fn export_audio(
    app_handle: AppHandle,
    project_json: String,
    output_path: String,
    format: String, // "wav", "mp3", "flac"
    bit_depth: Option<String>, // e.g., "16", "24"
    bitrate: Option<String>, // e.g., "320k"
    force_mono: Option<bool>,
    normalize: Option<bool>,
    target_lufs: Option<f64>,
    max_peak: Option<f64>,
    normalization_mode: Option<String>,
) -> Result<(), String> {
    let project: ExportProjectData = serde_json::from_str(&project_json)
        .map_err(|e| format!("Failed to parse project JSON: {}", e))?;

    let any_solo = project.tracks.iter().any(|t| t.is_solo.unwrap_or(false));
    let project_path_hint = project.project_path.as_deref();

    let mut raw_segments = Vec::new();
    for track in &project.tracks {
        if any_solo {
            if !track.is_solo.unwrap_or(false) {
                continue;
            }
        } else if track.is_muted.unwrap_or(false) {
            continue;
        }

        let track_vol = track.volume.unwrap_or(1.0);
        let safe_track_vol = if track_vol > 0.0 { track_vol } else { 1.0 };

        for segment in &track.segments {
            if let Some(ref p) = segment.file_path {
                if !p.is_empty() {
                    let mut seg_clone = segment.clone();
                    let seg_gain = if seg_clone.gain > 0.0 { seg_clone.gain } else { 1.0 };
                    seg_clone.gain = seg_gain * safe_track_vol;
                    raw_segments.push(seg_clone);
                }
            }
        }
    }

    // Resolve moved file paths across project folder, output folder, and sibling *_Project folders
    let mut all_segments = Vec::new();
    for mut seg in raw_segments {
        if let Some(ref raw_path) = seg.file_path {
            let resolved = crate::file_io::resolve_existing_media_path(
                raw_path,
                project_path_hint,
                Some(&output_path),
                &[],
            );
            if resolved.exists() {
                seg.file_path = Some(resolved.to_string_lossy().to_string());
                all_segments.push(seg);
            } else {
                println!(
                    "[export_audio] Warning: Segment file not found even after path resolution, skipping: {}",
                    raw_path
                );
            }
        }
    }

    // If all segments were missing or empty (e.g., user moved folder and .dub lost track links),
    // try recovering takes from takes/ folder automatically
    if all_segments.is_empty() {
        let recovered = discover_orphaned_takes(project_path_hint, Some(&output_path));
        if !recovered.is_empty() {
            println!(
                "[export_audio] Auto-recovered {} takes from takes/ directory for export",
                recovered.len()
            );
            all_segments = recovered;
        }
    }

    if all_segments.is_empty() {
        return Err(
            "Не найдено аудиофайлов дублей для экспорта (возможно, папка проекта была перемещена без папки takes или все дорожки заглушены)."
                .to_string(),
        );
    }

    let fmt_lower = format.to_lowercase();
    let norm_enabled = normalize.unwrap_or(false);
    let target_lufs_val = target_lufs.unwrap_or(-20.0).clamp(-70.0, -5.0);
    let max_peak_val = max_peak.unwrap_or(-9.0);
    let norm_mode = normalization_mode.clone().unwrap_or_else(|| "lufs".to_string());
    let depth = bit_depth.clone().unwrap_or_else(|| "16".to_string());

    let _ = app_handle.emit("export-progress", 15.0);

    // Check if any segment is non-WAV (e.g. MP3/OGG imported onto track) and needs FFmpeg decoding to WAV first
    let temp_dir = env::temp_dir().join(format!("dubstudio_export_{}", std::process::id()));
    let mut created_temp_dir = false;

    for (idx, seg) in all_segments.iter_mut().enumerate() {
        let Some(ref seg_path) = seg.file_path else { continue };
        let is_readable_wav = WavReader::open(seg_path).is_ok();
        if !is_readable_wav && crate::is_ffmpeg_available() {
            if !created_temp_dir {
                let _ = fs::create_dir_all(&temp_dir);
                created_temp_dir = true;
            }
            let decoded_wav = temp_dir.join(format!("decoded_{}.wav", idx));
            let decoded_str = decoded_wav.to_string_lossy().to_string();
            let status = new_ffmpeg_command()
                .args([
                    "-nostdin",
                    "-y",
                    "-i",
                    seg_path,
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "48000",
                    "-c:a",
                    "pcm_s16le",
                    &decoded_str,
                ])
                .output()
                .await;
            if let Ok(out) = status {
                if out.status.success() && decoded_wav.exists() {
                    seg.file_path = Some(decoded_str);
                }
            }
        }
    }

    let _ = app_handle.emit("export-progress", 45.0);

    // Mix all segments in memory at 48kHz with EBU R128 / Peak normalization
    let mixed_samples = mix_segments_to_mono_48k_pure_rust(
        &all_segments,
        norm_enabled,
        target_lufs_val,
        max_peak_val,
        &norm_mode,
        None,
        project_path_hint,
        Some(&output_path),
    );

    let _ = app_handle.emit("export-progress", 75.0);

    let out_path_ref = Path::new(&output_path);
    if let Some(parent) = out_path_ref.parent() {
        if !parent.exists() {
            let _ = fs::create_dir_all(parent);
        }
    }

    match fmt_lower.as_str() {
        "wav" => {
            // Write final WAV directly via hound (16, 24, or 32-bit float)
            match depth.as_str() {
                "32float" | "32" => {
                    let spec = WavSpec {
                        channels: 1,
                        sample_rate: 48000,
                        bits_per_sample: 32,
                        sample_format: SampleFormat::Float,
                    };
                    let mut writer = WavWriter::create(out_path_ref, spec).map_err(|e| e.to_string())?;
                    for s in &mixed_samples {
                        writer.write_sample(s.clamp(-1.0, 1.0)).map_err(|e| e.to_string())?;
                    }
                    writer.finalize().map_err(|e| e.to_string())?;
                }
                "24" => {
                    let spec = WavSpec {
                        channels: 1,
                        sample_rate: 48000,
                        bits_per_sample: 24,
                        sample_format: SampleFormat::Int,
                    };
                    let mut writer = WavWriter::create(out_path_ref, spec).map_err(|e| e.to_string())?;
                    for s in &mixed_samples {
                        let v = (s.clamp(-1.0, 1.0) * 8_388_607.0) as i32;
                        writer.write_sample(v).map_err(|e| e.to_string())?;
                    }
                    writer.finalize().map_err(|e| e.to_string())?;
                }
                _ => {
                    let spec = WavSpec {
                        channels: 1,
                        sample_rate: 48000,
                        bits_per_sample: 16,
                        sample_format: SampleFormat::Int,
                    };
                    let mut writer = WavWriter::create(out_path_ref, spec).map_err(|e| e.to_string())?;
                    for s in &mixed_samples {
                        let v = (s.clamp(-1.0, 1.0) * 32_767.0) as i16;
                        writer.write_sample(v).map_err(|e| e.to_string())?;
                    }
                    writer.finalize().map_err(|e| e.to_string())?;
                }
            }
        }
        "flac" => {
            // Try FFmpeg FLAC compression first if available; otherwise (or on any FFmpeg error)
            // automatically fall back to pure-Rust lossless FLAC encoding!
            let mut encoded_via_ffmpeg = false;
            if crate::is_ffmpeg_available() {
                if !created_temp_dir {
                    let _ = fs::create_dir_all(&temp_dir);
                    created_temp_dir = true;
                }
                let combined_wav = temp_dir.join("combined_mix.wav");
                let spec = WavSpec {
                    channels: 1,
                    sample_rate: 48000,
                    bits_per_sample: 16,
                    sample_format: SampleFormat::Int,
                };
                if let Ok(mut writer) = WavWriter::create(&combined_wav, spec) {
                    for s in &mixed_samples {
                        let v = (s.clamp(-1.0, 1.0) * 32_767.0) as i16;
                        let _ = writer.write_sample(v);
                    }
                    if writer.finalize().is_ok() {
                        let mut cmd = new_ffmpeg_command();
                        cmd.arg("-nostdin")
                            .arg("-y")
                            .arg("-i")
                            .arg(combined_wav.to_string_lossy().to_string());
                        if force_mono.unwrap_or(false) {
                            cmd.arg("-ac").arg("1");
                        }
                        cmd.arg("-c:a").arg("flac").arg(&output_path);
                        if let Ok(out) = cmd.output().await {
                            if out.status.success() && out_path_ref.exists() {
                                encoded_via_ffmpeg = true;
                            }
                        }
                    }
                }
            }

            if !encoded_via_ffmpeg {
                println!("[export_audio] Encoding FLAC via built-in pure-Rust FLAC encoder: {}", output_path);
                write_flac_mono_16bit_pure_rust(&mixed_samples, out_path_ref)?;
            }
        }
        "mp3" => {
            if !created_temp_dir {
                let _ = fs::create_dir_all(&temp_dir);
                created_temp_dir = true;
            }
            let combined_wav = temp_dir.join("combined_mix.wav");
            let spec = WavSpec {
                channels: 1,
                sample_rate: 48000,
                bits_per_sample: 16,
                sample_format: SampleFormat::Int,
            };
            let mut writer = WavWriter::create(&combined_wav, spec).map_err(|e| e.to_string())?;
            for s in &mixed_samples {
                let v = (s.clamp(-1.0, 1.0) * 32_767.0) as i16;
                writer.write_sample(v).map_err(|e| e.to_string())?;
            }
            writer.finalize().map_err(|e| e.to_string())?;

            let mut cmd = new_ffmpeg_command();
            cmd.arg("-nostdin")
                .arg("-y")
                .arg("-i")
                .arg(combined_wav.to_string_lossy().to_string())
                .arg("-c:a")
                .arg("libmp3lame")
                .arg("-b:a")
                .arg(bitrate.unwrap_or_else(|| "320k".to_string()))
                .arg(&output_path);

            match cmd.output().await {
                Ok(out) if out.status.success() => {}
                Ok(out) => {
                    let _ = fs::remove_dir_all(&temp_dir);
                    return Err(format!(
                        "FFmpeg MP3 encoding error: {}",
                        String::from_utf8_lossy(&out.stderr)
                    ));
                }
                Err(e) => {
                    let _ = fs::remove_dir_all(&temp_dir);
                    return Err(format!(
                        "Не удалось запустить FFmpeg для кодирования MP3 ({}). Пожалуйста, используйте формат WAV или FLAC (они работают автономно без FFmpeg).",
                        e
                    ));
                }
            }
        }
        _ => {
            write_flac_mono_16bit_pure_rust(&mixed_samples, out_path_ref)?;
        }
    }

    if created_temp_dir {
        let _ = fs::remove_dir_all(&temp_dir);
    }

    let _ = app_handle.emit("export-progress", 100.0);

    Ok(())
}

#[tauri::command]
pub async fn quick_preview_export(
    _app_handle: AppHandle,
    state: State<'_, AppState>,
    project_path: String,
    segment_id: String,
) -> Result<String, String> {
    let mutex = state.db.lock().await;
    let pool = mutex.as_ref().ok_or("Database not initialized")?;

    let row = sqlx::query("SELECT file_path FROM segments WHERE id = ?")
        .bind(&segment_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Segment not found in DB: {}", e))?;

    let file_path: Option<String> = row.get("file_path");
    let src_str = file_path.ok_or("Segment has no file path")?;
    let src = crate::file_io::resolve_existing_media_path(&src_str, Some(&project_path), None, &[]);
    
    if !src.exists() {
        return Err(format!("Source file does not exist: {}", src_str));
    }

    let dest = Path::new(&project_path).join(format!("preview_{}.wav", segment_id));
    fs::copy(&src, &dest).map_err(|e| format!("Failed to copy segment: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

#[derive(Deserialize, Debug, Clone)]
pub struct BatchOrigSegment {
    #[serde(rename = "startTime")]
    pub start_time: f64,
    pub duration: f64,
    #[serde(rename = "originalFileName")]
    pub original_file_name: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct BatchDubSegment {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "startTime")]
    pub start_time: f64,
    pub duration: f64,
    #[serde(rename = "fileOffset")]
    pub file_offset: f64,
    pub gain: f64,
    #[serde(rename = "playbackRate")]
    pub playback_rate: f64,
}

#[tauri::command]
pub async fn batch_export(
    app_handle: AppHandle,
    out_dir: String,
    orig_segments: Vec<BatchOrigSegment>,
    dub_segments: Vec<BatchDubSegment>,
) -> Result<Vec<String>, String> {
    let export_dir = Path::new(&out_dir);
    if !export_dir.exists() {
        fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;
    }

    let total_tasks = orig_segments.len();
    if total_tasks == 0 {
        return Ok(Vec::new());
    }

    let resolved_dubs: Vec<BatchDubSegment> = dub_segments
        .into_iter()
        .filter_map(|mut d| {
            let resolved = crate::file_io::resolve_existing_media_path(&d.file_path, None, Some(&out_dir), &[]);
            if resolved.exists() {
                d.file_path = resolved.to_string_lossy().to_string();
                Some(d)
            } else {
                None
            }
        })
        .collect();

    let mut exported_paths = Vec::new();

    // Spawn parallel processes using a bounded semaphore
    let max_concurrent = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let semaphore = Arc::new(Semaphore::new(max_concurrent));

    let mut handles = Vec::new();

    for orig_seg in orig_segments {
        let sem_clone = Arc::clone(&semaphore);
        let out_dir_clone = export_dir.to_path_buf();
        let dubs_clone = resolved_dubs.clone();

        let handle = tokio::spawn(async move {
            let _permit = sem_clone.acquire().await.map_err(|e| e.to_string())?;

            let mut final_name = orig_seg.original_file_name.clone();
            // Clean filename and ensure wav extension
            if !final_name.to_lowercase().ends_with(".wav") {
                final_name.push_str(".wav");
            }
            let out_file = out_dir_clone.join(&final_name);

            let t_start = orig_seg.start_time;
            let t_end = t_start + orig_seg.duration;

            // 1. Filter overlapping dubs
            let mut overlaps = Vec::new();
            for dub in dubs_clone {
                let dub_end = dub.start_time + dub.duration;
                if dub.start_time < t_end && dub_end > t_start {
                    overlaps.push(dub);
                }
            }

            // 2. Build and run FFmpeg command for this replica
            let mut cmd = new_ffmpeg_command();
            cmd.arg("-nostdin");
            cmd.arg("-y");

            // Base silence input
            cmd.arg("-f").arg("lavfi")
               .arg("-i").arg(format!("anullsrc=r=48000:cl=mono:d={:.4}", orig_seg.duration));

            // Overlapping segments
            for dub in &overlaps {
                cmd.arg("-i").arg(&dub.file_path);
            }

            // Build filter_complex
            let mut filter = "[0:a]asetpts=PTS-STARTPTS[a0];".to_string();

            for (j, dub) in overlaps.iter().enumerate() {
                let in_idx = j + 1; // 0 is silence
                let overlap_start = t_start.max(dub.start_time);
                let overlap_end = t_end.min(dub.start_time + dub.duration);
                let overlap_dur = overlap_end - overlap_start;

                if overlap_dur <= 0.0 {
                    continue;
                }

                // Calculate trimming params inside the audio file
                let file_offset_delta = (overlap_start - dub.start_time) * dub.playback_rate;
                let trim_start = dub.file_offset + file_offset_delta;
                let trim_duration = overlap_dur * dub.playback_rate;

                let delay_ms = ((overlap_start - t_start) * 1000.0).round() as i64;

                filter.push_str(&format!(
                    "[{}:a]atrim=start={:.4}:duration={:.4},asetpts=PTS-STARTPTS",
                    in_idx, trim_start, trim_duration
                ));

                if (dub.playback_rate - 1.0).abs() > 0.001 {
                    filter.push_str(&format!(",atempo={:.4}", dub.playback_rate));
                }

                filter.push_str(&format!(
                    ",volume={:.4},adelay={}|{}[a{}];",
                    dub.gain, delay_ms, delay_ms, in_idx
                ));
            }

            for j in 0..=overlaps.len() {
                filter.push_str(&format!("[a{}]", j));
            }
            filter.push_str(&format!(
                "amix=inputs={}:duration=longest:dropout_transition=0:normalize=0",
                overlaps.len() + 1
            ));

            let out_file_str = out_file.to_string_lossy().to_string();
            cmd.arg("-filter_complex").arg(filter);
            cmd.arg("-t").arg(format!("{:.4}", orig_seg.duration));
            cmd.arg("-c:a").arg("pcm_s16le");
            cmd.arg(&out_file_str);

            match cmd.output().await {
                Ok(output) if output.status.success() => {}
                _ => {
                    let mut fallback_segs = Vec::new();
                    for dub in &overlaps {
                        let overlap_start = t_start.max(dub.start_time);
                        let overlap_end = t_end.min(dub.start_time + dub.duration);
                        let overlap_dur = overlap_end - overlap_start;
                        if overlap_dur <= 0.0 {
                            continue;
                        }
                        let file_offset_delta = (overlap_start - dub.start_time) * dub.playback_rate;
                        fallback_segs.push(ExportSegmentData {
                            id: String::new(),
                            start_time: (overlap_start - t_start).max(0.0),
                            duration: overlap_dur,
                            file_path: Some(dub.file_path.clone()),
                            gain: dub.gain,
                            file_offset: dub.file_offset + file_offset_delta,
                            file_duration: overlap_dur,
                            playback_rate: Some(dub.playback_rate),
                        });
                    }
                    render_segments_to_wav_pure_rust(
                        &fallback_segs,
                        &out_file,
                        "16",
                        false,
                        -20.0,
                        -1.0,
                        Some(orig_seg.duration),
                    )?;
                }
            }

            Ok::<String, String>(out_file_str)
        });

        handles.push(handle);
    }

    let mut errors = Vec::new();
    let mut completed = 0;

    for h in handles {
        match h.await {
            Ok(Ok(path)) => {
                exported_paths.push(path);
            },
            Ok(Err(e)) => {
                errors.push(e);
            },
            Err(e) => {
                errors.push(e.to_string());
            }
        }
        completed += 1;
        let pct = (completed as f64 / total_tasks as f64) * 100.0;
        let _ = app_handle.emit("export-progress", pct);
    }

    if !errors.is_empty() {
        return Err(format!("Some replicas failed to render:\n{}", errors.join("\n")));
    }

    Ok(exported_paths)
}

#[derive(Deserialize)]
pub struct AudioBookSegmentData {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[allow(dead_code)]
    pub gain: f64,
}

#[tauri::command]
pub async fn export_audio_book(
    app_handle: AppHandle,
    project_path: String,
    output_path: String,
    format: Option<String>,
    gap_duration: Option<f64>,
    normalize_lufs: Option<bool>,
    segments: Vec<AudioBookSegmentData>,
) -> Result<String, String> {
    let temp_dir = env::temp_dir().join(format!("audiobook_export_{}", std::process::id()));
    if temp_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
    }
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let gap = gap_duration.unwrap_or(1.5);
    let mut inputs = Vec::new();

    // Prepare inputs (resolving moved files automatically)
    for (_i, seg) in segments.iter().enumerate() {
        if !seg.file_path.is_empty() {
            let resolved = crate::file_io::resolve_existing_media_path(
                &seg.file_path,
                Some(&project_path),
                Some(&output_path),
                &[],
            );
            if resolved.exists() {
                inputs.push((resolved.to_string_lossy().to_string(), seg.gain));
            }
        }
    }

    if inputs.is_empty() {
        return Err("No segments to export".to_string());
    }

    let final_format = format.unwrap_or_else(|| "wav".to_string()).to_lowercase();
    let mut final_output_path = output_path.clone();
    
    // If output_path is just a filename, put it in project_path
    let p = Path::new(&output_path);
    if p.parent() == Some(Path::new("")) {
        final_output_path = Path::new(&project_path).join(output_path).to_string_lossy().to_string();
    }

    // Build sequential segments list for pure-Rust fallback or direct render
    let mut sequential_segs = Vec::new();
    let mut cursor = 0.0f64;
    for (idx, (path, gain)) in inputs.iter().enumerate() {
        let mut dur = 2.0f64;
        if let Ok(reader) = WavReader::open(path) {
            let sr = reader.spec().sample_rate.max(1) as f64;
            dur = (reader.duration() as f64) / sr;
        }
        sequential_segs.push(ExportSegmentData {
            id: format!("ab_{}", idx),
            start_time: cursor,
            duration: dur,
            file_path: Some(path.clone()),
            gain: if *gain > 0.0 { *gain } else { 1.0 },
            file_offset: 0.0,
            file_duration: dur,
            playback_rate: Some(1.0),
        });
        cursor += dur + gap;
    }

    if !crate::is_ffmpeg_available() {
        let samples = mix_segments_to_mono_48k_pure_rust(
            &sequential_segs,
            normalize_lufs.unwrap_or(false),
            -16.0,
            -1.5,
            "lufs",
            Some(cursor),
            Some(&project_path),
            Some(&final_output_path),
        );
        if final_format == "flac" {
            write_flac_mono_16bit_pure_rust(&samples, Path::new(&final_output_path))?;
        } else {
            render_segments_to_wav_pure_rust(
                &sequential_segs,
                Path::new(&final_output_path),
                "16",
                normalize_lufs.unwrap_or(false),
                -16.0,
                -1.5,
                Some(cursor),
            )?;
        }
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = app_handle.emit("export-progress", 100.0);
        return Ok(final_output_path);
    }

    let mut args = vec!["-y".to_string()];

    // We use a complex filter to generate silences and concat
    let mut filter_complex = String::new();
    let mut inputs_str = String::new();
    
    for (i, (path, _)) in inputs.iter().enumerate() {
        args.push("-i".to_string());
        args.push(path.clone());
        let silence_label = format!("s{}", i);
        filter_complex.push_str(&format!("anullsrc=r=48000:cl=mono:d={} [{}];", gap, silence_label));
        inputs_str.push_str(&format!("[{}:a][{}]", i, silence_label));
    }

    let concat_count = inputs.len() * 2;
    filter_complex.push_str(&format!("{} concat=n={}:v=0:a=1 [out_a]", inputs_str, concat_count));

    args.push("-filter_complex".to_string());
    args.push(filter_complex);
    args.push("-map".to_string());
    args.push("[out_a]".to_string());

    if normalize_lufs.unwrap_or(false) {
        args.push("-af".to_string());
        args.push("loudnorm=I=-16:TP=-1.5:LRA=11".to_string());
    }

    args.push(final_output_path.clone());

    let total_duration = cursor.max(1.0);

    if let Err(_e) = crate::media_processor::run_ffmpeg_with_progress(
        app_handle.clone(), 
        args, 
        "Exporting Audio Book".to_string(), 
        Some(total_duration)
    ).await {
        render_segments_to_wav_pure_rust(
            &sequential_segs,
            Path::new(&final_output_path),
            "16",
            normalize_lufs.unwrap_or(false),
            -16.0,
            -1.5,
            Some(cursor),
        )?;
        let _ = app_handle.emit("export-progress", 100.0);
    }

    let _ = fs::remove_dir_all(&temp_dir);

    Ok(final_output_path)
}

use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};

#[tauri::command]
pub async fn export_backstage_video(
    app_handle: AppHandle,
    main_video_path: String,
    backstage_video_path: String,
    final_audio_path: String,
    output_path: String,
    webcam_export_overlay: Option<bool>,
) -> Result<String, String> {
    println!("[export_backstage_video] Начало. main: {}, backstage: {}, audio: {}, output: {}, overlay: {:?}", main_video_path, backstage_video_path, final_audio_path, output_path, webcam_export_overlay);
    let mut cmd = new_ffmpeg_command();
    cmd.arg("-nostdin");
    
    let is_overlay = webcam_export_overlay.unwrap_or(true);
    
    if is_overlay {
        cmd.args(&[
            "-y",
            "-i", &main_video_path,
            "-i", &backstage_video_path,
            "-i", &final_audio_path,
            "-filter_complex", "[1:v]scale=320:-1[bg]; [0:v][bg]overlay=W-w-10:H-h-10[out_v]",
            "-map", "[out_v]",
            "-map", "2:a",
            "-c:v", "libx264",
            "-c:a", "aac",
            &output_path,
        ]);
    } else {
        cmd.args(&[
            "-y",
            "-i", &backstage_video_path,
            "-i", &final_audio_path,
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac",
            &output_path,
        ]);
    }

    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;
    
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr).lines();
        let re_res = regex::Regex::new(r"time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})");

        let app_handle_clone = app_handle.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                if let Ok(ref re) = re_res {
                    if let Some(caps) = re.captures(&line) {
                        let _ = app_handle_clone.emit("export-progress", serde_json::json!({
                            "operation": "Exporting Backstage Video",
                            "time": caps[0].to_string()
                        }));
                    }
                }
            }
        });
    }

    println!("[export_backstage_video] Запуск FFmpeg. Ждем завершения...");
    let status = child.wait().await.map_err(|e| e.to_string())?;
    println!("[export_backstage_video] FFmpeg завершил работу. Exit status: {}", status);
    
    if !status.success() {
        eprintln!("[export_backstage_video] FFmpeg execution failed");
        return Err("FFmpeg execution failed".to_string());
    }

    println!("[export_backstage_video] Успешное завершение. Файл сохранен в: {}", output_path);
    Ok(output_path)
}

async fn get_volume_stats(
    path: &str,
    start: Option<f64>,
    duration: Option<f64>,
) -> (Option<f64>, Option<f64>) {
    let mut cmd = new_ffmpeg_command();
    cmd.arg("-nostdin").arg("-y");
    if let Some(s) = start {
        cmd.arg("-ss").arg(format!("{:.3}", s));
    }
    if let Some(d) = duration {
        cmd.arg("-t").arg(format!("{:.3}", d));
    }
    cmd.arg("-i").arg(path);
    cmd.arg("-filter:a").arg("volumedetect");
    cmd.arg("-f").arg("null");
    cmd.arg("-");

    let mut mean_vol = None;
    let mut max_vol = None;

    if let Ok(output) = cmd.output().await {
        let stderr = String::from_utf8_lossy(&output.stderr);
        
        // Parse mean_volume
        if let Some(pos) = stderr.find("mean_volume:") {
            let sub = &stderr[pos + "mean_volume:".len()..];
            if let Some(end_pos) = sub.find("dB") {
                let val_str = sub[..end_pos].trim();
                if let Ok(val) = val_str.parse::<f64>() {
                    mean_vol = Some(val);
                }
            }
        }

        // Parse max_volume
        if let Some(pos) = stderr.find("max_volume:") {
            let sub = &stderr[pos + "max_volume:".len()..];
            if let Some(end_pos) = sub.find("dB") {
                let val_str = sub[..end_pos].trim();
                if let Ok(val) = val_str.parse::<f64>() {
                    max_vol = Some(val);
                }
            }
        }
    }

    (mean_vol, max_vol)
}

#[tauri::command]
pub async fn export_blooper(
    app_handle: tauri::AppHandle,
    video_path: String,
    audio_path: String,
    start_time: f64,
    end_time: f64,
    audio_delay: f64,
    audio_trim_start: f64,
    output_path: String,
) -> Result<String, String> {
    println!("[export_blooper] Начало. video: {}, audio: {}, start: {}, end: {}, delay: {}, trim: {}, output: {}", video_path, audio_path, start_time, end_time, audio_delay, audio_trim_start, output_path);

    let duration = end_time - start_time;
    let voice_delay_ms = (audio_delay * 1000.0).max(0.0) as i64;
    
    // Измерим среднюю и пиковую громкость оригинального аудио и записанного голоса
    let (mean_orig, _) = get_volume_stats(&video_path, Some(start_time), Some(duration)).await;
    let (mean_voice, max_voice) = get_volume_stats(&audio_path, None, None).await;

    let mean_orig_val = mean_orig.unwrap_or(-20.0);
    let mean_voice_val = mean_voice.unwrap_or(-25.0);
    let max_voice_val = max_voice.unwrap_or(0.0);

    println!("[export_blooper] Измеренная громкость: оригинал = {:.2} dB, голос (mean) = {:.2} dB, голос (max) = {:.2} dB", 
             mean_orig_val, mean_voice_val, max_voice_val);

    // Оригинальное аудио приглушается на volume=0.8.
    // Коэффициент 0.8 в децибелах: 20 * log10(0.8) ≈ -1.94 dB
    let orig_attenuation_db = 20.0 * 0.8_f64.log10();
    let mean_orig_adjusted = mean_orig_val + orig_attenuation_db;

    // Ограничиваем оригинальную громкость разумным диапазоном [-26.0, -14.0] dB для корректного баланса,
    // чтобы голос не заглушался слишком сильно на тихих участках и не орал на громких.
    let clamped_orig_mean = mean_orig_adjusted.clamp(-26.0, -14.0);

    // Голос должен быть на 3.5 dB громче оригинального источника
    let target_voice_mean = clamped_orig_mean + 3.5;
    let mut needed_gain_db = target_voice_mean - mean_voice_val;

    // Ограничения для усиления (gain)
    if needed_gain_db > 24.0 {
        needed_gain_db = 24.0;
    }
    if needed_gain_db < -12.0 {
        needed_gain_db = -12.0;
    }

    // Защита от клиппинга: пиковое значение голоса не должно превышать -1.0 dB
    let safe_gain_db = -1.0 - max_voice_val;
    if needed_gain_db > safe_gain_db {
        needed_gain_db = safe_gain_db;
    }

    // Переводим дБ в линейный коэффициент
    let voice_gain_linear = 10.0_f64.powf(needed_gain_db / 20.0);
    println!("[export_blooper] Рассчитанное усиление для голоса: {:.2} dB (линейный коэффициент: {:.3})", 
             needed_gain_db, voice_gain_linear);

    // We will use a complex filter
    // 1. Video fade in/out
    // 2. Original audio volume=0.8, afade in/out
    // 3. Voice audio atrim, dynamic volume, adelay, afade in/out
    // 4. Mix them
    
    let fade_out_start = (duration - 0.2).max(0.0);
    
    let filter_complex = format!(
        "[0:v]fade=t=in:st=0:d=0.2,fade=t=out:st={}:d=0.2[vout]; \
         [0:a]volume=0.8,afade=t=in:st=0:d=0.2,afade=t=out:st={}:d=0.2,aformat=sample_rates=48000:channel_layouts=stereo[a0]; \
         [1:a]atrim=start={:.3},asetpts=PTS-STARTPTS,volume={:.3},aformat=sample_rates=48000:channel_layouts=stereo,adelay={}|{}[a1_delayed]; \
         [a1_delayed]afade=t=in:st=0:d=0.2,afade=t=out:st={}:d=0.2[a1]; \
         [a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]",
         fade_out_start, fade_out_start, audio_trim_start, voice_gain_linear, voice_delay_ms, voice_delay_ms, fade_out_start
    );

    let mut cmd = new_ffmpeg_command();
    cmd.args([
        "-nostdin",
        "-y",
        "-ss", &start_time.to_string(),
        "-t", &duration.to_string(),
        "-i", &video_path,
        "-i", &audio_path,
        "-filter_complex", &filter_complex,
        "-map", "[vout]",
        "-map", "[aout]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        &output_path
    ]);
    
    cmd.stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped());
       
    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;
    
    if let Some(stderr) = child.stderr.take() {
        let mut reader = tokio::io::BufReader::new(stderr).lines();
        let re_res = regex::Regex::new(r"time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})");

        let app_handle_clone = app_handle.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                if let Ok(ref re) = re_res {
                    if let Some(caps) = re.captures(&line) {
                        let _ = app_handle_clone.emit("export-progress", serde_json::json!({
                            "operation": "Сохранение неудачного дубля...",
                            "time": caps[0].to_string()
                        }));
                    }
                }
            }
        });
    }

    println!("[export_blooper] Запуск FFmpeg. Ждем завершения...");
    let status = child.wait().await.map_err(|e| e.to_string())?;
    println!("[export_blooper] FFmpeg завершил работу. Exit status: {}", status);
    
    if !status.success() {
        eprintln!("[export_blooper] FFmpeg execution failed for blooper");
        return Err("FFmpeg execution failed for blooper".to_string());
    }

    println!("[export_blooper] Успешное завершение. Файл сохранен в: {}", output_path);
    Ok(output_path)
}

#[tauri::command]
pub async fn process_backstage_shorts(
    _app_handle: tauri::AppHandle,
    video_path: String,
    output_path: String,
) -> Result<String, String> {
    println!("[process_backstage_shorts] Начало работы. input: {}, output: {}", video_path, output_path);

    let output_pattern = if output_path.to_lowercase().ends_with(".mp4") {
        output_path.replace(".mp4", "_%03d.mp4")
    } else {
        format!("{}_%03d.mp4", output_path)
    };

    let filter = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:20[bg];[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[out]";

    let mut cmd = new_ffmpeg_command();
    cmd.args(&[
        "-nostdin",
        "-y",
        "-i", &video_path,
        "-filter_complex", filter,
        "-map", "[out]",
        "-map", "0:a",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-f", "segment",
        "-segment_time", "30",
        "-reset_timestamps", "1",
        &output_pattern,
    ]);

    println!("[process_backstage_shorts] Запуск FFmpeg: {:?}", cmd);
    let output = cmd.output().await.map_err(|e| e.to_string())?;
    println!("[process_backstage_shorts] FFmpeg завершил работу. Exit status: {}", output.status);

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        eprintln!("[process_backstage_shorts] FFmpeg error: {}", err);
        return Err(format!("FFmpeg error: {}", err));
    }
    
    println!("[process_backstage_shorts] Успешное завершение. Файлы сохранены по шаблону: {}", output_pattern);
    Ok(output_pattern)
}

#[derive(serde::Deserialize, Debug, Clone)]
pub struct DubSegment {
    pub start: f64,
    pub end: f64,
}

#[tauri::command]
pub async fn process_backstage_remove_silence(
    _app_handle: tauri::AppHandle,
    video_path: String,
    dubs: Vec<DubSegment>,
    output_path: String,
) -> Result<String, String> {
    println!("[process_backstage_remove_silence] Начало работы. input: {}, output: {}, дублей для сохранения: {}", video_path, output_path, dubs.len());
    if dubs.is_empty() {
        eprintln!("[process_backstage_remove_silence] Нет дублей для сохранения");
        return Err("No dubs provided to keep".into());
    }
    
    let mut select_expr = String::new();
    for (i, dub) in dubs.iter().enumerate() {
        if i > 0 {
            select_expr.push('+');
        }
        select_expr.push_str(&format!("between(t,{},{})", dub.start, dub.end));
    }
    
    let vf_filter = format!("select='{}',setpts=N/FRAME_RATE/TB", select_expr);
    let af_filter = format!("aselect='{}',asetpts=N/SR/TB", select_expr);
    
    let mut cmd = new_ffmpeg_command();
    cmd.args(&[
        "-nostdin",
        "-y",
        "-i", &video_path,
        "-vf", &vf_filter,
        "-af", &af_filter,
        "-c:v", "libx264",
        "-c:a", "aac",
        &output_path,
    ]);
    
    println!("[process_backstage_remove_silence] Запуск FFmpeg: {:?}", cmd);
    let output = cmd.output().await.map_err(|e| e.to_string())?;
    println!("[process_backstage_remove_silence] FFmpeg завершил работу. Exit status: {}", output.status);
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        eprintln!("[process_backstage_remove_silence] FFmpeg error: {}", err);
        return Err(format!("FFmpeg error: {}", err));
    }
    
    println!("[process_backstage_remove_silence] Успешное завершение. Файл сохранен в: {}", output_path);
    Ok(output_path)
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ExportSettings {
    pub include_original: bool,
    pub aspect_ratio: String,
    pub split_short_videos: bool,
    pub professional_editing: bool,
    pub only_favorites: Option<bool>,
    pub use_audio_transitions: Option<bool>,
    pub pip_camera: Option<bool>,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct TimelineBlockInput {
    pub id: String,
    pub r#type: String, // "dub" | "speaking" | "silence"
    pub duration: f64,
    pub start: Option<f64>,
    pub end: Option<f64>,
    #[serde(rename = "originalStart")]
    pub original_start: Option<f64>,
    #[serde(rename = "originalEnd")]
    pub original_end: Option<f64>,
    #[serde(rename = "isFavorite")]
    pub is_favorite: Option<bool>,
    #[serde(rename = "videoRefStart")]
    pub video_ref_start: Option<f64>,
    #[serde(rename = "videoRefEnd")]
    pub video_ref_end: Option<f64>,
}

#[tauri::command]
pub async fn export_backstage_assemble(
    _app_handle: tauri::AppHandle,
    video_path: String,
    original_video_path: Option<String>,
    subtitles: Vec<SubtitleSegment>,
    blocks: Vec<TimelineBlockInput>,
    settings: ExportSettings,
    output_path: String,
) -> Result<String, String> {
    use std::fs;
    use std::io::Write;
    use std::path::Path;
    use tokio::process::Command;

    println!("[export_backstage_assemble] Начало экспорта. Всего блоков: {}. Output: {}", blocks.len(), output_path);

    let out_dir = Path::new(&output_path).parent().unwrap_or(Path::new(""));
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0))
        .as_secs();
    let temp_dir = out_dir.join(format!("temp_assemble_{}", now_secs));
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let mut concat_list = String::new();
    let mut chunk_files = Vec::new();

    let has_original = original_video_path.is_some();
    let is_9_16 = settings.aspect_ratio == "9:16";
    let professional = settings.professional_editing;
    let use_pip = settings.pip_camera.unwrap_or(false);

    // Check camera audio
    let probe_out = new_ffprobe_command()
        .args(["-i", &video_path, "-show_streams", "-select_streams", "a", "-loglevel", "error"])
        .output().await;
    let has_cam_audio = probe_out.map(|o| !o.stdout.is_empty()).unwrap_or(true);

    for (i, block) in blocks.iter().enumerate() {
        let chunk_name = format!("chunk_{:04}.mp4", i);
        let chunk_path = temp_dir.join(&chunk_name);
        
        let start = block.original_start.unwrap_or(0.0);
        let duration = block.duration;
        let end = block.original_end.unwrap_or(start + duration);

        let orig_start = block.video_ref_start.unwrap_or(0.0);
        let orig_end = block.video_ref_end.unwrap_or(orig_start + duration);

        let mut filter_graph = String::new();
        
        // Video trim
        if block.r#type == "dub" && has_original && (professional || use_pip) {
            filter_graph.push_str(&format!("[1:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[orig_v];\n", orig_start, orig_end));
            if use_pip {
                filter_graph.push_str(&format!("[0:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[cam_v];\n", start, end));
                let pip_w = if is_9_16 { "iw/3" } else { "iw/4" };
                let pip_h = if is_9_16 { "ih/3" } else { "ih/4" };
                let pip_x = if is_9_16 { "W-w-20" } else { "W-w-40" };
                let pip_y = if is_9_16 { "20" } else { "40" };
                filter_graph.push_str(&format!("[cam_v]scale={}:{}[pip_scaled];\n", pip_w, pip_h));
                filter_graph.push_str(&format!("[orig_v][pip_scaled]overlay=x={}:y={}:format=yuv420[v_raw];\n", pip_x, pip_y));
            } else {
                filter_graph.push_str("[orig_v]format=yuv420p[v_raw];\n");
            }
        } else if has_original && use_pip {
            // For non-dub blocks in PIP mode, we just show the original video (no PIP)
            filter_graph.push_str(&format!("[1:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[orig_v];\n", orig_start, orig_end));
            filter_graph.push_str("[orig_v]format=yuv420p[v_raw];\n");
        } else {
            filter_graph.push_str(&format!("[0:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[cam_v];\n", start, end));
            filter_graph.push_str("[cam_v]format=yuv420p[v_raw];\n");
        }

        // Subtitles for this block
        let block_subs: Vec<_> = subtitles.iter().filter(|s| {
            s.end > orig_start && s.start < orig_end
        }).collect();

        if block_subs.is_empty() {
            filter_graph.push_str("[v_raw]copy[v_sub];\n");
        } else {
            let mut current_v = "v_raw".to_string();
            for (sub_i, sub) in block_subs.iter().enumerate() {
                let next_v = format!("v_sub_{}", sub_i);
                let sub_start_in_block = (sub.start - orig_start).max(0.0);
                let sub_end_in_block = (sub.end - orig_start).min(duration);
                let text = sub.text.replace("'", "\\'").replace(":", "\\:").replace(",", "\\,");
                let font_size = if is_9_16 { 48 } else { 64 };
                let y_pos = if is_9_16 { "(h-text_h)/2+600" } else { "(h-text_h)/2+400" };
                
                filter_graph.push_str(&format!(
                    "[{}]drawtext=text='{}':fontcolor=white:fontsize={}:x=(w-text_w)/2:y={}:enable='between(t,{:.3},{:.3})'[{}];\n",
                    current_v, text, font_size, y_pos, sub_start_in_block, sub_end_in_block, next_v
                ));
                current_v = next_v;
            }
            filter_graph.push_str(&format!("[{}]copy[v_sub];\n", current_v));
        }

        // Crop if needed (ensure width and height are divisible by 2)
        if is_9_16 {
            filter_graph.push_str("[v_sub]crop='w=2*floor(ih*(9/16)/2):h=2*floor(ih/2)'[v_out];\n");
        } else {
            filter_graph.push_str("[v_sub]copy[v_out];\n");
        }

        // Audio trim
        if block.r#type == "dub" && has_original && (professional || use_pip) {
            filter_graph.push_str(&format!("[1:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[orig_a];\n", orig_start, orig_end));
            if use_pip && has_cam_audio {
                filter_graph.push_str(&format!("[0:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[cam_a];\n", start, end));

                // Проведем нормализацию для сборки (assemble)
                let (mean_orig, _) = get_volume_stats(original_video_path.as_ref().unwrap(), Some(orig_start), Some(duration)).await;
                let (mean_voice, max_voice) = get_volume_stats(&video_path, Some(start), Some(duration)).await;

                let mean_orig_val = mean_orig.unwrap_or(-20.0);
                let mean_voice_val = mean_voice.unwrap_or(-25.0);
                let max_voice_val = max_voice.unwrap_or(0.0);

                // Оригинальное аудио приглушается на volume=0.8 для лучшего баланса при микшировании
                let orig_attenuation_db = 20.0 * 0.8_f64.log10();
                let mean_orig_adjusted = mean_orig_val + orig_attenuation_db;

                let clamped_orig_mean = mean_orig_adjusted.clamp(-26.0, -14.0);
                let target_voice_mean = clamped_orig_mean + 3.5;
                let mut needed_gain_db = target_voice_mean - mean_voice_val;

                if needed_gain_db > 24.0 {
                    needed_gain_db = 24.0;
                }
                if needed_gain_db < -12.0 {
                    needed_gain_db = -12.0;
                }

                let safe_gain_db = -1.0 - max_voice_val;
                if needed_gain_db > safe_gain_db {
                    needed_gain_db = safe_gain_db;
                }

                let cam_gain_linear = 10.0_f64.powf(needed_gain_db / 20.0);
                println!("[export_backstage_assemble] Блок {}: расчет громкости микрофона: {:.2} dB (линейный коэффициент: {:.3})", 
                         i, needed_gain_db, cam_gain_linear);

                filter_graph.push_str("[orig_a]volume=0.8[orig_a_norm];\n");
                filter_graph.push_str(&format!("[cam_a]volume={:.3}[cam_a_norm];\n", cam_gain_linear));
                filter_graph.push_str("[orig_a_norm][cam_a_norm]amix=inputs=2:duration=longest[a_out];\n");
            } else {
                filter_graph.push_str("[orig_a]volume=1.0[a_out];\n");
            }
        } else if has_original && use_pip {
            // For non-dub blocks in PIP mode, we just play original audio
            filter_graph.push_str(&format!("[1:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[orig_a];\n", orig_start, orig_end));
            filter_graph.push_str("[orig_a]volume=1.0[a_out];\n");
        } else {
            if block.r#type == "silence" {
                filter_graph.push_str(&format!("anullsrc=r=48000:cl=stereo:d={:.3}[a_out];\n", duration));
            } else {
                if has_cam_audio {
                    filter_graph.push_str(&format!("[0:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[cam_a];\n", start, end));
                    filter_graph.push_str("[cam_a]volume=1.0[a_out];\n");
                } else {
                    filter_graph.push_str(&format!("anullsrc=r=48000:cl=stereo:d={:.3}[a_out];\n", duration));
                }
            }
        }

        let mut cmd = new_ffmpeg_command();
        cmd.arg("-nostdin").arg("-y");
        cmd.arg("-i").arg(&video_path);
        
        if has_original {
            cmd.arg("-i").arg(original_video_path.as_ref().unwrap());
        }
        
        cmd.arg("-filter_complex").arg(&filter_graph);
        cmd.arg("-map").arg("[v_out]");
        cmd.arg("-map").arg("[a_out]");
        cmd.arg("-c:v").arg("libx264").arg("-preset").arg("fast").arg("-crf").arg("23");
        cmd.arg("-c:a").arg("aac").arg("-b:a").arg("192k").arg("-ar").arg("48000").arg("-ac").arg("2");
        let chunk_path_str = chunk_path.to_string_lossy().to_string();
        cmd.arg(&chunk_path_str);
        
        println!("[export_backstage_assemble] Рендеринг блока {}/{}", i + 1, blocks.len());
        let output = cmd.output().await.map_err(|e| e.to_string())?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            println!("[export_backstage_assemble] FFmpeg ошибка для блока {}: {}", i, err);
            return Err(format!("FFmpeg error on block {}: {}", i, err));
        }
        
        if chunk_path.exists() {
            concat_list.push_str(&format!("file '{}'\n", chunk_path.to_string_lossy().replace("\\", "/")));
            chunk_files.push(chunk_path);
        }
    }

    let concat_file = temp_dir.join("concat.txt");
    let mut f = fs::File::create(&concat_file).map_err(|e| e.to_string())?;
    f.write_all(concat_list.as_bytes()).map_err(|e| e.to_string())?;

    println!("[export_backstage_assemble] Склеивание {} блоков...", chunk_files.len());
    let concat_file_str = concat_file.to_string_lossy().to_string();
    let mut concat_cmd = new_ffmpeg_command();
    concat_cmd.args([
        "-nostdin",
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", &concat_file_str,
        "-c", "copy",
        &output_path
    ]);

    let concat_out = concat_cmd.output().await.map_err(|e| e.to_string())?;
    if !concat_out.status.success() {
        let err = String::from_utf8_lossy(&concat_out.stderr);
        return Err(format!("FFmpeg concat error: {}", err));
    }
    
    // Cleanup
    let _ = fs::remove_dir_all(&temp_dir);

    println!("[export_backstage_assemble] Готово!");
    Ok(output_path)
}
