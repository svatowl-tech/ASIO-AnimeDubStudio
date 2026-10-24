#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio_engine;
mod export_engine;
mod db;
mod waveform_engine;
mod file_io;
mod media_processor;
mod logger;
mod script_parser;

use audio_engine::{get_audio_devices, start_recording, stop_recording, force_stop_all, check_crashes, AudioState, AudioRecorder};
use logger::log_debug;
use script_parser::parse_script_file;
use export_engine::{export_audio, export_stems, export_all_stems, quick_preview_export, batch_export, export_audio_book, export_backstage_video, export_blooper, process_backstage_shorts, process_backstage_remove_silence, export_backstage_assemble};
use db::{AppState, init_db, save_project_to_db, load_project_from_db, migrate_json_to_db, save_subtitles, generate_stress_test, load_segments_in_range, check_project_assets, verify_project_files, cleanup_orphaned_files, relink_segment_file, calculate_file_hash, find_file_by_hash};
use waveform_engine::{extract_audio_peaks_bin, generate_waveform_peaks};
use file_io::{read_text_file, read_binary_file, list_audio_files, write_audio_file, init_project_folder, move_project_folder, get_file_info, save_media_recorder_take, save_project_file, relink_project_paths_on_disk, copy_file_to_project, delete_file, append_backstage_chunk, finalize_backstage_session, list_backstage_sessions};
use media_processor::{create_proxy_video, mux_video, merge_segments, merge_project_segments, render_final_video, concat_backstage_videos, get_media_info, extract_mkv_assets, create_blank_video};

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri_plugin_dialog;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Listener};

#[derive(Deserialize, Debug)]
#[serde(tag = "action", content = "data", rename_all = "snake_case")]
enum DubstudioAction {
    #[serde(rename_all = "camelCase")]
    ExtractAudioPeaks { file_path: String, output_dir: String },
    #[serde(rename_all = "camelCase")]
    StartRecording {
        device_name: String,
        host_name: String,
        sample_rate: u32,
        buffer_size: u32,
        track_id: String,
        segment_id: String,
        start_time: f64,
        channel_index: u32,
        backstage_record: bool,
        video_device: Option<String>,
        audio_device: Option<String>,
        project_path: Option<String>,
        gate_enabled: bool,
        gate_threshold: Option<f32>,
        limiter_enabled: Option<bool>,
        limiter_threshold: Option<f32>,
    },
    #[serde(rename_all = "camelCase")]
    StopRecording {},
    #[serde(rename_all = "camelCase")]
    ForceStopAll {},
}

#[derive(Serialize, Clone)]
struct DubstudioResult {
    action: String,
    success: bool,
    data: serde_json::Value,
    error: Option<String>,
    request_id: Option<String>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_devtools(_window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    {
        _window.open_devtools();
    }
}

const EMBEDDED_FFMPEG_ZIP: &[u8] = include_bytes!("../bin/embedded_ffmpeg.zip");
static EXTRACT_EMBEDDED_ONCE: std::sync::Once = std::sync::Once::new();

fn get_portable_bin_dir() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            return std::path::PathBuf::from(local_app_data)
                .join("com.dubstudio.pro")
                .join("bin");
        }
        if let Ok(app_data) = std::env::var("APPDATA") {
            return std::path::PathBuf::from(app_data)
                .join("com.dubstudio.pro")
                .join("bin");
        }
    }
    std::env::temp_dir().join("com.dubstudio.pro").join("bin")
}

fn ensure_embedded_binaries_extracted() -> Option<std::path::PathBuf> {
    let target_dir = get_portable_bin_dir();
    if EMBEDDED_FFMPEG_ZIP.is_empty() {
        return if target_dir.exists() { Some(target_dir) } else { None };
    }

    EXTRACT_EMBEDDED_ONCE.call_once(|| {
        let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
        let ffmpeg_target = target_dir.join(format!("ffmpeg{}", ext));
        let ffprobe_target = target_dir.join(format!("ffprobe{}", ext));

        if ffmpeg_target.exists() && ffprobe_target.exists() {
            return;
        }

        if std::fs::create_dir_all(&target_dir).is_err() {
            return;
        }

        let cursor = std::io::Cursor::new(EMBEDDED_FFMPEG_ZIP);
        if let Ok(mut archive) = zip::ZipArchive::new(cursor) {
            for i in 0..archive.len() {
                if let Ok(mut file) = archive.by_index(i) {
                    if let Some(enclosed_name) = file.enclosed_name().and_then(|p| p.file_name().map(|f| f.to_os_string())) {
                        let out_path = target_dir.join(enclosed_name);
                        if !out_path.exists() {
                            if let Ok(mut out_file) = std::fs::File::create(&out_path) {
                                let _ = std::io::copy(&mut file, &mut out_file);
                            }
                            #[cfg(unix)]
                            {
                                use std::os::unix::fs::PermissionsExt;
                                let _ = std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(0o755));
                            }
                        }
                    }
                }
            }
        }
    });

    if target_dir.exists() {
        Some(target_dir)
    } else {
        None
    }
}

fn resolve_binary_path(bin_base: &str) -> String {
    let (target_triple, ext) = if cfg!(target_os = "windows") {
        ("x86_64-pc-windows-msvc", ".exe")
    } else if cfg!(target_arch = "aarch64") {
        ("aarch64-apple-darwin", "")
    } else {
        ("x86_64-apple-darwin", "")
    };

    let candidates = [
        format!("{}-{}{}", bin_base, target_triple, ext),
        format!("{}{}", bin_base, ext),
        format!("{}-aarch64-apple-darwin", bin_base),
        format!("{}-x86_64-apple-darwin", bin_base),
        format!("{}-x86_64-unknown-linux-gnu", bin_base),
        bin_base.to_string(),
    ];

    // 1. Check relative to current_exe()
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            for name in &candidates {
                for candidate_path in [
                    parent.join(name),
                    parent.join("bin").join(name),
                    parent.join("resources").join("bin").join(name),
                    parent.join("resources").join(name),
                    parent.join("ffmpeg-static").join(name),
                ] {
                    if candidate_path.exists() {
                        return candidate_path.to_string_lossy().to_string();
                    }
                }

                if let Some(p1) = parent.parent() {
                    for candidate_path in [
                        p1.join("bin").join(name),
                        p1.join("resources").join("bin").join(name),
                        p1.join("ffmpeg-static").join(name),
                    ] {
                        if candidate_path.exists() {
                            return candidate_path.to_string_lossy().to_string();
                        }
                    }
                    if let Some(p2) = p1.parent() {
                        let p2_bin = p2.join("bin").join(name);
                        if p2_bin.exists() {
                            return p2_bin.to_string_lossy().to_string();
                        }
                    }
                }
            }

            #[cfg(not(target_os = "windows"))]
            if let Some(macos_parent) = parent.parent() {
                for name in &candidates {
                    let macos_bin = macos_parent.join("Resources").join("bin").join(name);
                    if macos_bin.exists() {
                        return macos_bin.to_string_lossy().to_string();
                    }
                    let macos_res = macos_parent.join("Resources").join(name);
                    if macos_res.exists() {
                        return macos_res.to_string_lossy().to_string();
                    }
                }
            }
        }
    }

    // 2. Check portable self-extracted bin directory
    if let Some(portable_dir) = ensure_embedded_binaries_extracted() {
        for name in &candidates {
            let p = portable_dir.join(name);
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
    }

    // 3. Check standard Windows installation & package manager directories
    #[cfg(target_os = "windows")]
    {
        let mut win_dirs = Vec::new();
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let lad = std::path::PathBuf::from(&local_app_data);
            win_dirs.push(lad.join("com.dubstudio.pro").join("bin"));
            win_dirs.push(lad.join("DubStudio Pro").join("bin"));
            win_dirs.push(lad.join("DubStudio Pro"));
            win_dirs.push(lad.join("Programs").join("DubStudio Pro").join("bin"));
            win_dirs.push(lad.join("Programs").join("DubStudio Pro").join("resources").join("bin"));
            win_dirs.push(lad.join("Programs").join("DubStudio Pro"));
            win_dirs.push(lad.join("Microsoft").join("WinGet").join("Links"));
        }
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            let pf = std::path::PathBuf::from(&program_files);
            win_dirs.push(pf.join("DubStudio Pro").join("bin"));
            win_dirs.push(pf.join("DubStudio Pro").join("resources").join("bin"));
            win_dirs.push(pf.join("DubStudio Pro"));
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            win_dirs.push(std::path::PathBuf::from(user_profile).join("scoop").join("shims"));
        }
        win_dirs.push(std::path::PathBuf::from(r"C:\ProgramData\chocolatey\bin"));
        win_dirs.push(std::path::PathBuf::from(r"C:\ffmpeg\bin"));

        for dir in win_dirs {
            for name in &candidates {
                let p = dir.join(name);
                if p.exists() {
                    return p.to_string_lossy().to_string();
                }
            }
        }
    }

    // 4. Check standard macOS / Linux paths
    #[cfg(not(target_os = "windows"))]
    {
        for dir in &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            let p = std::path::Path::new(dir).join(bin_base);
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
    }

    bin_base.to_string()
}

pub fn get_ffmpeg_path() -> String {
    resolve_binary_path("ffmpeg")
}

pub fn get_ffprobe_path() -> String {
    resolve_binary_path("ffprobe")
}

pub fn is_ffmpeg_available() -> bool {
    let path = get_ffmpeg_path();
    if std::path::Path::new(&path).is_absolute() && std::path::Path::new(&path).exists() {
        return true;
    }
    let mut cmd = std::process::Command::new(&path);
    cmd.arg("-version");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

fn main() {
    // Shared empty state initially
    let app_state = AppState {
        db: Arc::new(Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            log_debug("--- APPLICATION STARTUP ---");
            let app_handle = app.handle().clone();
            
            // Register event listener for long-running actions
            let app_handle_events = app_handle.clone();
            app.listen("dubstudio-action", move |event| {
                let app_handle = app_handle_events.clone();
                let event_str = event.payload();
                
                // We need to parse the payload and request_id if present
                #[derive(Deserialize)]
                struct EventWrapper {
                    #[serde(flatten)]
                    action: DubstudioAction,
                    request_id: Option<String>,
                }

                let wrapper: Result<EventWrapper, _> = serde_json::from_str(event_str);
                
                if let Ok(w) = wrapper {
                    let request_id = w.request_id.clone();
                    let action_type = match &w.action {
                        DubstudioAction::ExtractAudioPeaks { .. } => "extract_audio_peaks",
                        DubstudioAction::StartRecording { .. } => "start_recording",
                        DubstudioAction::StopRecording { .. } => "stop_recording",
                        DubstudioAction::ForceStopAll { .. } => "force_stop_all",
                    }.to_string();

                    tauri::async_runtime::spawn(async move {
                        let result: Result<serde_json::Value, String> = match w.action {
                            DubstudioAction::ExtractAudioPeaks { file_path, output_dir } => {
                                extract_audio_peaks_bin(app_handle.clone(), file_path, output_dir)
                                    .await.map(|v| serde_json::to_value(v).unwrap())
                            },
                            DubstudioAction::StartRecording { 
                                device_name, host_name, sample_rate, buffer_size, track_id, segment_id, 
                                start_time, channel_index, backstage_record, video_device, 
                                audio_device, project_path, gate_enabled, gate_threshold, limiter_enabled, limiter_threshold
                            } => {
                                println!("Rust received start_recording action for dev: {}", device_name);
                                let state = app_handle.state::<AudioState>();
                                let res = start_recording(
                                    app_handle.clone(), state, device_name, host_name, sample_rate, 
                                    buffer_size, track_id, segment_id, start_time, channel_index, 
                                    backstage_record, video_device, audio_device, project_path, 
                                    gate_enabled, gate_threshold, limiter_enabled.unwrap_or(false), limiter_threshold.unwrap_or(-9.0)
                                ).await;

                                if res.is_ok() {
                                    println!("Recording started successfully, emitting recording-started event");
                                    let _ = app_handle.emit("recording-started", serde_json::json!({}));
                                }

                                res.map(|_| serde_json::Value::Null)
                            },
                            DubstudioAction::StopRecording { .. } => {
                                let state = app_handle.state::<AudioState>();
                                stop_recording(state).await.map(|v| serde_json::to_value(v).unwrap())
                            },
                            DubstudioAction::ForceStopAll { .. } => {
                                let state = app_handle.state::<AudioState>();
                                force_stop_all(state).await.map(|_| serde_json::Value::Null)
                            }
                        };

                        let (success, data, error) = match result {
                            Ok(d) => (true, d, None),
                            Err(e) => (false, serde_json::Value::Null, Some(e)),
                        };

                        let _ = app_handle.emit("dubstudio-result", DubstudioResult {
                            action: action_type,
                            success,
                            data,
                            error,
                            request_id,
                        });
                    });
                } else {
                    eprintln!("Failed to parse dubstudio-action: {}", event_str);
                }
            });

            // Use Tauri 2.0 path resolver with resilient fallbacks
            use tauri::Manager;
            let app_data_dir = app_handle.path().app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("com.dubstudio.pro"));
            let _ = std::fs::create_dir_all(&app_data_dir);
            let db_path = app_data_dir.join("dev.db");
            let db_path_str = db_path.to_string_lossy().to_string();

            tauri::async_runtime::spawn(async move {
                // Initialize database asynchronously 
                match init_db(&db_path_str).await {
                    Ok(pool) => {
                        let state = app_handle.state::<AppState>();
                        let mut db_lock = state.db.lock().await;
                        *db_lock = Some(pool);
                        println!("SQLx Database initialized successfully at {}", db_path_str);
                    }
                    Err(e) => {
                        eprintln!("Failed to initialize DB: {}", e);
                    }
                }
            });

            Ok(())
        })
        .manage(app_state)
        .manage(AudioState {
            recorder: std::sync::Mutex::new(AudioRecorder::default()),
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            open_devtools,
            get_audio_devices,
            start_recording,
            stop_recording,
            force_stop_all,
            check_crashes,
            export_audio,
            export_stems,
            save_project_to_db,
            load_project_from_db,
            migrate_json_to_db,
            extract_audio_peaks_bin,
            generate_waveform_peaks,
            read_text_file,
            read_binary_file,
            list_audio_files,
            write_audio_file,
            init_project_folder,
            move_project_folder,
            get_file_info,
            save_media_recorder_take,
            append_backstage_chunk,
            finalize_backstage_session,
            list_backstage_sessions,
            save_project_file,
            relink_project_paths_on_disk,
            copy_file_to_project,
            delete_file,
            save_subtitles,
            generate_stress_test,
            load_segments_in_range,
            check_project_assets,
            verify_project_files,
            cleanup_orphaned_files,
            relink_segment_file,
            calculate_file_hash,
            find_file_by_hash,
            create_proxy_video,
            mux_video,
            render_final_video,
            merge_segments,
            merge_project_segments,
            export_all_stems,
            quick_preview_export,
            batch_export,
            export_audio_book,
            export_backstage_video,
            export_blooper,
            process_backstage_shorts,
            process_backstage_remove_silence,
            export_backstage_assemble,
            concat_backstage_videos,
            get_media_info,
            extract_mkv_assets,
            create_blank_video,
            parse_script_file
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("Error while running tauri application: {:?}", e);
            std::process::exit(1);
        });
}

// EOF

