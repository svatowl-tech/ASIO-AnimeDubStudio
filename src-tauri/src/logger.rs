use std::io::Write;

pub fn log_debug(msg: &str) {
    let log_path = std::env::temp_dir().join("dubstudio_audio_debug.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::from_secs(0))
            .as_millis();
        let _ = writeln!(file, "[{}] {}", now, msg);
    }
}
