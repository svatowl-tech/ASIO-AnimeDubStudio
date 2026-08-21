const fs = require('fs');
let code = fs.readFileSync('src-tauri/src/export_engine.rs', 'utf8');

const videoRegex = /\/\/ Video trim[\s\S]*?\/\/ Subtitles for this block/;
const videoReplacement = `// Video trim
        if block.r#type == "dub" && has_original && (professional || use_pip) {
            filter_graph.push_str(&format!("[1:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[orig_v];\\n", orig_start, orig_end));
            if use_pip {
                filter_graph.push_str(&format!("[0:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[cam_v];\\n", start, end));
                let pip_w = if is_9_16 { "iw/3" } else { "iw/4" };
                let pip_h = if is_9_16 { "ih/3" } else { "ih/4" };
                let pip_x = if is_9_16 { "W-w-20" } else { "W-w-40" };
                let pip_y = if is_9_16 { "20" } else { "40" };
                filter_graph.push_str(&format!("[cam_v]scale={}:{}[pip_scaled];\\n", pip_w, pip_h));
                filter_graph.push_str(&format!("[orig_v][pip_scaled]overlay=x={}:y={}:format=yuv420[v_raw];\\n", pip_x, pip_y));
            } else {
                filter_graph.push_str("[orig_v]format=yuv420p[v_raw];\\n");
            }
        } else if has_original && use_pip {
            // For non-dub blocks in PIP mode, we just show the original video (no PIP)
            filter_graph.push_str(&format!("[1:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[orig_v];\\n", orig_start, orig_end));
            filter_graph.push_str("[orig_v]format=yuv420p[v_raw];\\n");
        } else {
            filter_graph.push_str(&format!("[0:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[cam_v];\\n", start, end));
            filter_graph.push_str("[cam_v]format=yuv420p[v_raw];\\n");
        }

        // Subtitles for this block`;

code = code.replace(videoRegex, videoReplacement);

const audioRegex = /\/\/ Audio trim[\s\S]*?let mut cmd = Command::new/;
const audioReplacement = `// Audio trim
        if block.r#type == "dub" && has_original && (professional || use_pip) {
            filter_graph.push_str(&format!("[1:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[orig_a];\\n", orig_start, orig_end));
            if use_pip && has_cam_audio {
                filter_graph.push_str(&format!("[0:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[cam_a];\\n", start, end));
                filter_graph.push_str("[orig_a][cam_a]amix=inputs=2:duration=longest[a_out];\\n");
            } else {
                filter_graph.push_str("[orig_a]volume=1.0[a_out];\\n");
            }
        } else if has_original && use_pip {
            // For non-dub blocks in PIP mode, we just play original audio
            filter_graph.push_str(&format!("[1:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[orig_a];\\n", orig_start, orig_end));
            filter_graph.push_str("[orig_a]volume=1.0[a_out];\\n");
        } else {
            if block.r#type == "silence" {
                filter_graph.push_str(&format!("anullsrc=r=48000:cl=stereo:d={:.3}[a_out];\\n", duration));
            } else {
                if has_cam_audio {
                    filter_graph.push_str(&format!("[0:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[cam_a];\\n", start, end));
                    filter_graph.push_str("[cam_a]volume=1.0[a_out];\\n");
                } else {
                    filter_graph.push_str(&format!("anullsrc=r=48000:cl=stereo:d={:.3}[a_out];\\n", duration));
                }
            }
        }

        let mut cmd = Command::new`;

code = code.replace(audioRegex, audioReplacement);

fs.writeFileSync('src-tauri/src/export_engine.rs', code);
