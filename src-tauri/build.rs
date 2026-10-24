fn main() {
    let bin_dir = std::path::Path::new("bin");
    if !bin_dir.exists() {
        let _ = std::fs::create_dir_all(bin_dir);
    }
    let embedded_zip = bin_dir.join("embedded_ffmpeg.zip");
    if !embedded_zip.exists() {
        let _ = std::fs::write(&embedded_zip, &[]);
    }

    let static_vc = std::env::var("STATIC_VCRUNTIME")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    // SAFETY: build.rs is single-threaded at this point
    unsafe {
        std::env::remove_var("STATIC_VCRUNTIME");
    }

    let windows = tauri_build::WindowsAttributes::new().static_vc_runtime(static_vc);
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
