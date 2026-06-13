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
        let audio_offset_ms = project.audio_offset_ms.unwrap_or(0.0);
        let total_samples = (total_duration * 48000.0) as u64;

        let mut segments: Vec<_> = track.segments.iter()
            .cloned()
            .collect();
        segments.sort_by(|a, b| a.start_time.partial_cmp(&b.start_time).unwrap());

        for seg in segments {
            let adjusted_start = seg.start_time + (audio_offset_ms / 1000.0);
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

    Ok(final_zip_path.to_str().unwrap().to_string())
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
            let audio_offset_ms = project.audio_offset_ms;

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
                let mut cmd = Command::new("ffmpeg");
                cmd.arg("-y");

                for seg in &valid_segments {
                    cmd.arg("-i").arg(seg.file_path.as_ref().unwrap());
                }

                let mut filter = String::new();
                for (idx, seg) in valid_segments.iter().enumerate() {
                    let delay_ms = (seg.start_time * 1000.0 + audio_offset_ms) as i64;
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
            cmd.arg(out_file.to_str().unwrap());

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

    let audio_offset_ms = project.audio_offset_ms;
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
            let delay_ms = (segment.start_time * 1000.0 + audio_offset_ms) as i64;
            let playback_rate = segment.playback_rate.unwrap_or(1.0);
            
            let mut filter = format!(
                "atrim=start={}:duration={},asetpts=PTS-STARTPTS", 
                segment.file_offset, segment.duration * playback_rate
            );
            
            if (playback_rate - 1.0).abs() > 0.001 {
                filter.push_str(&format!(",atempo={}", playback_rate));
            }
            
            filter.push_str(&format!(",volume={},adelay={}|{}", segment.gain, delay_ms, delay_ms));
            
            let status = Command::new("ffmpeg")
                .arg("-y")
                .arg("-i").arg(segment.file_path.as_ref().unwrap())
                .arg("-af").arg(&filter)
                .arg("-c:a").arg("pcm_s16le")
                .arg(out_file.to_str().unwrap())
                .output()
                .await
                .map_err(|e| format!("Failed spawning ffmpeg: {}", e))?;

            if !status.status.success() {
                return Err(format!("FFmpeg error processing {}: {}", segment.file_path.as_ref().unwrap(), String::from_utf8_lossy(&status.stderr)));
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

    // Mix and encode
    let mut mix_args = vec!["-y".to_string()];
    
    for path in &processed_files {
        mix_args.push("-i".to_string());
        mix_args.push(path.to_str().unwrap().to_string());
    }

    if processed_files.len() > 1 {
        let filter = format!("amix=inputs={}:duration=longest:dropout_transition=0:normalize=0", processed_files.len());
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

    Ok(dest.to_str().unwrap().to_string())
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
            let mut cmd = Command::new("ffmpeg");
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

            cmd.arg("-filter_complex").arg(filter);
            cmd.arg("-t").arg(format!("{:.4}", orig_seg.duration));
            cmd.arg("-c:a").arg("pcm_s16le");
            cmd.arg(out_file.to_str().unwrap());

            let output = cmd.output().await.map_err(|e| format!("FFmpeg execution failed: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("FFmpeg error during {} render: {}", final_name, stderr));
            }

            Ok::<String, String>(out_file.to_str().unwrap().to_string())
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
        final_output_path = Path::new(&project_path).join(output_path).to_str().unwrap().to_string();
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
) -> Result<String, String> {
    let mut cmd = Command::new("ffmpeg");
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

    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;
    
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr).lines();
        let re = regex::Regex::new(r"time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})").unwrap();

        let app_handle_clone = app_handle.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                if let Some(caps) = re.captures(&line) {
                    let _ = app_handle_clone.emit("export-progress", serde_json::json!({
                        "operation": "Exporting Backstage Video",
                        "time": caps[0].to_string()
                    }));
                }
            }
        });
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    
    if !status.success() {
        return Err("FFmpeg execution failed".to_string());
    }

    Ok(output_path)
}
