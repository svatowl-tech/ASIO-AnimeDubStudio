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
                if let Ok(mut reader) = WavReader::open(path) {
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
}

#[derive(Deserialize, Debug)]
pub struct StemOptions {
    pub bit_depth: String, // "16", "24", "32float"
    pub output_dir: String,
}

#[derive(Serialize, Clone)]
struct StemProgress {
    current: usize,
    total: usize,
    track_name: String,
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

        for (i, track) in project.tracks.into_iter().enumerate() {
            let sem_clone = Arc::clone(&semaphore);
            let app_clone = app_handle.clone();
            let enc_clone = encoder.to_string();
            let out_dir_clone = output_dir.to_path_buf();
            let track_idx = i + 1;

            let handle = tokio::spawn(async move {
                let _permit = sem_clone.acquire().await.map_err(|e| e.to_string())?;

                let sanitized_name = track.name.replace(|c: char| !c.is_alphanumeric(), "_");
                let file_name = format!("{:02}_{}.wav", track_idx, sanitized_name);
                let out_file = out_dir_clone.join(file_name);

                let _ = app_clone.emit("stem-progress", StemProgress {
                    current: track_idx,
                    total: total_tracks,
                    track_name: track.name.clone(),
                });

                let valid_segments: Vec<_> = track.segments.iter()
                    .filter(|s| s.file_path.is_some() && !s.file_path.as_ref().unwrap().is_empty())
                    .collect();
                
                if valid_segments.is_empty() {
                    return Ok::<(), String>(());
                }

                // --- FFmpeg Logic for Stem ---
                // We use filter_complex to place each segment at its correct timeline position
                let mut cmd = Command::new(crate::get_ffmpeg_path());
                cmd.arg("-nostdin");
                cmd.arg("-y");

                for seg in &valid_segments {
                    cmd.arg("-i").arg(seg.file_path.as_ref().unwrap());
                }

                let mut filter = String::new();
                for (idx, seg) in valid_segments.iter().enumerate() {
                    let delay_ms = (seg.start_time * 1000.0) as i64;
                    let playback_rate = seg.playback_rate.unwrap_or(1.0);
                    
                    // [idx:a]atrim=start:end,asetpts=PTS-STARTPTS,atempo=rate,adelay=ms|ms[a_idx]
                    // atrim is in file time
                    filter.push_str(&format!(
                        "[{}:a]atrim=start={}:duration={},asetpts=PTS-STARTPTS", 
                        idx, seg.file_offset, seg.duration * playback_rate
                    ));
                    
                    if (playback_rate - 1.0).abs() > 0.001 {
                        filter.push_str(&format!(",atempo={}", playback_rate));
                    }
                    
                    filter.push_str(&format!(",volume={},adelay={}|{}[a{}];", seg.gain, delay_ms, delay_ms, idx));
                }

            // Mix weighted segments
            for idx in 0..valid_segments.len() {
                filter.push_str(&format!("[a{}]", idx));
            }
            filter.push_str(&format!("amix=inputs={}:duration=longest:dropout_transition=0:normalize=0", valid_segments.len()));

            cmd.arg("-filter_complex").arg(filter);
            cmd.arg("-c:a").arg(enc_clone);
            cmd.arg(out_file.to_string_lossy().to_string());

            let status = cmd.output().await.map_err(|e| e.to_string())?;
            if !status.status.success() {
                return Err(String::from_utf8_lossy(&status.stderr).to_string());
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

#[tauri::command]
pub async fn export_audio(
    app_handle: AppHandle,
    project_json: String,
    output_path: String,
    format: String, // "wav", "mp3", "flac"
    bit_depth: Option<String>, // e.g., "16", "24"
    bitrate: Option<String>, // e.g., "320k"
) -> Result<(), String> {
    let project: ExportProjectData = serde_json::from_str(&project_json)
        .map_err(|e| format!("Failed to parse project JSON: {}", e))?;

    let any_solo = project.tracks.iter().any(|t| t.is_solo.unwrap_or(false));

    let mut all_segments = Vec::new();
    for track in &project.tracks {
        if any_solo {
            if !track.is_solo.unwrap_or(false) {
                continue;
            }
        } else if track.is_muted.unwrap_or(false) {
            continue;
        }

        for segment in &track.segments {
            if segment.file_path.is_some() && !segment.file_path.as_ref().unwrap().is_empty() {
                all_segments.push(segment.clone());
            }
        }
    }

    if all_segments.is_empty() {
        return Err("No audio segments found to export. Please check if tracks are muted or empty.".to_string());
    }

    let temp_dir = env::temp_dir().join(format!("dubstudio_export_{}", std::process::id()));
    if temp_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed creating temp dir: {}", e))?;

    let total_tasks = all_segments.len() + 1;
    let mut completed_tasks = 0;

    let emit_progress = |completed: usize, total: usize, app: &AppHandle| {
        let pct = (completed as f64 / total as f64) * 100.0;
        let _ = app.emit("export-progress", pct);
    };

    emit_progress(0, total_tasks, &app_handle);

    let max_concurrent = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let semaphore = Arc::new(Semaphore::new(max_concurrent));

    let mut handles = Vec::new();

    for (i, segment) in all_segments.into_iter().enumerate() {
        let temp_dir_clone = temp_dir.clone();
        let sem_clone = Arc::clone(&semaphore);
        
        let handle = tokio::spawn(async move {
            let _permit = sem_clone.acquire().await.map_err(|e| e.to_string())?;

            let out_file = temp_dir_clone.join(format!("seg_{}.wav", i));
            let delay_ms = (segment.start_time * 1000.0) as i64;
            let playback_rate = segment.playback_rate.unwrap_or(1.0);
            
            let mut filter = format!(
                "atrim=start={}:duration={},asetpts=PTS-STARTPTS", 
                segment.file_offset, segment.duration * playback_rate
            );
            
            if (playback_rate - 1.0).abs() > 0.001 {
                filter.push_str(&format!(",atempo={}", playback_rate));
            }
            
            filter.push_str(&format!(",volume={},adelay={}|{}", segment.gain, delay_ms, delay_ms));
            
            let seg_path = segment.file_path.clone().unwrap_or_default();
            let out_file_str = out_file.to_string_lossy().to_string();

            let status = Command::new(crate::get_ffmpeg_path())
                .arg("-nostdin")
                .arg("-y")
                .arg("-i").arg(&seg_path)
                .arg("-af").arg(&filter)
                .arg("-c:a").arg("pcm_s16le")
                .arg(&out_file_str)
                .output()
                .await
                .map_err(|e| format!("Failed spawning ffmpeg: {}", e))?;

            if !status.status.success() {
                return Err(format!("FFmpeg error processing {}: {}", seg_path, String::from_utf8_lossy(&status.stderr)));
            }

            Ok::<PathBuf, String>(out_file)
        });
        
        handles.push(handle);
    }

    let mut processed_files = Vec::new();
    for handle in handles {
        let res = handle.await.map_err(|e| e.to_string())??;
        processed_files.push(res);
        completed_tasks += 1;
        emit_progress(completed_tasks, total_tasks, &app_handle);
    }

    // Mix and encode robustly in batches if there are too many files (avoiding OS argument/path list length limits)
    let mut current_files = processed_files.clone();
    let mut pass = 0;
    while current_files.len() > 30 {
        let mut mixed_files = Vec::new();
        let chunks: Vec<_> = current_files.chunks(30).collect();
        for (chunk_idx, chunk) in chunks.into_iter().enumerate() {
            let out_file = temp_dir.join(format!("mix_pass_{}_{}.wav", pass, chunk_idx));
            let mut chunk_args = vec!["-nostdin".to_string(), "-y".to_string()];
            for path in chunk {
                chunk_args.push("-i".to_string());
                chunk_args.push(path.to_string_lossy().to_string());
            }
            if chunk.len() > 1 {
                let filter = format!("amix=inputs={}:duration=longest:dropout_transition=0:normalize=0", chunk.len());
                chunk_args.push("-filter_complex".to_string());
                chunk_args.push(filter);
            }
            chunk_args.push("-c:a".to_string());
            chunk_args.push("pcm_s16le".to_string());
            chunk_args.push(out_file.to_string_lossy().to_string());

            let status = Command::new(crate::get_ffmpeg_path())
                .args(&chunk_args)
                .output()
                .await
                .map_err(|e| format!("FFmpeg mix pass failed to execute: {}", e))?;

            if !status.status.success() {
                return Err(format!("FFmpeg intermediate mix failed: {}", String::from_utf8_lossy(&status.stderr)));
            }
            mixed_files.push(out_file);
        }
        current_files = mixed_files;
        pass += 1;
    }

    let mut mix_args = vec!["-y".to_string()];
    
    for path in &current_files {
        mix_args.push("-i".to_string());
        mix_args.push(path.to_string_lossy().to_string());
    }

    if current_files.len() > 1 {
        let filter = format!("amix=inputs={}:duration=longest:dropout_transition=0:normalize=0", current_files.len());
        mix_args.push("-filter_complex".to_string());
        mix_args.push(filter);
    }

    // Format specific settings
    match format.as_str() {
        "mp3" => {
            mix_args.push("-c:a".to_string());
            mix_args.push("libmp3lame".to_string());
            mix_args.push("-b:a".to_string());
            mix_args.push(bitrate.unwrap_or_else(|| "320k".to_string()));
        },
        "flac" => {
            mix_args.push("-c:a".to_string());
            mix_args.push("flac".to_string());
        },
        _ => { // default wav
            let depth = bit_depth.unwrap_or_else(|| "16".to_string());
            let pcm = match depth.as_str() {
                "24" => "pcm_s24le",
                "32" => "pcm_s32le",
                _ => "pcm_s16le",
            };
            mix_args.push("-c:a".to_string());
            mix_args.push(pcm.to_string());
        }
    }

    mix_args.push(output_path.clone());

    crate::media_processor::run_ffmpeg_with_progress(
        app_handle.clone(),
        mix_args,
        "Final Audio Mix".to_string(),
        None,
    ).await?;

    completed_tasks += 1;
    emit_progress(completed_tasks, total_tasks, &app_handle);

    let _ = fs::remove_dir_all(&temp_dir);

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
    let src = Path::new(&src_str);
    
    if !src.exists() {
        return Err(format!("Source file does not exist: {}", src_str));
    }

    let dest = Path::new(&project_path).join(format!("preview_{}.wav", segment_id));
    fs::copy(src, &dest).map_err(|e| format!("Failed to copy segment: {}", e))?;

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
        let dubs_clone = dub_segments.clone();

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
            let mut cmd = Command::new(crate::get_ffmpeg_path());
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

            let output = cmd.output().await.map_err(|e| format!("FFmpeg execution failed: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("FFmpeg error during {} render: {}", final_name, stderr));
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

    // Prepare inputs
    for (_i, seg) in segments.iter().enumerate() {
        if !seg.file_path.is_empty() && Path::new(&seg.file_path).exists() {
            inputs.push(seg.file_path.clone());
        }
    }

    if inputs.is_empty() {
        return Err("No segments to export".to_string());
    }

    let mut args = vec!["-y".to_string()];

    // We use a complex filter to generate silences and concat
    let mut filter_complex = String::new();
    let mut inputs_str = String::new();
    
    for (i, path) in inputs.iter().enumerate() {
        args.push("-i".to_string());
        args.push(path.clone());
        // [i:a]
        let silence_label = format!("s{}", i);
        
        // Generate silence for the gap (except after the last one if preferred, but here we just follow gaps)
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

    let _final_format = format.unwrap_or_else(|| "wav".to_string());
    let mut final_output_path = output_path.clone();
    
    // If output_path is just a filename, put it in project_path
    let p = Path::new(&output_path);
    if p.parent() == Some(Path::new("")) {
        final_output_path = Path::new(&project_path).join(output_path).to_string_lossy().to_string();
    }

    args.push(final_output_path.clone());

    // Calculate total duration for progress
    let mut total_duration = 0.0;
    for path in &inputs {
        if let Ok(reader) = WavReader::open(path) {
            total_duration += (reader.duration() as f64 / reader.spec().sample_rate as f64) + gap;
        }
    }

    crate::media_processor::run_ffmpeg_with_progress(
        app_handle, 
        args, 
        "Exporting Audio Book".to_string(), 
        Some(total_duration)
    ).await?;

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
    let mut cmd = Command::new(crate::get_ffmpeg_path());
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
    use tokio::process::Command;
    let mut cmd = Command::new(crate::get_ffmpeg_path());
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

    let mut cmd = tokio::process::Command::new(crate::get_ffmpeg_path());
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

    let mut cmd = tokio::process::Command::new(crate::get_ffmpeg_path());
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
    
    let mut cmd = tokio::process::Command::new(crate::get_ffmpeg_path());
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
    let probe_out = Command::new(crate::get_ffprobe_path())
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

        let mut cmd = Command::new(crate::get_ffmpeg_path());
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
    let mut concat_cmd = Command::new(crate::get_ffmpeg_path());
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
