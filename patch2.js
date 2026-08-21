const fs = require('fs');
let code = fs.readFileSync('src-tauri/src/export_engine.rs', 'utf8');

const regex = /let has_original = original_video_path.is_some\(\);[\s\S]*?let is_9_16 = settings.aspect_ratio == "9:16";[\s\S]*?let professional = settings.professional_editing;/;

const replacement = `let has_original = original_video_path.is_some();
    let is_9_16 = settings.aspect_ratio == "9:16";
    let professional = settings.professional_editing;
    let use_pip = settings.pip_camera.unwrap_or(false);`;

code = code.replace(regex, replacement);
fs.writeFileSync('src-tauri/src/export_engine.rs', code);
