use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tauri::{AppHandle, Emitter, State};
use regex::Regex;
use std::fs;
use crate::db::AppState;
use sqlx::Row;
use crate::waveform_engine::generate_waveform_peaks;

use crate::logger::log_debug;

#[derive(serde::Serialize, Clone)]
struct MediaProgress {
    time: String,
    percent: f64,
    operation: String,
}

#[derive(serde::Serialize)]
pub struct MergeResult {
    pub file_path: String,
    pub peaks: Vec<f32>,
    pub duration: f64,
}

// ... existing run_ffmpeg_with_progress ...

#[tauri::command]
pub async fn concat_backstage_videos(
    video_paths: Vec<String>,
    output_path: String,
) -> Result<String, String> {
    if video_paths.is_empty() {
        return Err("Нет видео для объединения".to_string());
    }

    // Создаем временный файл со списком путей для ffmpeg concat
    let mut file_list = String::new();
    for path in &video_paths {
        // Экранируем одинарные кавычки для формата ffmpeg concat
        let escaped_path = path.replace("'", "'\\''");
        file_list.push_str(&format!("file '{}'\n", escaped_path));
    }

    let temp_file_path = std::env::temp_dir().join(format!("backstage_list_{}.txt", std::process::id()));
    std::fs::write(&temp_file_path, file_list).map_err(|e| e.to_string())?;

    // Склеиваем видео без перекодирования (stream copy), если это возможно
    // Внимание: это работает стабильно, если все исходники имеют одинаковые параметры (кодек, разрешение)
    let output = std::process::Command::new("ffmpeg")
        .args(&[
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", temp_file_path.to_str().unwrap(),
            "-c", "copy",
            &output_path
        ])
        .output()
        .map_err(|e| e.to_string())?;

    // Удаляем временный файл
    let _ = std::fs::remove_file(temp_file_path);

    if !output.status.success() {
        return Err(format!("FFmpeg failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(output_path)
}

#[tauri::command]
pub async fn merge_segments(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    track_id: String,
    segment_ids: Vec<String>,
    output_path: String,
) -> Result<MergeResult, String> {
    let mutex = state.db.lock().await;
    let pool = mutex.as_ref().ok_or("Database not initialized")?;

    // 1. Fetch file paths from database based on IDs
    let mut file_paths = Vec::new();
    let mut total_duration = 0.0;
    let mut min_start_time = f64::MAX;

    for id in &segment_ids {
        let row = sqlx::query("SELECT file_path, duration, start_time FROM segments WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

        if let Some(r) = row {
            let file_path: Option<String> = r.get("file_path");
            let duration: f64 = r.get("duration");
            let start_time: f64 = r.get("start_time");

            if let Some(p) = file_path {
                file_paths.push(p);
                total_duration += duration;
                if start_time < min_start_time {
                    min_start_time = start_time;
                }
            }
        }
    }

    if file_paths.is_empty() {
        return Err("No valid segments found to merge".to_string());
    }

    // 2. Create FFmpeg concat file
    let temp_dir = std::env::temp_dir();
    let concat_file_path = temp_dir.join(format!("concat_{}.txt", project_id));
    let mut concat_content = String::new();
    for p in &file_paths {
        // FFmpeg concat demuxer requires single quotes escaped
        let escaped = p.replace("'", "'\\''");
        concat_content.push_str(&format!("file '{}'\n", escaped));
    }
    
    fs::write(&concat_file_path, concat_content).map_err(|e| e.to_string())?;

    // 3. Run FFmpeg Concat (Fastest, no re-encoding for same-spec WAVs)
    let args = vec![
        "-y".to_string(),
        "-f".to_string(), "concat".to_string(),
        "-safe".to_string(), "0".to_string(),
        "-i".to_string(), concat_file_path.to_str().unwrap().to_string(),
        "-c".to_string(), "copy".to_string(),
        output_path.clone(),
    ];

    run_ffmpeg_with_progress(app_handle.clone(), args, "Merging Segments".to_string(), Some(total_duration)).await?;

    // 4. Generate Peaks for the new merged file
    let peaks = generate_waveform_peaks(output_path.clone(), 1024).await?;

    // 5. Update Database (Transaction)
    // Delete old segments and insert the new merged one
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    for id in &segment_ids {
        sqlx::query("DELETE FROM segments WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    let new_seg_id = format!("merged_{}", uuid::Uuid::new_v4());

    sqlx::query("
        INSERT INTO segments (id, track_id, start_time, duration, file_offset, file_duration, file_path, gain)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ")
    .bind(&new_seg_id)
    .bind(&track_id)
    .bind(min_start_time)
    .bind(total_duration)
    .bind(0.0)
    .bind(total_duration)
    .bind(&output_path)
    .bind(1.0)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    // Cleanup
    let _ = fs::remove_file(concat_file_path);

    Ok(MergeResult {
        file_path: output_path,
        peaks,
        duration: total_duration,
    })
}

#[derive(serde::Deserialize)]
pub struct Segment {
    pub path: String,
    pub start_time: f64,
    pub duration: f64,
}

#[tauri::command]
pub async fn merge_project_segments(
    segments: Vec<Segment>,
    total_duration: f64,
    output_path: String,
) -> Result<String, String> {
    use hound::{WavReader, WavWriter};
    
    if segments.is_empty() {
        return Err("No segments to merge".to_string());
    }

    // Sort segments by start time
    let mut sorted_segments = segments;
    sorted_segments.sort_by(|a, b| a.start_time.partial_cmp(&b.start_time).unwrap());

    // Detect spec from first available segment
    let first_valid_path = sorted_segments.iter()
        .find(|s| std::path::Path::new(&s.path).exists())
        .ok_or("No valid segment files found on disk")?;
    
    let reader = WavReader::open(&first_valid_path.path)
        .map_err(|e| format!("Failed to open reference segment: {}", e))?;
    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    
    let mut writer = WavWriter::create(&output_path, spec)
        .map_err(|e| format!("Failed to create master file: {}", e))?;

    let mut current_pos_samples: u64 = 0;

    for seg in sorted_segments {
        let seg_start_samples = (seg.start_time * sample_rate as f64) as u64;
        
        // 1. Fill gap with silence
        if seg_start_samples > current_pos_samples {
            let silence_len = seg_start_samples - current_pos_samples;
            for _ in 0..silence_len {
                writer.write_sample(0i16).map_err(|e| e.to_string())?;
            }
            current_pos_samples = seg_start_samples;
        }

        // 2. Write segment data
        if let Ok(mut seg_reader) = WavReader::open(&seg.path) {
            let seg_spec = seg_reader.spec();
            if seg_spec.sample_rate != sample_rate {
                 // Simple safety: if mismatch, we could skip or error. 
                 // For now, continue and warn or assume user normalized.
            }

            // Read all samples and write
            // We support i16 primarily as it's common for dubbing
            for sample in seg_reader.samples::<i16>() {
                let s = sample.map_err(|e| e.to_string())?;
                writer.write_sample(s).map_err(|e| e.to_string())?;
                current_pos_samples += 1;
            }
        } else {
            // If file missing, fill with silence for intended duration
            let dur_samples = (seg.duration * sample_rate as f64) as u64;
            for _ in 0..dur_samples {
                writer.write_sample(0i16).map_err(|e| e.to_string())?;
            }
            current_pos_samples += dur_samples;
        }
    }

    // 3. Fill remaining timeline to total_duration
    let total_samples = (total_duration * sample_rate as f64) as u64;
    if total_samples > current_pos_samples {
        let remaining = total_samples - current_pos_samples;
        for _ in 0..remaining {
            writer.write_sample(0i16).map_err(|e| e.to_string())?;
        }
    }

    writer.finalize().map_err(|e| e.to_string())?;

    Ok(output_path)
}

pub(crate) async fn run_ffmpeg_with_progress(
    app_handle: AppHandle,
    args: Vec<String>,
    operation_name: String,
    duration_secs: Option<f64>,
) -> Result<(), String> {
    let mut shell_args = vec!["-hide_banner".to_string(), "-stats".to_string()];
    shell_args.extend(args);

    let sidecar_command = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(shell_args);

    let (mut rx, _child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    // Regex to capture time=00:00:00.00
    let re = Regex::new(r"time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})").unwrap();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);
                println!("[ffmpeg] {}", line.trim_end());
                if let Some(caps) = re.captures(&line) {
                    let h: f64 = caps[1].parse().unwrap_or(0.0);
                    let m: f64 = caps[2].parse().unwrap_or(0.0);
                    let s: f64 = caps[3].parse().unwrap_or(0.0);
                    let ms: f64 = caps[4].parse().unwrap_or(0.0);
                    
                    let current_secs = h * 3600.0 + m * 60.0 + s + ms / 100.0;
                    
                    let percent = if let Some(total) = duration_secs {
                        (current_secs / total * 100.0).min(100.0)
                    } else {
                        0.0
                    };

                    let _ = app_handle.emit("media-progress", MediaProgress {
                        time: format!("{:02}:{:02}:{:02}", h as i32, m as i32, s as i32),
                        percent,
                        operation: operation_name.clone(),
                    });
                }
            },
            CommandEvent::Stdout(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);
                println!("[ffmpeg stdout] {}", line.trim_end());
            },
            CommandEvent::Error(err) => {
                eprintln!("[ffmpeg command error] {}", err);
            },
            CommandEvent::Terminated(status) => {
                println!("[ffmpeg terminated] with status: {:?}", status.code);
                if let Some(code) = status.code {
                    if code != 0 {
                        return Err(format!("FFmpeg failed with exit code {}", code));
                    }
                }
            }
            _ => {}
        }
    }

    Ok(())
}

// Helper to detect hardware encoder
async fn get_hw_encoder(app_handle: &AppHandle) -> String {
    let output_result = app_handle.shell().sidecar("ffmpeg")
        .map(|cmd| cmd.args(["-encoders"]));

    if let Ok(cmd) = output_result {
        if let Ok(out) = cmd.output().await {
            let out_str = String::from_utf8_lossy(&out.stdout);
            if out_str.contains("h264_nvenc") { return "h264_nvenc".to_string(); }
            if out_str.contains("h264_amf") { return "h264_amf".to_string(); }
            if out_str.contains("h264_qsv") { return "h264_qsv".to_string(); }
        }
    }
    "libx264".to_string() // Fallback
}

#[tauri::command]
pub async fn render_final_video(
    app_handle: AppHandle,
    original_video: String,
    master_dub: String,
    bg_volume: f64,
    dub_volume: f64,
    output_path: String,
    title: String,
    artist: String,
) -> Result<String, String> {
    log_debug(&format!("render_final_video called. Output: {}", output_path));
    let encoder = get_hw_encoder(&app_handle).await;
    
    let filter = format!(
        "[0:a]volume={}[bg]; [1:a]volume={}[dub]; [bg][dub]amix=inputs=2:duration=first[a]",
        bg_volume, dub_volume
    );

    let args = vec![
        "-y".to_string(),
        "-i".to_string(), original_video,
        "-i".to_string(), master_dub,
        "-filter_complex".to_string(), filter,
        "-map".to_string(), "0:v:0".to_string(),
        "-map".to_string(), "[a]".to_string(),
        "-c:v".to_string(), encoder,
        "-c:a".to_string(), "aac".to_string(),
        "-metadata".to_string(), format!("title={}", title),
        "-metadata".to_string(), format!("artist={}", artist),
        output_path.clone(),
    ];

    run_ffmpeg_with_progress(app_handle, args, "Rendering Final Video".to_string(), None).await?;
    
    Ok(output_path)
}

#[tauri::command]
pub async fn get_media_info(
    app_handle: AppHandle,
    path: String,
) -> Result<String, String> {
    println!("Calling get_media_info for path: {}", path);
    // Escape single quotes for standard paths isn't normally necessary since Tauri's sidecar command 
    // handles arguments as is, but we are just passing path directly to args.
    
    let sidecar_command = app_handle
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| {
            eprintln!("Failed to create ffprobe sidecar: {}", e);
            format!("Failed to create ffprobe sidecar: {}", e)
        })?
        .args(vec![
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &path
        ]);

    let output = sidecar_command.output().await.map_err(|e| {
        eprintln!("ffprobe command failed to execute: {}", e);
        e.to_string()
    })?;
    
    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
        eprintln!("ffprobe failed with status: {:?}, stderr: {}", output.status.code(), err_msg);
        return Err(err_msg);
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    println!("ffprobe succeeded, got output of length {}", stdout_str.len());
    Ok(stdout_str)
}

#[tauri::command]
pub async fn extract_mkv_assets(
    app_handle: AppHandle,
    input_path: String,
    video_output: String,
    sub_output: Option<String>,
    audio_index: usize,
    sub_index: Option<usize>,
    duration: Option<f64>,
) -> Result<String, String> {
    println!("Starting extract_mkv_assets with input: {}, video_output: {}, audio_index: {}, sub_index: {:?}", input_path, video_output, audio_index, sub_index);

    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(), input_path.clone(),
    ];

    // Map the main video stream
    args.push("-map".to_string());
    args.push("0:v:0".to_string());

    // Map the selected audio stream
    args.push("-map".to_string());
    args.push(format!("0:{}", audio_index));

    args.push("-c:v".to_string());
    args.push("copy".to_string());
    args.push("-c:a".to_string());
    args.push("aac".to_string()); 
    args.push("-movflags".to_string());
    args.push("faststart".to_string());
    args.push(video_output.clone());

    // If subtitles are selected, extract them to a separate file in the same ffmpeg run
    if let (Some(s_idx), Some(s_out)) = (sub_index, sub_output) {
        println!("Adding subtitle extraction args. s_idx={:?}, s_out={:?}", s_idx, s_out);
        args.push("-map".to_string());
        args.push(format!("0:{}", s_idx));
        args.push("-c:s".to_string());
        // For standard text subs
        if s_out.ends_with(".srt") {
            args.push("srt".to_string());
        } else if s_out.ends_with(".vtt") {
            args.push("webvtt".to_string());
        } else if s_out.ends_with(".ass") {
            args.push("ass".to_string());
        } else {
            args.push("copy".to_string()); // fallback
        }
        args.push(s_out);
    }

    println!("Calling run_ffmpeg_with_progress with args: {:?}", args);
    run_ffmpeg_with_progress(app_handle, args, "Extracting MKV Assets".to_string(), duration).await?;
    println!("run_ffmpeg_with_progress completed successfully.");
    
    Ok(video_output)
}

#[tauri::command]
pub async fn create_proxy_video(
    app_handle: AppHandle,
    input_path: String,
    output_path: String,
    duration: Option<f64>,
) -> Result<String, String> {
    log_debug(&format!("create_proxy_video called for: {}", input_path));
    // Smart Switch: If proxy exists, return path immediately
    if std::path::Path::new(&output_path).exists() {
        return Ok(output_path);
    }

    // Otherwise, spawn background task for generation
    let app_handle_spawn = app_handle.clone();
    let input_path_spawn = input_path.clone();
    let output_path_spawn = output_path.clone();

    tokio::spawn(async move {
        let args = vec![
            "-y".to_string(), // Overwrite
            "-i".to_string(), input_path_spawn,
            "-c:v".to_string(), "libx264".to_string(),
            "-preset".to_string(), "ultrafast".to_string(),
            "-crf".to_string(), "30".to_string(), // Updated CRF to 30 as requested
            "-vf".to_string(), "scale=-2:360".to_string(), // Using -2 for even dimensions
            "-c:a".to_string(), "aac".to_string(), 
            "-b:a".to_string(), "128k".to_string(),
            output_path_spawn.clone(),
        ];

        if let Err(e) = run_ffmpeg_with_progress(app_handle_spawn.clone(), args, "Proxy Generation".to_string(), duration).await {
            eprintln!("FFmpeg error during proxy generation: {}", e);
            // Optionally emit an error event to the frontend
            let _ = app_handle_spawn.emit("proxy-error", e);
        } else {
            // Emit success to trigger Smart Switch in frontend
            let _ = app_handle_spawn.emit("proxy-ready", &output_path_spawn);
        }
    });

    // Immediately return "Generating" status to the frontend
    Ok("Generating".to_string())
}

#[tauri::command]
pub async fn mux_video(
    app_handle: AppHandle,
    video_input: String,
    audio_input: String,
    output_path: String,
    duration: Option<f64>,
) -> Result<String, String> {
    let args = vec![
        "-y".to_string(),
        "-i".to_string(), video_input,
        "-i".to_string(), audio_input,
        "-c:v".to_string(), "copy".to_string(), // Copy video stream (no re-encode)
        "-c:a".to_string(), "aac".to_string(),  // Encode audio to AAC for MP4 compatibility
        "-b:a".to_string(), "192k".to_string(),
        "-map".to_string(), "0:v:0".to_string(), // Take video from first input
        "-map".to_string(), "1:a:0".to_string(), // Take audio from second input
        "-shortest".to_string(), 
        "-movflags".to_string(), "faststart".to_string(),
        output_path.clone(),
    ];

    run_ffmpeg_with_progress(app_handle, args, "Merging Video & Audio".to_string(), duration).await?;
    
    Ok(output_path)
}

#[tauri::command]
pub async fn create_blank_video(
    duration: f64,
    output_path: String,
) -> Result<String, String> {
    let output = std::process::Command::new("ffmpeg")
        .args(&[
            "-y",
            "-f", "lavfi",
            "-i", "color=c=black:s=1280x720:r=24",
            "-f", "lavfi",
            "-i", "anullsrc=cl=mono:r=48000",
            "-t", &duration.to_string(),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            &output_path
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!("FFmpeg failed to create blank video: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(output_path)
}
