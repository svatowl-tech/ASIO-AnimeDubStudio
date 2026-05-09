use tauri::AppHandle;
// sync
use hound::WavReader;
use rayon::prelude::*;
use std::path::Path;

use crate::logger::log_debug;
use tauri_plugin_shell::ShellExt;

async fn get_video_duration(app_handle: &AppHandle, file_path: &str) -> Result<f64, String> {
    let ffprobe_cmd = app_handle.shell().sidecar("ffprobe")
        .map_err(|e| format!("Failed to find ffprobe sidecar: {}", e))?;

    let output = ffprobe_cmd
        .args(&[
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path,
        ])
        .output()
        .await
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    if !output.status.success() {
        // Fallback to system ffprobe
        let fallback = tokio::process::Command::new("ffprobe")
            .args(&[
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                file_path,
            ])
            .output()
            .await;
            
        if let Ok(fo) = fallback {
            if fo.status.success() {
                let duration_str = String::from_utf8_lossy(&fo.stdout).trim().to_string();
                return duration_str.parse::<f64>().map_err(|_| format!("Failed to parse duration: {}", duration_str));
            }
        }
        return Err(format!("ffprobe error: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let duration_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    duration_str.parse::<f64>().map_err(|_| format!("Failed to parse duration: {}", duration_str))
}

#[tauri::command]
pub async fn extract_audio_peaks_bin(app_handle: AppHandle, file_path: String, output_dir: String) -> Result<Vec<u8>, String> {
    log_debug(&format!("extract_audio_peaks_bin called for: {}, output_dir: {}", file_path, output_dir));
    
    let output_wav_path = if output_dir.is_empty() {
        // Fallback if no dir provided
        std::env::temp_dir().join("original_audio_temp.wav")
    } else {
        Path::new(&output_dir).join("original_audio.wav")
    };
    
    let output_wav_str = output_wav_path.to_str().ok_or("Invalid output path")?;
    let output_wav_str_owned = output_wav_str.to_string();

    // 0. Get original video duration for verification
    let video_duration = match get_video_duration(&app_handle, &file_path).await {
        Ok(d) => Some(d),
        Err(e) => {
            log_debug(&format!("Warning: Could not get video duration via ffprobe: {}", e));
            None
        }
    };

    // 1. Spawning FFmpeg with synchronization filters
    let sync_filters = "aresample=async=1:min_hard_comp=0.100000:first_pts=0";

    let ffmpeg_cmd = app_handle.shell().sidecar("ffmpeg")
        .map_err(|e| {
            let err_msg = format!("Failed to find ffmpeg sidecar: {}", e);
            log_debug(&err_msg);
            err_msg
        })?;

    let output = ffmpeg_cmd
        .args(&[
            "-y",
            "-v", "quiet",
            "-copyts", 
            "-i", &file_path,
            "-vn",
            "-af", sync_filters,
            "-ac", "1",
            "-ar", "48000",
            &output_wav_str_owned,
        ])
        .output()
        .await
        .map_err(|e| {
            let err_msg = format!("FFmpeg failed: {}", e);
            log_debug(&err_msg);
            err_msg
        })?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        log_debug(&format!("FFmpeg error during extraction: {}", err_msg));
        // Fallback to system ffmpeg
        let fallback_output = tokio::process::Command::new("ffmpeg")
            .args(&[
                "-y",
                "-v", "quiet",
                "-copyts",
                "-i", &file_path,
                "-vn",
                "-af", sync_filters,
                "-ac", "1",
                "-ar", "48000",
                &output_wav_str_owned,
            ])
            .output()
            .await;
            
        if let Ok(fo) = fallback_output {
            if !fo.status.success() {
                let msg = format!("FFmpeg failed (both sidecar and system): {}", String::from_utf8_lossy(&fo.stderr));
                log_debug(&msg);
                return Err(msg);
            }
        } else {
             let msg = format!("FFmpeg sidecar failed and system ffmpeg not found: {}", err_msg);
             log_debug(&msg);
             return Err(msg);
        }
    }

    // 2. Read the WAV file and generate peaks
    let output_wav_str_verify = output_wav_str_owned.clone();
    let peaks_result = tokio::task::spawn_blocking(move || {
        let reader = WavReader::open(&output_wav_str_verify)
            .map_err(|e| format!("Failed to open generated wav: {}", e))?;
        let spec = reader.spec();
        let samples_count = reader.len() as f64;
        let audio_duration = samples_count / f64::from(spec.sample_rate);
        
        if let Some(v_dur) = video_duration {
            let diff = (audio_duration - v_dur).abs();
            if diff > 0.010 {
                log_debug(&format!(
                    "!!! SYNC WARNING !!! Audio duration ({:.4}s) differs from Video duration ({:.4}s) by {:.1}ms.",
                    audio_duration, v_dur, diff * 1000.0
                ));
            } else {
                log_debug(&format!("Extraction sync: diff {:.2}ms", diff * 1000.0));
            }
        }

        let points_per_second = 50.0;
        let v_dur = video_duration.unwrap_or(audio_duration);
        let points = (v_dur * points_per_second) as usize;
        let points = points.max(100);
        
        generate_waveform_peaks_internal(&output_wav_str_verify, points)
    }).await.map_err(|e| {
        let msg = e.to_string();
        log_debug(&format!("spawn_blocking error: {}", msg));
        msg
    })?.map_err(|e| {
        let msg = e.to_string();
        log_debug(&format!("peaks internal error: {}", msg));
        msg
    })?;

    // 3. Compress data into 8-bit Peaks (0 to 255 representing 0.0 to 1.0 amplitude)
    // We apply a slight boost (sqrt) to make RMS values more visible in the UI
    let peaks_u8: Vec<u8> = peaks_result.into_iter()
        .map(|p| (p.abs().sqrt().min(1.0) * 255.0) as u8)
        .collect();

    log_debug(&format!("Generated {} peaks for {}", peaks_u8.len(), file_path));
    
    Ok(peaks_u8)
}

pub fn generate_waveform_peaks_internal(file_path: &str, points: usize) -> Result<Vec<f32>, String> {
    let mut reader = WavReader::open(file_path)
        .map_err(|e| format!("Failed to open wav: {}", e))?;
    
    let spec = reader.spec();
    
    // Parse all samples into memory using dynamic type handling based on wav bit depth
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            if spec.bits_per_sample == 16 {
                reader.samples::<i16>().map(|s| s.unwrap_or(0) as f32 / std::i16::MAX as f32).collect()
            } else if spec.bits_per_sample == 32 {
                reader.samples::<i32>().map(|s| s.unwrap_or(0) as f32 / std::i32::MAX as f32).collect()
            } else if spec.bits_per_sample == 8 {
                reader.samples::<i8>().map(|s| s.unwrap_or(0) as f32 / std::i8::MAX as f32).collect()
            } else {
                return Err(format!("Unsupported bit depth: {}", spec.bits_per_sample));
            }
        },
        hound::SampleFormat::Float => {
            reader.samples::<f32>().map(|s| s.unwrap_or(0.0)).collect()
        }
    };

    if samples.is_empty() {
        return Ok(vec![0.0; points.max(1)]);
    }

    let pts = points.max(1);

    // Optimized linear mapping to ensure exactly `points` peaks
    // regardless of actual audio sample count misalignment.
    let peaks: Vec<f32> = (0..pts)
        .into_par_iter()
        .map(|i| {
            let start_norm = i as f64 / pts as f64;
            let end_norm = (i + 1) as f64 / pts as f64;

            let start_idx = (start_norm * samples.len() as f64) as usize;
            let end_idx = (end_norm * samples.len() as f64) as usize;

            let start_idx = start_idx.min(samples.len());
            let end_idx = end_idx.clamp(start_idx + 1, samples.len());

            let chunk = &samples[start_idx..end_idx];
            let mut sum_squares = 0.0;
            
            for &s in chunk {
                sum_squares += s * s;
            }
            
            if chunk.is_empty() {
                0.0
            } else {
                (sum_squares / chunk.len() as f32).sqrt()
            }
        })
        .collect();

    Ok(peaks)
}

#[tauri::command]
pub async fn generate_waveform_peaks(file_path: String, points: usize) -> Result<Vec<f32>, String> {
    log_debug(&format!("generate_waveform_peaks called for: {}, points: {}", file_path, points));
    // Run intensive CPU work in a blocking task so we don't block the async runtime
    tokio::task::spawn_blocking(move || {
        generate_waveform_peaks_internal(&file_path, points)
    }).await.map_err(|e| e.to_string())?
}
