fn main() {
    let bin_dir = std::path::Path::new("bin");
    if !bin_dir.exists() {
        let _ = std::fs::create_dir_all(bin_dir);
    }
    let embedded_zip = bin_dir.join("embedded_ffmpeg.zip");
    if !embedded_zip.exists() {
        let _ = std::fs::write(&embedded_zip, &[]);
    }
    tauri_build::build();
}
