use std::fs;
// sync
use std::path::{Path, PathBuf};
use serde::Serialize;
use hound;

/// Resolves a media file path that may have been moved with its project folder
/// (e.g., when a user moves or renames `<Project>_Project` on disk).
pub fn resolve_existing_media_path(
    raw_path: &str,
    project_path_hint: Option<&str>,
    output_path_hint: Option<&str>,
    extra_dirs: &[PathBuf],
) -> PathBuf {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return PathBuf::new();
    }

    let direct = PathBuf::from(trimmed);
    if direct.exists() {
        return direct;
    }

    let normalized = trimmed.replace('\\', "/");
    let norm_path = PathBuf::from(&normalized);
    if norm_path.exists() {
        return norm_path;
    }

    #[cfg(target_os = "windows")]
    {
        let win_str = trimmed.replace('/', "\\");
        let win_path = PathBuf::from(&win_str);
        if win_path.exists() {
            return win_path;
        }
    }

    let parts: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    let Some(&file_name) = parts.last() else {
        return direct;
    };

    // Identify known project subfolder ("takes", "assets", "proxies", ".dubstudio") and old project folder name
    let mut known_subdir: Option<&str> = None;
    let mut old_project_dir_name: Option<&str> = None;
    for (idx, part) in parts.iter().enumerate() {
        let lower = part.to_lowercase();
        if matches!(lower.as_str(), "takes" | "assets" | "proxies" | ".dubstudio") {
            known_subdir = Some(*part);
            if idx > 0 {
                old_project_dir_name = Some(parts[idx - 1]);
            }
            break;
        }
        if lower.ends_with("_project") {
            old_project_dir_name = Some(*part);
        }
    }

    let mut search_roots: Vec<PathBuf> = Vec::new();
    let mut push_unique = |p: PathBuf| {
        if !p.as_os_str().is_empty() && !search_roots.contains(&p) {
            search_roots.push(p);
        }
    };

    if let Some(proj) = project_path_hint {
        let p = PathBuf::from(proj.trim());
        push_unique(p.clone());
        if let Some(parent) = p.parent() {
            push_unique(parent.to_path_buf());
        }
    }

    for d in extra_dirs {
        push_unique(d.clone());
        if let Some(parent) = d.parent() {
            push_unique(parent.to_path_buf());
        }
    }

    if let Some(out) = output_path_hint {
        let out_p = PathBuf::from(out.trim());
        let mut curr = if out_p.is_dir() { Some(out_p.as_path()) } else { out_p.parent() };
        for _ in 0..4 {
            if let Some(c) = curr {
                push_unique(c.to_path_buf());
                curr = c.parent();
            } else {
                break;
            }
        }
    }

    let subdirs = ["takes", "assets", "proxies", ".dubstudio"];

    // 1. Direct candidate checks inside each root
    for root in &search_roots {
        if !root.exists() {
            continue;
        }

        if let Some(sub) = known_subdir {
            let cand = root.join(sub).join(file_name);
            if cand.exists() {
                return cand;
            }
        }

        let direct_in_root = root.join(file_name);
        if direct_in_root.exists() {
            return direct_in_root;
        }

        for sub in &subdirs {
            let cand = root.join(sub).join(file_name);
            if cand.exists() {
                return cand;
            }
        }

        if let Some(proj_name) = old_project_dir_name {
            let proj_cand = root.join(proj_name);
            if proj_cand.exists() {
                if let Some(sub) = known_subdir {
                    let cand = proj_cand.join(sub).join(file_name);
                    if cand.exists() {
                        return cand;
                    }
                }
                for sub in &subdirs {
                    let cand = proj_cand.join(sub).join(file_name);
                    if cand.exists() {
                        return cand;
                    }
                }
                let cand = proj_cand.join(file_name);
                if cand.exists() {
                    return cand;
                }
            }
        }
    }

    // 2. Shallow scan (up to 2 levels) under search_roots for moved `*_Project` or `takes/` directories
    for root in &search_roots {
        let Ok(entries) = fs::read_dir(root) else { continue };
        for entry in entries.flatten() {
            let child = entry.path();
            if !child.is_dir() {
                continue;
            }
            for sub in &subdirs {
                let cand = child.join(sub).join(file_name);
                if cand.exists() {
                    return cand;
                }
            }
            let cand_direct = child.join(file_name);
            if cand_direct.exists() {
                return cand_direct;
            }
            // Level 2 (e.g., C:\киберпанк2\1\<Project>_Project\takes\<file>)
            if let Ok(sub_entries) = fs::read_dir(&child) {
                for sub_entry in sub_entries.flatten() {
                    let grandchild = sub_entry.path();
                    if !grandchild.is_dir() {
                        continue;
                    }
                    for sub in &subdirs {
                        let cand = grandchild.join(sub).join(file_name);
                        if cand.exists() {
                            return cand;
                        }
                    }
                }
            }
        }
    }

    direct
}

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
    let resolved_buf = resolve_existing_media_path(&path, None, None, &[]);
    let p = if resolved_buf.exists() { resolved_buf.as_path() } else { Path::new(&path) };
    let metadata = fs::metadata(p).map_err(|e| e.to_string())?;
    
    let resolved_path = if let Ok(canonical) = fs::canonicalize(p) {
        let mut s = canonical.to_string_lossy().to_string();
        if s.starts_with(r"\\?\") {
            s = s[4..].to_string();
        }
        s.replace('\\', "/")
    } else {
        p.to_string_lossy().replace('\\', "/")
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
    
    let webm_str = webm_path.to_string_lossy().to_string();
    let mp4_str = mp4_path.to_string_lossy().to_string();

    let mut cmd = std::process::Command::new(crate::get_ffmpeg_path());
    cmd.args(&[
        "-nostdin",
        "-y",
        "-i", &webm_str,
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "ultrafast",
        "-c:a", "aac",
        "-b:a", "192k",
        &mp4_str
    ]);
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    
    match cmd.output() {
        Ok(output) if output.status.success() && mp4_path.exists() => {
            let _ = fs::remove_file(&webm_path);
            Ok(mp4_str)
        }
        _ => {
            // If FFmpeg is unavailable in portable mode or transcode fails, keep the native .webm file
            Ok(webm_str)
        }
    }
}

#[tauri::command]
pub async fn save_media_recorder_take(project_path: String, role: String, data: Vec<u8>) -> Result<String, String> {
    if project_path.trim().is_empty() || project_path == "/mock/path" {
        return Err("Папка проекта не задана или недоступна для записи".to_string());
    }

    let epoch_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_millis(0))
        .as_millis();
    
    // Use hierarchy: {project_path}/takes/
    let takes_dir = Path::new(&project_path).join("takes");
    if !takes_dir.exists() {
        fs::create_dir_all(&takes_dir).map_err(|e| format!("Не удалось создать папку takes ({}): {}", takes_dir.display(), e))?;
    }

    let is_backstage = role.contains("backstage");
    let safe_role: String = role
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let safe_role = if safe_role.trim().is_empty() { "unknown".to_string() } else { safe_role };

    let file_ext = if is_backstage { "mp4" } else { "wav" };
    let file_name = format!("take_{}_{}.{}", safe_role, epoch_ms, file_ext);
    let target_path = takes_dir.join(&file_name);
    let target_path_str = target_path.to_string_lossy().to_string();

    // Fast & dependency-free path: if audio data is already encoded as RIFF WAVE in the browser, write directly!
    if !is_backstage && data.len() > 44 && &data[0..4] == b"RIFF" && &data[8..12] == b"WAVE" {
        fs::write(&target_path, &data).map_err(|e| format!("Не удалось записать WAV-файл на диск: {}", e))?;
        return Ok(target_path_str);
    }
    
    // Write webm data to a temporary file in takes dir
    let temp_name = format!("temp_{}.webm", epoch_ms);
    let temp_path = takes_dir.join(&temp_name);
    fs::write(&temp_path, &data).map_err(|e| format!("Не удалось записать временный файл в папку проекта: {}", e))?;

    let temp_path_str = temp_path.to_string_lossy().to_string();

    // Use FFmpeg to convert if available
    let mut command = std::process::Command::new(crate::get_ffmpeg_path());
    command.arg("-nostdin").arg("-y").arg("-i").arg(&temp_path_str);
    
    if is_backstage {
        command.args(&[
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "28",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-ar", "48000",
            "-ac", "1",
            &target_path_str
        ]);
    } else {
        command.args(&[
            "-ar", "48000",
            "-ac", "1",
            &target_path_str
        ]);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    match command.output() {
        Ok(status) if status.status.success() && target_path.exists() => {
            let _ = fs::remove_file(&temp_path);
            Ok(target_path_str)
        }
        _ => {
            // Portable fallback if FFmpeg is missing ("program not found") or fails:
            // Preserve the recorded file as .webm so the user never loses a take
            let fallback_name = format!("take_{}_{}.webm", safe_role, epoch_ms);
            let fallback_path = takes_dir.join(&fallback_name);
            let fallback_str = fallback_path.to_string_lossy().to_string();
            if fs::rename(&temp_path, &fallback_path).is_ok() {
                Ok(fallback_str)
            } else {
                Ok(temp_path_str)
            }
        }
    }
}

#[tauri::command]
pub fn init_project_folder(path: String) -> Result<(), String> {
    if path.trim().is_empty() || path == "/mock/path" {
        return Err("Путь к папке проекта пуст или некорректен".to_string());
    }
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

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| format!("Не удалось создать папку {}: {}", dst.display(), e))?;
    }
    let entries = fs::read_dir(src).map_err(|e| format!("Не удалось прочитать папку {}: {}", src.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            // Avoid infinite recursion if dst is inside src
            if dst.starts_with(&src_path) {
                continue;
            }
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if file_type.is_file() {
            let _ = fs::copy(&src_path, &dst_path);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn move_project_folder(old_path: String, new_path: String) -> Result<String, String> {
    init_project_folder(new_path.clone())?;

    let old_dir = Path::new(&old_path);
    let new_dir = Path::new(&new_path);

    if !old_path.trim().is_empty() && old_path != "/mock/path" && old_dir.exists() && old_dir != new_dir {
        let _ = copy_dir_recursive(old_dir, new_dir);
    }

    Ok(new_path)
}

#[tauri::command]
pub fn save_project_file(path: String, data: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories for project file: {}", e))?;
        }
    }
    // Protect against accidental overwrite of a project that had recorded takes with an empty project
    if p.exists() {
        if let Ok(existing_content) = fs::read_to_string(p) {
            let old_has_takes = existing_content.contains("take_");
            let new_has_takes = data.contains("take_");
            if old_has_takes && !new_has_takes {
                let bak_path = PathBuf::from(format!("{}.bak", path));
                let _ = fs::write(&bak_path, &existing_content);
            }
        }
    }
    fs::write(p, data).map_err(|e| format!("Failed to save project file: {}", e))
}

#[tauri::command]
pub fn relink_project_paths_on_disk(project_path: String, project_json: String) -> Result<String, String> {
    let proj_dir = PathBuf::from(project_path.trim());
    let proj_dir_norm = project_path.trim().replace('\\', "/");

    let mut root: serde_json::Value = serde_json::from_str(&project_json)
        .map_err(|e| format!("Invalid project JSON: {}", e))?;

    if !proj_dir_norm.is_empty() {
        root["projectPath"] = serde_json::Value::String(proj_dir_norm.clone());
    }

    // 1. Relink top-level media paths (videoPath, referenceAudioPath, documentPath)
    for key in ["videoPath", "referenceAudioPath", "documentPath"] {
        if let Some(val_str) = root.get(key).and_then(|v| v.as_str()).map(|s| s.to_string()) {
            if !val_str.is_empty() && !val_str.starts_with("blob:") && !val_str.starts_with("http") {
                let resolved = resolve_existing_media_path(&val_str, Some(&proj_dir_norm), None, &[]);
                if resolved.exists() {
                    root[key] = serde_json::Value::String(resolved.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }

    // 2. Count existing dub segments on non-original tracks
    let count_dub_segments = |val: &serde_json::Value| -> usize {
        let mut count = 0usize;
        if let Some(tracks) = val.get("tracks").and_then(|t| t.as_array()) {
            for t in tracks {
                let t_name = t.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let t_id = t.get("id").and_then(|n| n.as_str()).unwrap_or("");
                if t_name == "Оригинал" || t_name == "Original" || t_id == "originals-track" {
                    continue;
                }
                if let Some(segs) = t.get("segments").and_then(|s| s.as_array()) {
                    count += segs.len();
                }
            }
        }
        count
    };

    let mut dub_seg_count = count_dub_segments(&root);

    // 3. If project has 0 dub segments, check if a `.dub.bak` backup in `project_path` has segments
    if dub_seg_count == 0 && proj_dir.exists() {
        if let Ok(entries) = fs::read_dir(&proj_dir) {
            for entry in entries.flatten() {
                let ep = entry.path();
                let fname = ep.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if fname.ends_with(".dub.bak") {
                    if let Ok(bak_str) = fs::read_to_string(&ep) {
                        if let Ok(bak_val) = serde_json::from_str::<serde_json::Value>(&bak_str) {
                            if count_dub_segments(&bak_val) > 0 {
                                if let Some(bak_tracks) = bak_val.get("tracks").cloned() {
                                    root["tracks"] = bak_tracks;
                                    dub_seg_count = count_dub_segments(&root);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Relink all existing segments in tracks to current `project_path`
    if let Some(tracks) = root.get_mut("tracks").and_then(|t| t.as_array_mut()) {
        for track in tracks.iter_mut() {
            if let Some(segments) = track.get_mut("segments").and_then(|s| s.as_array_mut()) {
                for seg in segments.iter_mut() {
                    for path_key in ["filePath", "backstageVideoPath"] {
                        if let Some(fp) = seg.get(path_key).and_then(|v| v.as_str()).map(|s| s.to_string()) {
                            if !fp.is_empty() && !fp.starts_with("blob:") && !fp.starts_with("http") {
                                let resolved = resolve_existing_media_path(&fp, Some(&proj_dir_norm), None, &[]);
                                if resolved.exists() {
                                    let clean_p = resolved.to_string_lossy().replace('\\', "/");
                                    seg[path_key] = serde_json::Value::String(clean_p);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 5. If dub_seg_count is STILL 0, check if `<project_path>/takes/` has recorded `take_*.wav` files
    // and automatically recover them onto the Dubs track so the user never loses their takes!
    if dub_seg_count == 0 && proj_dir.exists() {
        let takes_dir = proj_dir.join("takes");
        if takes_dir.exists() {
            struct OrphanTake {
                file_path: String,
                role: String,
                epoch_ms: u128,
                duration: f64,
            }
            let mut found_takes: Vec<OrphanTake> = Vec::new();
            if let Ok(entries) = fs::read_dir(&takes_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if !p.is_file() {
                        continue;
                    }
                    let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    let lower = fname.to_lowercase();
                    if !lower.starts_with("take_") || (!lower.ends_with(".wav") && !lower.ends_with(".webm")) {
                        continue;
                    }
                    if lower.contains("backstage") {
                        continue;
                    }
                    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                    let without_prefix = stem.strip_prefix("take_").unwrap_or(stem);
                    let (role_part, epoch_val) = if let Some(last_underscore) = without_prefix.rfind('_') {
                        let r = &without_prefix[..last_underscore];
                        let e_str = &without_prefix[last_underscore + 1..];
                        let e = e_str.parse::<u128>().unwrap_or(0);
                        (r.to_string(), e)
                    } else {
                        ("Default".to_string(), 0)
                    };

                    let duration = if lower.ends_with(".wav") {
                        match hound::WavReader::open(&p) {
                            Ok(reader) => {
                                let spec = reader.spec();
                                (reader.duration() as f64 / spec.sample_rate.max(1) as f64).max(0.2)
                            }
                            Err(_) => 2.5,
                        }
                    } else {
                        2.5
                    };

                    found_takes.push(OrphanTake {
                        file_path: p.to_string_lossy().replace('\\', "/"),
                        role: role_part,
                        epoch_ms: epoch_val,
                        duration,
                    });
                }
            }

            if !found_takes.is_empty() {
                found_takes.sort_by_key(|t| t.epoch_ms);

                // Collect subtitle lines to align recovered takes if possible
                #[derive(Clone)]
                struct SubInfo {
                    start: f64,
                    role: String,
                    used: bool,
                }
                let mut subs: Vec<SubInfo> = Vec::new();
                if let Some(sub_arr) = root.get("subtitles").and_then(|s| s.as_array()) {
                    for s in sub_arr {
                        let start = s.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let role = s.get("role").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        subs.push(SubInfo { start, role, used: false });
                    }
                }

                let mut recovered_segments: Vec<serde_json::Value> = Vec::new();
                let mut fallback_cursor = 0.0f64;

                for (idx, take) in found_takes.iter().enumerate() {
                    let take_role_norm = take.role.to_lowercase();
                    // Try matching unused subtitle with same role
                    let mut matched_start: Option<f64> = None;
                    for sub in subs.iter_mut() {
                        if !sub.used {
                            let sub_role_norm: String = sub.role
                                .chars()
                                .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
                                .collect::<String>()
                                .to_lowercase();
                            if !take_role_norm.is_empty()
                                && take_role_norm != "unknown"
                                && take_role_norm != "default"
                                && sub_role_norm == take_role_norm
                            {
                                sub.used = true;
                                matched_start = Some(sub.start);
                                break;
                            }
                        }
                    }
                    // If no role-specific subtitle matched, try next unused subtitle if any
                    if matched_start.is_none() && !subs.is_empty() {
                        if let Some(sub) = subs.iter_mut().find(|s| !s.used && s.start >= fallback_cursor) {
                            sub.used = true;
                            matched_start = Some(sub.start);
                        }
                    }

                    let start_time = matched_start.unwrap_or(fallback_cursor);
                    fallback_cursor = (start_time + take.duration + 0.3).max(fallback_cursor + take.duration);

                    recovered_segments.push(serde_json::json!({
                        "id": format!("recovered-{}-{}", take.epoch_ms, idx),
                        "startTime": start_time,
                        "duration": take.duration,
                        "fileOffset": 0.0,
                        "fileDuration": take.duration,
                        "filePath": take.file_path,
                        "blobUrl": "",
                        "gain": 1.0,
                        "playbackRate": 1.0
                    }));
                }

                if !recovered_segments.is_empty() {
                    let mut placed = false;
                    if let Some(tracks) = root.get_mut("tracks").and_then(|t| t.as_array_mut()) {
                        for track in tracks.iter_mut() {
                            let t_name = track.get("name").and_then(|n| n.as_str()).unwrap_or("");
                            let t_id = track.get("id").and_then(|n| n.as_str()).unwrap_or("");
                            if t_name != "Оригинал" && t_name != "Original" && t_id != "originals-track" {
                                track["segments"] = serde_json::Value::Array(recovered_segments.clone());
                                placed = true;
                                break;
                            }
                        }
                        if !placed {
                            tracks.push(serde_json::json!({
                                "id": "track-recovered-dubs",
                                "name": "Dubs 1",
                                "volume": 1.0,
                                "isMuted": false,
                                "isArmed": true,
                                "segments": recovered_segments
                            }));
                        }
                    }
                }
            }
        }
    }

    serde_json::to_string(&root).map_err(|e| e.to_string())
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
    if let Some(parent) = dest_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    if src_path != dest_path {
        fs::copy(&src, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;
    }
    
    Ok(dest_path.to_string_lossy().to_string())
}
