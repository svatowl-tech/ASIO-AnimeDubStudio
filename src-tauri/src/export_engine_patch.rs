#[tauri::command]
pub async fn export_backstage_assemble(
    _app_handle: tauri::AppHandle,
    video_path: String,
    original_video_path: Option<String>,
    subtitles: Vec<SubtitleSegment>,
    blocks: Vec<TimelineBlockInput>,
    settings: ExportSettings,
    output_path: String,
) -> Result<String, String> {
    use std::fs;
    use std::io::Write;
    use std::path::Path;
    use tokio::process::Command;

    println!("[export_backstage_assemble] Начало экспорта. Всего блоков: {}. Output: {}", blocks.len(), output_path);

    let out_dir = Path::new(&output_path).parent().unwrap_or(Path::new(""));
    let temp_dir = out_dir.join(format!("temp_assemble_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let mut concat_list = String::new();
    let mut chunk_files = Vec::new();

    let has_original = original_video_path.is_some();
    let is_9_16 = settings.aspect_ratio == "9:16";
    let professional = settings.professional_editing;

    // Check camera audio
    let probe_out = Command::new(crate::get_ffprobe_path())
        .args(["-i", &video_path, "-show_streams", "-select_streams", "a", "-loglevel", "error"])
        .output().await;
    let has_cam_audio = probe_out.map(|o| !o.stdout.is_empty()).unwrap_or(true);

    for (i, block) in blocks.iter().enumerate() {
        let chunk_name = format!("chunk_{:04}.mp4", i);
        let chunk_path = temp_dir.join(&chunk_name);
        
        let start = block.start.unwrap_or(block.original_start.unwrap_or(0.0));
        let duration = block.duration;
        let end = block.end.unwrap_or(block.original_end.unwrap_or(start + duration));

        let orig_start = block.original_start.unwrap_or(0.0);
        let orig_end = block.original_end.unwrap_or(orig_start + duration);

        let mut filter_graph = String::new();
        
        // Video trim
        filter_graph.push_str(&format!("[0:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[cam_v];\n", start, end));
        
        if block.r#type == "dub" && has_original && professional {
            filter_graph.push_str(&format!("[1:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[orig_v];\n", orig_start, orig_end));
            filter_graph.push_str("[orig_v]format=yuv420p[v_raw];\n");
        } else {
            filter_graph.push_str("[cam_v]format=yuv420p[v_raw];\n");
        }
        
        // Subtitles for this block
        let block_subs: Vec<_> = subtitles.iter().filter(|s| {
            s.end > orig_start && s.start < orig_end
        }).collect();

        if block_subs.is_empty() {
            filter_graph.push_str("[v_raw]copy[v_sub];\n");
        } else {
            let mut current_v = "v_raw".to_string();
            for (sub_i, sub) in block_subs.iter().enumerate() {
                let next_v = format!("v_sub_{}", sub_i);
                let sub_start_in_block = (sub.start - orig_start).max(0.0);
                let sub_end_in_block = (sub.end - orig_start).min(duration);
                let text = sub.text.replace("'", "\\'").replace(":", "\\:").replace(",", "\\,");
                let font_size = if is_9_16 { 48 } else { 64 };
                let y_pos = if is_9_16 { "(h-text_h)/2+600" } else { "(h-text_h)/2+400" };
                
                filter_graph.push_str(&format!(
                    "[{}]drawtext=text='{}':fontcolor=white:fontsize={}:x=(w-text_w)/2:y={}:enable='between(t,{:.3},{:.3})'[{}];\n",
                    current_v, text, font_size, y_pos, sub_start_in_block, sub_end_in_block, next_v
                ));
                current_v = next_v;
            }
            filter_graph.push_str(&format!("[{}]copy[v_sub];\n", current_v));
        }

        // Crop if needed
        if is_9_16 {
            filter_graph.push_str("[v_sub]crop=ih*(9/16):ih[v_out];\n");
        } else {
            filter_graph.push_str("[v_sub]copy[v_out];\n");
        }

        // Audio trim
        if has_cam_audio {
            filter_graph.push_str(&format!("[0:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[cam_a];\n", start, end));
        } else {
            filter_graph.push_str(&format!("anullsrc=r=48000:cl=stereo:d={:.3}[cam_a];\n", duration));
        }
        
        if block.r#type == "dub" && has_original && professional {
            filter_graph.push_str(&format!("[1:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[orig_a];\n", orig_start, orig_end));
            filter_graph.push_str("[orig_a]volume=1.0[a_out]");
        } else {
            if block.r#type == "silence" {
                filter_graph.push_str(&format!("anullsrc=r=48000:cl=stereo:d={:.3}[a_out]"));
            } else {
                filter_graph.push_str("[cam_a]volume=1.0[a_out]");
            }
        }

        let mut cmd = Command::new(crate::get_ffmpeg_path());
        cmd.arg("-nostdin").arg("-y");
        cmd.arg("-i").arg(&video_path);
        
        if block.r#type == "dub" && has_original && professional {
            cmd.arg("-i").arg(original_video_path.as_ref().unwrap());
        }
        
        cmd.arg("-filter_complex").arg(&filter_graph);
        cmd.arg("-map").arg("[v_out]");
        cmd.arg("-map").arg("[a_out]");
        cmd.arg("-c:v").arg("libx264").arg("-preset").arg("fast").arg("-crf").arg("23");
        cmd.arg("-c:a").arg("aac").arg("-b:a").arg("192k");
        cmd.arg(chunk_path.to_str().unwrap());
        
        println!("[export_backstage_assemble] Рендеринг блока {}/{}", i + 1, blocks.len());
        let output = cmd.output().await.map_err(|e| e.to_string())?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            println!("[export_backstage_assemble] FFmpeg ошибка для блока {}: {}", i, err);
            return Err(format!("FFmpeg error on block {}: {}", i, err));
        }
        
        if chunk_path.exists() {
            concat_list.push_str(&format!("file '{}'\n", chunk_path.to_string_lossy().replace("\\", "/")));
            chunk_files.push(chunk_path);
        }
    }

    let concat_file = temp_dir.join("concat.txt");
    let mut f = fs::File::create(&concat_file).map_err(|e| e.to_string())?;
    f.write_all(concat_list.as_bytes()).map_err(|e| e.to_string())?;

    println!("[export_backstage_assemble] Склеивание {} блоков...", chunk_files.len());
    let mut concat_cmd = Command::new(crate::get_ffmpeg_path());
    concat_cmd.args([
        "-nostdin",
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_file.to_str().unwrap(),
        "-c", "copy",
        &output_path
    ]);

    let concat_out = concat_cmd.output().await.map_err(|e| e.to_string())?;
    if !concat_out.status.success() {
        let err = String::from_utf8_lossy(&concat_out.stderr);
        return Err(format!("FFmpeg concat error: {}", err));
    }
    
    // Cleanup
    let _ = fs::remove_dir_all(&temp_dir);

    println!("[export_backstage_assemble] Готово!");
    Ok(output_path)
}
