use std::fs;
// sync
use std::path::Path;
use serde::Serialize;
use hound;

#[derive(Serialize)]
pub struct AudioFileEntry {
    pub path: String,
    pub name: String,
    pub duration: f64,
}

#[derive(Serialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub duration: Option<f64>,
}

#[tauri::command]
pub fn get_file_info(path: String) -> Result<FileInfo, String> {
    let p = Path::new(&path);
    let metadata = fs::metadata(p).map_err(|e| e.to_string())?;
    
    let resolved_path = if let Ok(canonical) = fs::canonicalize(p) {
        let mut s = canonical.to_string_lossy().to_string();
        if s.starts_with(r"\\?\") {
            s = s[4..].to_string();
        }
        s.replace('\\', "/")
    } else {
        path.clone().replace('\\', "/")
    };

    let mut duration = None;
    if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
        if ext.to_lowercase() == "wav" {
            if let Ok(reader) = hound::WavReader::open(p) {
                let spec = reader.spec();
                duration = Some(reader.duration() as f64 / spec.sample_rate as f64);
            }
        }
    }

    Ok(FileInfo {
        path: resolved_path,
        name: p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
        size: metadata.len(),
        duration,
    })
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| format!("Failed to read binary file: {}", e))
}

#[tauri::command]
pub fn list_audio_files(folder_path: String) -> Result<Vec<AudioFileEntry>, String> {
    let mut entries = Vec::new();
    let paths = fs::read_dir(folder_path).map_err(|e| e.to_string())?;

    for path_result in paths {
        if let Ok(path_entry) = path_result {
            let path = path_entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
                if ext.to_lowercase() == "wav" {
                    // Try to get duration using hound
                    let duration = match hound::WavReader::open(&path) {
                        Ok(reader) => {
                            let spec = reader.spec();
                            reader.duration() as f64 / spec.sample_rate as f64
                        }
                        Err(_) => 0.0,
                    };

                    entries.push(AudioFileEntry {
                        path: path.to_str().unwrap_or("").to_string(),
                        name: path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
                        duration,
                    });
                }
            }
        }
    }
    Ok(entries)
}

#[tauri::command]
pub fn write_audio_file(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(path, data).map_err(|e| format!("Failed to write audio file: {}", e))
}

#[tauri::command]
pub async fn append_backstage_chunk(project_path: String, session_id: String, data: Vec<u8>) -> Result<(), String> {
    let takes_dir = Path::new(&project_path).join("takes");
    if !takes_dir.exists() {
        fs::create_dir_all(&takes_dir).map_err(|e| e.to_string())?;
    }
    
    let file_name = format!("backstage_session_{}.webm", session_id);
    let target_path = takes_dir.join(&file_name);
    
    use std::fs::OpenOptions;
    use std::io::Write;
    
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&target_path)
        .map_err(|e| e.to_string())?;
        
    file.write_all(&data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_backstage_sessions(project_path: String) -> Result<Vec<String>, String> {
    let takes_dir = Path::new(&project_path).join("takes");
    if !takes_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut sessions = Vec::new();
    if let Ok(entries) = fs::read_dir(takes_dir) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_file() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if file_name.starts_with("backstage_session_") && file_name.ends_with(".json") {
                        if let Ok(content) = fs::read_to_string(entry.path()) {
                            sessions.push(content);
                        }
                    }
                }
            }
        }
    }
    
    Ok(sessions)
}

#[tauri::command]
pub async fn finalize_backstage_session(project_path: String, session_id: String) -> Result<String, String> {
    let takes_dir = Path::new(&project_path).join("takes");
    let webm_name = format!("backstage_session_{}.webm", session_id);
    let webm_path = takes_dir.join(&webm_name);
    
    if !webm_path.exists() {
        return Err("Session file not found".to_string());
    }
    
    let mp4_name = format!("backstage_session_{}_fixed.mp4", session_id);
    let mp4_path = takes_dir.join(&mp4_name);
    
    let mut cmd = std::process::Command::new(crate::get_ffmpeg_path());
    cmd.args(&[
        "-nostdin",
        "-y",
        "-i", webm_path.to_str().unwrap(),
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "ultrafast",
        "-c:a", "aac",
        "-b:a", "192k",
        mp4_path.to_str().unwrap()
    ]);
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    
    let output = cmd.output().map_err(|e| format!("FFmpeg failed: {}", e))?;
    
    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg error: {}", err_msg));
    }
    
    // Optionally remove the webm file to save space
    let _ = fs::remove_file(&webm_path);
    
    Ok(mp4_path.to_str().unwrap().to_string())
}

#[tauri::command]
pub async fn save_media_recorder_take(project_path: String, role: String, data: Vec<u8>) -> Result<String, String> {
    let epoch_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    
    // Use hierarchy: {project_path}/takes/
    let takes_dir = Path::new(&project_path).join("takes");
    if !takes_dir.exists() {
        fs::create_dir_all(&takes_dir).map_err(|e| e.to_string())?;
    }

    let is_backstage = role.contains("backstage");
    let file_ext = if is_backstage { "mp4" } else { "wav" };
    let file_name = format!("take_{}_{}.{}", role, epoch_ms, file_ext);
    
    // Write webm data to a temporary file in takes dir
    let temp_name = format!("temp_{}.webm", epoch_ms);
    let temp_path = takes_dir.join(&temp_name);
    fs::write(&temp_path, data).map_err(|e| e.to_string())?;

    let target_path = takes_dir.join(&file_name);

    // Use FFmpeg to convert
    // If backstage, convert to MP4 with consistent specs for later concatenation
    // If not backstage (audio), convert to WAV
    let mut command = std::process::Command::new(crate::get_ffmpeg_path());
    command.arg("-nostdin").arg("-y").arg("-i").arg(temp_path.to_str().unwrap());
    
    if is_backstage {
        command.args(&[
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "28",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-ar", "48000",
            "-ac", "1",
            target_path.to_str().unwrap()
        ]);
    } else {
        command.args(&[
            "-ar", "48000",
            "-ac", "1",
            target_path.to_str().unwrap()
        ]);
    }

    let status = command.output().map_err(|e| e.to_string())?;

    // Clean up temporary webm file
    let _ = fs::remove_file(&temp_path);

    if !status.status.success() {
        return Err(format!("FFmpeg failed: {}", String::from_utf8_lossy(&status.stderr)));
    }

    Ok(target_path.to_str().unwrap().to_string())
}

#[tauri::command]
pub fn init_project_folder(path: String) -> Result<(), String> {
    let project_dir = Path::new(&path);
    
    // Create hierarchy
    let subdirs = ["takes", "proxies", "exports", "assets"];
    for dir in subdirs {
        let full_path = project_dir.join(dir);
        if !full_path.exists() {
            fs::create_dir_all(&full_path).map_err(|e| format!("Failed to create subdir {}: {}", dir, e))?;
        }
    }
    
    // Support legacy .dubstudio for compatibility with older takes if needed, 
    // but the app should transition to 'takes' folder.
    let dub_dir = project_dir.join(".dubstudio");
    if !dub_dir.exists() {
        fs::create_dir_all(&dub_dir).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn save_project_file(path: String, data: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories for project file: {}", e))?;
        }
    }
    fs::write(p, data).map_err(|e| format!("Failed to save project file: {}", e))
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    if std::path::Path::new(&path).exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn copy_file_to_project(src: String, dest_dir: String) -> Result<String, String> {
    let src_path = Path::new(&src);
    let file_name = src_path.file_name().ok_or("Invalid source file name")?;
    
    let dest_path = Path::new(&dest_dir).join(file_name);
    fs::copy(&src, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;
    
    Ok(dest_path.to_str().unwrap().to_string())
}
