#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio_engine;
mod export_engine;
mod db;
mod waveform_engine;
mod file_io;
mod media_processor;
mod logger;

use audio_engine::{get_audio_devices, start_recording, stop_recording, force_stop_all, check_crashes, AudioState, AudioRecorder};
use logger::log_debug;
use export_engine::{export_audio, export_stems, export_all_stems, quick_preview_export, batch_export, export_audio_book, export_backstage_video, export_blooper, process_backstage_shorts, process_backstage_remove_silence, export_backstage_assemble};
use db::{AppState, init_db, save_project_to_db, load_project_from_db, migrate_json_to_db, save_subtitles, generate_stress_test, load_segments_in_range, check_project_assets, verify_project_files, cleanup_orphaned_files, relink_segment_file, calculate_file_hash, find_file_by_hash};
use waveform_engine::{extract_audio_peaks_bin, generate_waveform_peaks};
use file_io::{read_text_file, read_binary_file, list_audio_files, write_audio_file, init_project_folder, get_file_info, save_media_recorder_take, save_project_file, copy_file_to_project, delete_file, append_backstage_chunk, finalize_backstage_session, list_backstage_sessions};
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
fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();
    
    #[cfg(not(debug_assertions))]
    window.open_devtools(); // Try forcing it in release mode too (requires devtools feature)
}

pub fn get_ffmpeg_path() -> String {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let (target_triple, ext) = if cfg!(target_os = "windows") {
                ("x86_64-pc-windows-msvc", ".exe")
            } else if cfg!(target_arch = "aarch64") {
                ("aarch64-apple-darwin", "")
            } else {
                ("x86_64-apple-darwin", "")
            };
            
            // First check if the exact sidecar exists
            let sidecar_ffmpeg = parent.join(format!("ffmpeg-{}{}", target_triple, ext));
            if sidecar_ffmpeg.exists() {
                return sidecar_ffmpeg.to_str().unwrap_or("ffmpeg").to_string();
            }
            
            // Then check if it's in resources/bin (Tauri v2 resources)
            let resources_ffmpeg = parent.join("resources").join("bin").join(format!("ffmpeg-{}{}", target_triple, ext));
            if resources_ffmpeg.exists() {
                return resources_ffmpeg.to_str().unwrap_or("ffmpeg").to_string();
            }
            
            // On macOS, resources are in ../Resources/bin
            #[cfg(not(target_os = "windows"))]
            if let Some(macos_parent) = parent.parent() {
                let macos_resources = macos_parent.join("Resources").join("bin").join(format!("ffmpeg-{}", target_triple));
                if macos_resources.exists() {
                    return macos_resources.to_str().unwrap_or("ffmpeg").to_string();
                }
            }
        }
    }
    "ffmpeg".to_string()
}

pub fn get_ffprobe_path() -> String {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let (target_triple, ext) = if cfg!(target_os = "windows") {
                ("x86_64-pc-windows-msvc", ".exe")
            } else if cfg!(target_arch = "aarch64") {
                ("aarch64-apple-darwin", "")
            } else {
                ("x86_64-apple-darwin", "")
            };
            
            // First check if the exact sidecar exists
            let sidecar_ffprobe = parent.join(format!("ffprobe-{}{}", target_triple, ext));
            if sidecar_ffprobe.exists() {
                return sidecar_ffprobe.to_str().unwrap_or("ffprobe").to_string();
            }
            
            // Then check if it's in resources/bin (Tauri v2 resources)
            let resources_ffprobe = parent.join("resources").join("bin").join(format!("ffprobe-{}{}", target_triple, ext));
            if resources_ffprobe.exists() {
                return resources_ffprobe.to_str().unwrap_or("ffprobe").to_string();
            }
            
            // On macOS, resources are in ../Resources/bin
            #[cfg(not(target_os = "windows"))]
            if let Some(macos_parent) = parent.parent() {
                let macos_resources = macos_parent.join("Resources").join("bin").join(format!("ffprobe-{}", target_triple));
                if macos_resources.exists() {
                    return macos_resources.to_str().unwrap_or("ffprobe").to_string();
                }
            }
        }
    }
    "ffprobe".to_string()
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

            // Use Tauri 2.0 path resolver
            use tauri::Manager;
            let app_data_dir = match app_handle.path().app_data_dir() {
                Ok(dir) => dir,
                Err(e) => {
                    eprintln!("Failed to get app data dir: {}", e);
                    std::process::exit(1);
                }
            };
            let _ = std::fs::create_dir_all(&app_data_dir);
            let db_path = app_data_dir.join("dev.db");
            let db_path_str = match db_path.to_str() {
                Some(s) => s.to_string(),
                None => {
                    eprintln!("Path is not valid UTF-8");
                    std::process::exit(1);
                }
            };

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
            get_file_info,
            save_media_recorder_take,
            append_backstage_chunk,
            finalize_backstage_session,
            list_backstage_sessions,
            save_project_file,
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
            create_blank_video
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("Error while running tauri application: {:?}", e);
            std::process::exit(1);
        });
}

// EOF

