const fs = require('fs');
let code = fs.readFileSync('src-tauri/src/export_engine.rs', 'utf8');

const newCode = `#[tauri::command]
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
}`;

code = code.replace(/#\[tauri::command\]\npub async fn process_backstage_shorts[\s\S]*?Ok\(output_path\)\n\}/, newCode);
fs.writeFileSync('src-tauri/src/export_engine.rs', code);
