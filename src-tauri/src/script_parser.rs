use std::fs::File;
use std::io::{BufRead, BufReader, Cursor, Read};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};

use quick_xml::events::Event;
use quick_xml::Reader as XmlReader;
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedScriptLine {
    pub index: u32,
    pub character: Option<String>,
    pub text: String,
    pub original_time_start_ms: Option<u64>,
    pub original_time_end_ms: Option<u64>,
    pub stage_directions: Option<String>,
    pub is_foley_sfx: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedScriptResponse {
    pub file_name: String,
    pub total_lines: usize,
    pub characters: Vec<String>,
    pub lines: Vec<ParsedScriptLine>,
}

#[derive(Debug, Clone)]
struct RawExtractedItem {
    pub character_hint: Option<String>,
    pub text: String,
    pub time_start_ms: Option<u64>,
    pub time_end_ms: Option<u64>,
}

pub struct ScriptParserEngine;

impl ScriptParserEngine {
    pub fn parse_file<P: AsRef<Path>>(path: P) -> Result<ParsedScriptResponse, String> {
        let path = path.as_ref();
        if !path.exists() {
            return Err(format!("File not found: {:?}", path));
        }

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "script".to_string());

        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        let raw_items = match extension.as_str() {
            "docx" => Self::parse_docx(path)?,
            "pdf" => Self::parse_pdf(path)?,
            "epub" => Self::parse_epub(path)?,
            "ass" | "ssa" => Self::parse_ass(path)?,
            "srt" => Self::parse_srt(path)?,
            "vtt" => Self::parse_vtt(path)?,
            "fb2" => Self::parse_fb2(path)?,
            "csv" => Self::parse_csv(path)?,
            _ => Self::parse_txt(path)?,
        };

        // Process raw items in parallel using Rayon
        let line_counter = AtomicU32::new(0);
        let mut parsed_lines: Vec<ParsedScriptLine> = raw_items
            .into_par_iter()
            .filter_map(|item| {
                let text = item.text.trim();
                if text.is_empty() {
                    return None;
                }

                let (character, clean_text, stage_directions, is_foley) =
                    Self::analyze_dialogue(text, item.character_hint);

                if clean_text.is_empty() && stage_directions.is_none() {
                    return None;
                }

                Some(ParsedScriptLine {
                    index: line_counter.fetch_add(1, Ordering::Relaxed),
                    character,
                    text: clean_text,
                    original_time_start_ms: item.time_start_ms,
                    original_time_end_ms: item.time_end_ms,
                    stage_directions,
                    is_foley_sfx: is_foley,
                })
            })
            .collect();

        // Re-index sequentially to guarantee 0..N continuous indices
        for (i, line) in parsed_lines.iter_mut().enumerate() {
            line.index = i as u32;
        }

        // Collect unique characters
        let mut char_set = std::collections::BTreeSet::new();
        for line in &parsed_lines {
            if let Some(ref c) = line.character {
                let trimmed = c.trim();
                if !trimmed.is_empty() && trimmed != "Default" {
                    char_set.insert(trimmed.to_string());
                }
            }
        }
        let characters: Vec<String> = char_set.into_iter().collect();
        let total_lines = parsed_lines.len();

        Ok(ParsedScriptResponse {
            file_name,
            total_lines,
            characters,
            lines: parsed_lines,
        })
    }

    /// Heuristic dialogue and stage direction analyzer
    fn analyze_dialogue(
        raw_text: &str,
        character_hint: Option<String>,
    ) -> (Option<String>, String, Option<String>, bool) {
        let mut detected_character = character_hint;
        let mut stage_directions: Vec<String> = Vec::new();
        let mut is_foley = false;
        let mut text = raw_text.to_string();

        // Check if character hint is an SFX marker
        if let Some(ref ch) = detected_character {
            if Self::is_sfx_token(ch) {
                is_foley = true;
            }
        }

        // 1. Check if whole line is Foley / SFX bracketed note, e.g. [Шум шагов], (Вздох), *Выстрел*
        let trimmed_text = text.trim();
        if (trimmed_text.starts_with('[') && trimmed_text.ends_with(']'))
            || (trimmed_text.starts_with('(') && trimmed_text.ends_with(')'))
            || (trimmed_text.starts_with('*') && trimmed_text.ends_with('*'))
        {
            let inner = &trimmed_text[1..trimmed_text.len() - 1].trim();
            if Self::contains_foley_keywords(inner) || Self::is_sfx_token(inner) {
                is_foley = true;
                return (
                    detected_character.or_else(|| Some("SFX".to_string())),
                    String::new(),
                    Some(inner.to_string()),
                    true,
                );
            }
        }

        // 2. Detect character name prefixes if not already provided
        if detected_character.is_none() {
            // Pattern A: "CHARACTER (remark): Dialogue text" or "CHARACTER: Dialogue text"
            // or "CHARACTER — Dialogue text"
            lazy_static_regex!(
                RE_CLASSIC,
                r#"^([A-ZА-ЯЁ0-9_'\s\-\.]{2,35})(?:\s*\(([^)]+)\))?\s*[:—–\-]\s*(.+)$"#
            );
            lazy_static_regex!(
                RE_TITLECASE,
                r#"^([A-ZА-ЯЁ][a-zа-яёA-ZА-ЯЁ0-9_'\s\-\.]{1,30})(?:\s*\(([^)]+)\))?\s*:\s*(.+)$"#
            );

            if let Some(caps) = RE_CLASSIC.captures(&text) {
                let name = caps.get(1).map(|m| m.as_str().trim().to_string());
                let remark = caps.get(2).map(|m| m.as_str().trim().to_string());
                let content = caps.get(3).map(|m| m.as_str().trim()).unwrap_or("");

                // Verify name is not just a scene heading
                if let Some(ref n) = name {
                    if !Self::is_scene_heading(n) && !content.is_empty() {
                        detected_character = Some(Self::normalize_character_name(n));
                        if let Some(r) = remark {
                            if !r.is_empty() {
                                stage_directions.push(r);
                            }
                        }
                        text = content.to_string();
                    }
                }
            } else if let Some(caps) = RE_TITLECASE.captures(&text) {
                let name = caps.get(1).map(|m| m.as_str().trim().to_string());
                let remark = caps.get(2).map(|m| m.as_str().trim().to_string());
                let content = caps.get(3).map(|m| m.as_str().trim()).unwrap_or("");

                if let Some(ref n) = name {
                    if !Self::is_scene_heading(n) && !content.is_empty() {
                        detected_character = Some(Self::normalize_character_name(n));
                        if let Some(r) = remark {
                            if !r.is_empty() {
                                stage_directions.push(r);
                            }
                        }
                        text = content.to_string();
                    }
                }
            }
        }

        // 3. Extract parenthetical stage directions embedded in the dialogue text
        lazy_static_regex!(RE_PARENS, r#"\(([^)]+)\)|\[([^\]]+)\]"#);
        let mut cleaned_text_parts = Vec::new();
        let mut last_idx = 0;

        for mat in RE_PARENS.find_iter(&text) {
            cleaned_text_parts.push(&text[last_idx..mat.start()]);
            let match_str = mat.as_str();
            let inner = &match_str[1..match_str.len() - 1].trim();

            if Self::contains_foley_keywords(inner) {
                is_foley = true;
            }
            stage_directions.push(inner.to_string());
            last_idx = mat.end();
        }
        cleaned_text_parts.push(&text[last_idx..]);

        let clean_text = cleaned_text_parts
            .join(" ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");

        // Check if text itself has Foley cues
        if Self::contains_foley_keywords(&clean_text) && clean_text.len() < 40 {
            is_foley = true;
        }

        let stage_dir_str = if stage_directions.is_empty() {
            None
        } else {
            Some(stage_directions.join("; "))
        };

        (detected_character, clean_text, stage_dir_str, is_foley)
    }

    fn normalize_character_name(raw: &str) -> String {
        let mut s = raw.trim().to_string();
        // Remove trailing colon, dash, quotes
        while s.ends_with(':') || s.ends_with('-') || s.ends_with('—') || s.ends_with('–') || s.ends_with('"') || s.ends_with('\'') {
            s.pop();
            s = s.trim().to_string();
        }
        s
    }

    fn is_scene_heading(name: &str) -> bool {
        let upper = name.to_uppercase();
        upper.starts_with("ИНТ")
            || upper.starts_with("ЭКСТ")
            || upper.starts_with("INT")
            || upper.starts_with("EXT")
            || upper.starts_with("SCENE")
            || upper.starts_with("СЦЕНА")
            || upper.starts_with("КАДР")
            || upper.starts_with("ВРЕМЯ")
            || upper.starts_with("ПРИМЕЧАНИЕ")
            || upper.starts_with("NOTE")
            || upper.starts_with("ГЛАВА")
            || upper.starts_with("CHAPTER")
    }

    fn is_sfx_token(s: &str) -> bool {
        let lower = s.to_lowercase();
        lower == "sfx"
            || lower == "foley"
            || lower == "эффекты"
            || lower == "звук"
            || lower == "звуки"
            || lower == "шумы"
            || lower.contains("sound effect")
    }

    fn contains_foley_keywords(text: &str) -> bool {
        let lower = text.to_lowercase();
        let keywords = [
            "вздох", "вздыхает", "кашель", "кашляет", "шаги", "стук", "звонок",
            "смех", "смеется", "хихикает", "плач", "плачет", "крик", "кричит",
            "стонет", "зевает", "храп", "всхлип", "выстрел", "взрыв", "шум",
            "грохот", "шелест", "свист", "скрип", "аплодисменты", "хлопки", "фоли",
            "sigh", "gasp", "cough", "step", "footstep", "knock", "bell", "laugh",
            "laughter", "cry", "crying", "scream", "groan", "yawn", "snore", "grunt",
            "gunshot", "explosion", "noise", "rumble", "applause", "whisper", "sfx", "foley"
        ];

        keywords.iter().any(|&k| lower.contains(k))
    }

    // =========================================================================
    // Format Parsers
    // =========================================================================

    /// Fast native DOCX parser using memory-mapped ZIP extraction & XML streams
    fn parse_docx(path: &Path) -> Result<Vec<RawExtractedItem>, String> {
        let file = File::open(path).map_err(|e| format!("Failed to open DOCX: {}", e))?;
        let mut archive = zip::ZipArchive::new(BufReader::new(file))
            .map_err(|e| format!("Failed to read DOCX zip container: {}", e))?;

        let doc_xml_entry = archive
            .by_name("word/document.xml")
            .map_err(|_| "word/document.xml not found inside DOCX".to_string())?;

        let mut reader = XmlReader::from_reader(BufReader::new(doc_xml_entry));
        reader.config_mut().trim_text(true);

        let mut items = Vec::new();
        let mut buf = Vec::new();

        let mut in_paragraph = false;
        let mut in_run = false;
        let mut in_text = false;
        let mut run_is_bold = false;

        let mut current_bold_prefix = String::new();
        let mut current_normal_text = String::new();
        let mut current_run_text = String::new();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(ref e)) => {
                    let name = e.name().into_inner();
                    if name == b"w:p" {
                        in_paragraph = true;
                        current_bold_prefix.clear();
                        current_normal_text.clear();
                    } else if name == b"w:r" {
                        in_run = true;
                        run_is_bold = false;
                        current_run_text.clear();
                    } else if name == b"w:b" || name == b"w:bCs" {
                        run_is_bold = true;
                    } else if name == b"w:t" {
                        in_text = true;
                    }
                }
                Ok(Event::Empty(ref e)) => {
                    let name = e.name().into_inner();
                    if name == b"w:b" || name == b"w:bCs" {
                        run_is_bold = true;
                    } else if name == b"w:br" || name == b"w:cr" {
                        if in_run {
                            current_run_text.push('\n');
                        } else {
                            current_normal_text.push('\n');
                        }
                    }
                }
                Ok(Event::Text(e)) => {
                    if in_text {
                        if let Ok(txt) = e.unescape() {
                            current_run_text.push_str(&txt);
                        }
                    }
                }
                Ok(Event::End(ref e)) => {
                    let name = e.name().into_inner();
                    if name == b"w:t" {
                        in_text = false;
                    } else if name == b"w:r" {
                        in_run = false;
                        if run_is_bold && current_normal_text.is_empty() {
                            current_bold_prefix.push_str(&current_run_text);
                        } else {
                            current_normal_text.push_str(&current_run_text);
                        }
                        current_run_text.clear();
                    } else if name == b"w:p" {
                        in_paragraph = false;
                        let bold_trimmed = current_bold_prefix.trim();
                        let normal_trimmed = current_normal_text.trim();

                        if !bold_trimmed.is_empty() && !normal_trimmed.is_empty() {
                            // High confidence: Bold speaker name followed by normal dialogue
                            items.push(RawExtractedItem {
                                character_hint: Some(bold_trimmed.to_string()),
                                text: normal_trimmed.to_string(),
                                time_start_ms: None,
                                time_end_ms: None,
                            });
                        } else {
                            let full_para = format!("{} {}", bold_trimmed, normal_trimmed)
                                .trim()
                                .to_string();
                            if !full_para.is_empty() {
                                items.push(RawExtractedItem {
                                    character_hint: None,
                                    text: full_para,
                                    time_start_ms: None,
                                    time_end_ms: None,
                                });
                            }
                        }
                        current_bold_prefix.clear();
                        current_normal_text.clear();
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("Error parsing DOCX XML: {}", e)),
                _ => {}
            }
            buf.clear();
        }

        Ok(items)
    }

    /// Parallel PDF extraction using lopdf & Rayon
    fn parse_pdf(path: &Path) -> Result<Vec<RawExtractedItem>, String> {
        let doc = lopdf::Document::load(path)
            .map_err(|e| format!("Failed to open PDF with lopdf: {}", e))?;

        let pages = doc.get_pages();
        let mut page_numbers: Vec<u32> = pages.keys().cloned().collect();
        page_numbers.sort_unstable();

        // Extract text across pages concurrently using Rayon
        let page_texts: Vec<String> = page_numbers
            .into_par_iter()
            .map(|page_num| {
                doc.extract_text(&[page_num])
                    .unwrap_or_default()
            })
            .collect();

        let mut items = Vec::new();
        for page_text in page_texts {
            for line in page_text.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    items.push(RawExtractedItem {
                        character_hint: None,
                        text: trimmed.to_string(),
                        time_start_ms: None,
                        time_end_ms: None,
                    });
                }
            }
        }

        Ok(items)
    }

    /// High performance EPUB parser with Rayon chapter unpacking & XML streaming
    fn parse_epub(path: &Path) -> Result<Vec<RawExtractedItem>, String> {
        let file = File::open(path).map_err(|e| format!("Failed to open EPUB: {}", e))?;
        let mut archive = zip::ZipArchive::new(BufReader::new(file))
            .map_err(|e| format!("Failed to read EPUB container: {}", e))?;

        // 1. Locate OPF file from META-INF/container.xml
        let mut opf_path = String::new();
        if let Ok(mut container_file) = archive.by_name("META-INF/container.xml") {
            let mut xml_content = String::new();
            if container_file.read_to_string(&mut xml_content).is_ok() {
                lazy_static_regex!(RE_OPF, r#"full-path=["']([^"']+\.opf)["']"#);
                if let Some(caps) = RE_OPF.captures(&xml_content) {
                    if let Some(m) = caps.get(1) {
                        opf_path = m.as_str().to_string();
                    }
                }
            }
        }

        // 2. Collect chapter file entries
        let mut chapter_names = Vec::new();
        for i in 0..archive.len() {
            if let Ok(file) = archive.by_index(i) {
                let name = file.name().to_string();
                let lower = name.to_lowercase();
                if (lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm"))
                    && !lower.contains("cover")
                    && !lower.contains("nav.")
                    && !lower.contains("toc.")
                {
                    chapter_names.push(name);
                }
            }
        }

        // 3. Read chapter contents into memory
        let mut chapter_buffers = Vec::new();
        for name in chapter_names {
            if let Ok(mut entry) = archive.by_name(&name) {
                let mut data = Vec::new();
                if entry.read_to_end(&mut data).is_ok() {
                    chapter_buffers.push(data);
                }
            }
        }

        // 4. Parallel extraction across chapters using Rayon
        let extracted_chapters: Vec<Vec<String>> = chapter_buffers
            .into_par_iter()
            .map(|data| {
                let mut chapter_lines = Vec::new();
                let mut reader = XmlReader::from_reader(Cursor::new(data));
                reader.config_mut().trim_text(true);

                let mut in_para = false;
                let mut current_para = String::new();
                let mut buf = Vec::new();

                loop {
                    match reader.read_event_into(&mut buf) {
                        Ok(Event::Start(ref e)) => {
                            let name = e.name().into_inner();
                            if name == b"p" || name == b"div" || name == b"h1" || name == b"h2" || name == b"h3" || name == b"li" {
                                in_para = true;
                                current_para.clear();
                            }
                        }
                        Ok(Event::Text(e)) => {
                            if in_para {
                                if let Ok(t) = e.unescape() {
                                    current_para.push_str(&t);
                                    current_para.push(' ');
                                }
                            }
                        }
                        Ok(Event::End(ref e)) => {
                            let name = e.name().into_inner();
                            if name == b"p" || name == b"div" || name == b"h1" || name == b"h2" || name == b"h3" || name == b"li" {
                                in_para = false;
                                let trimmed = current_para.trim();
                                if !trimmed.is_empty() {
                                    chapter_lines.push(trimmed.to_string());
                                }
                                current_para.clear();
                            }
                        }
                        Ok(Event::Eof) => break,
                        _ => {}
                    }
                    buf.clear();
                }

                chapter_lines
            })
            .collect();

        let mut items = Vec::new();
        for chapter in extracted_chapters {
            for line in chapter {
                items.push(RawExtractedItem {
                    character_hint: None,
                    text: line,
                    time_start_ms: None,
                    time_end_ms: None,
                });
            }
        }

        Ok(items)
    }

    /// ASS / SSA parser with dialogue millisecond timecodes and actor styling
    fn parse_ass(path: &Path) -> Result<Vec<RawExtractedItem>, String> {
        let file = File::open(path).map_err(|e| format!("Failed to open ASS: {}", e))?;
        let reader = BufReader::new(file);

        let mut items = Vec::new();
        let mut in_events = false;
        let mut format_headers: Vec<String> = Vec::new();

        lazy_static_regex!(RE_ASS_TAGS, r#"\{[^}]+\}"#);

        for line_res in reader.lines() {
            let line = line_res.map_err(|e| format!("Error reading ASS: {}", e))?;
            let trimmed = line.trim();

            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                in_events = trimmed.eq_ignore_ascii_case("[Events]");
                continue;
            }

            if in_events {
                if trimmed.starts_with("Format:") {
                    let header_str = trimmed.trim_start_matches("Format:").trim();
                    format_headers = header_str
                        .split(',')
                        .map(|h| h.trim().to_lowercase())
                        .collect();
                } else if trimmed.starts_with("Dialogue:") {
                    let data_str = trimmed.trim_start_matches("Dialogue:").trim();
                    let max_fields = if format_headers.is_empty() { 10 } else { format_headers.len() };
                    
                    let parts: Vec<&str> = data_str.splitn(max_fields, ',').collect();
                    if parts.len() >= 9 {
                        let mut start_idx = 1;
                        let mut end_idx = 2;
                        let mut name_idx = 4;
                        let mut text_idx = parts.len() - 1;

                        if !format_headers.is_empty() {
                            for (idx, field) in format_headers.iter().enumerate() {
                                match field.as_str() {
                                    "start" => start_idx = idx,
                                    "end" => end_idx = idx,
                                    "name" | "actor" => name_idx = idx,
                                    "text" => text_idx = idx,
                                    _ => {}
                                }
                            }
                        }

                        let start_str = parts.get(start_idx).unwrap_or(&"0:00:00.00").trim();
                        let end_str = parts.get(end_idx).unwrap_or(&"0:00:00.00").trim();
                        let name_str = parts.get(name_idx).unwrap_or(&"").trim();
                        let raw_text = parts.get(text_idx).unwrap_or(&"").trim();

                        // Clean ASS tags and linebreaks
                        let clean_text = RE_ASS_TAGS
                            .replace_all(raw_text, "")
                            .replace("\\N", "\n")
                            .replace("\\n", "\n")
                            .replace("\\h", " ")
                            .trim()
                            .to_string();

                        if !clean_text.is_empty() {
                            let start_ms = Self::parse_ass_time_to_ms(start_str);
                            let end_ms = Self::parse_ass_time_to_ms(end_str);

                            items.push(RawExtractedItem {
                                character_hint: if name_str.is_empty() || name_str.eq_ignore_ascii_case("default") {
                                    None
                                } else {
                                    Some(name_str.to_string())
                                },
                                text: clean_text,
                                time_start_ms: Some(start_ms),
                                time_end_ms: Some(end_ms),
                            });
                        }
                    }
                }
            }
        }

        Ok(items)
    }

    /// SRT Subtitle Parser
    fn parse_srt(path: &Path) -> Result<Vec<RawExtractedItem>, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read SRT file: {}", e))?;

        lazy_static_regex!(
            RE_SRT,
            r#"(?m)^\d+\s*\r?\n(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*\r?\n([\s\S]*?)(?=\r?\n\r?\n\d+|\r?\n\r?\n$|$)"#
        );
        lazy_static_regex!(RE_HTML_TAGS, r#"<[^>]+>|\{[^}]+\}"#);

        let mut items = Vec::new();
        for caps in RE_SRT.captures_iter(&content) {
            let start_str = caps.get(1).map(|m| m.as_str()).unwrap_or("00:00:00,000");
            let end_str = caps.get(2).map(|m| m.as_str()).unwrap_or("00:00:00,000");
            let text_block = caps.get(3).map(|m| m.as_str()).unwrap_or("");

            let clean_text = RE_HTML_TAGS
                .replace_all(text_block, "")
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
                .join(" ");

            if !clean_text.is_empty() {
                let start_ms = Self::parse_srt_time_to_ms(start_str);
                let end_ms = Self::parse_srt_time_to_ms(end_str);

                items.push(RawExtractedItem {
                    character_hint: None,
                    text: clean_text,
                    time_start_ms: Some(start_ms),
                    time_end_ms: Some(end_ms),
                });
            }
        }

        Ok(items)
    }

    /// VTT Subtitle Parser
    fn parse_vtt(path: &Path) -> Result<Vec<RawExtractedItem>, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read VTT file: {}", e))?;

        lazy_static_regex!(
            RE_VTT,
            r#"(?m)(?:(?:.+)\r?\n)?(\d{2}:)?(\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:)?(\d{2}:\d{2}\.\d{3})(?:.*?)\r?\n([\s\S]*?)(?=\r?\n\r?\n|\r?\n$|$)"#
        );
        lazy_static_regex!(RE_VTT_TAGS, r#"<[^>]+>"#);
        lazy_static_regex!(RE_VTT_VOICE, r#"<v\s+([^>]+)>"#);

        let mut items = Vec::new();
        for caps in RE_VTT.captures_iter(&content) {
            let start_h = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let start_ms_part = caps.get(2).map(|m| m.as_str()).unwrap_or("00:00.000");
            let end_h = caps.get(3).map(|m| m.as_str()).unwrap_or("");
            let end_ms_part = caps.get(4).map(|m| m.as_str()).unwrap_or("00:00.000");
            let text_block = caps.get(5).map(|m| m.as_str()).unwrap_or("");

            if text_block.trim().eq_ignore_ascii_case("webvtt") {
                continue;
            }

            let character_hint = RE_VTT_VOICE
                .captures(text_block)
                .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()));

            let clean_text = RE_VTT_TAGS
                .replace_all(text_block, "")
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
                .join(" ");

            if !clean_text.is_empty() {
                let start_full = format!("{}{}", start_h, start_ms_part);
                let end_full = format!("{}{}", end_h, end_ms_part);
                let start_ms = Self::parse_vtt_time_to_ms(&start_full);
                let end_ms = Self::parse_vtt_time_to_ms(&end_full);

                items.push(RawExtractedItem {
                    character_hint,
                    text: clean_text,
                    time_start_ms: Some(start_ms),
                    time_end_ms: Some(end_ms),
                });
            }
        }

        Ok(items)
    }

    /// FB2 XML FictionBook Parser
    fn parse_fb2(path: &Path) -> Result<Vec<RawExtractedItem>, String> {
        let file = File::open(path).map_err(|e| format!("Failed to open FB2: {}", e))?;
        let mut reader = XmlReader::from_reader(BufReader::new(file));
        reader.config_mut().trim_text(true);

        let mut items = Vec::new();
        let mut buf = Vec::new();
        let mut in_p = false;
        let mut current_text = String::new();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(ref e)) => {
                    if e.name().into_inner() == b"p" {
                        in_p = true;
                        current_text.clear();
                    }
                }
                Ok(Event::Text(e)) => {
                    if in_p {
                        if let Ok(t) = e.unescape() {
                            current_text.push_str(&t);
                            current_text.push(' ');
                        }
                    }
                }
                Ok(Event::End(ref e)) => {
                    if e.name().into_inner() == b"p" {
                        in_p = false;
                        let trimmed = current_text.trim();
                        if !trimmed.is_empty() {
                            items.push(RawExtractedItem {
                                character_hint: None,
                                text: trimmed.to_string(),
                                time_start_ms: None,
                                time_end_ms: None,
                            });
                        }
                        current_text.clear();
                    }
                }
                Ok(Event::Eof) => break,
                _ => {}
            }
            buf.clear();
        }

        Ok(items)
    }

    /// CSV script parser (delimited by semicolon or comma)
    fn parse_csv(path: &Path) -> Result<Vec<RawExtractedItem>, String> {
        let file = File::open(path).map_err(|e| format!("Failed to open CSV: {}", e))?;
        let reader = BufReader::new(file);

        let mut items = Vec::new();
        for line_res in reader.lines() {
            let line = line_res.map_err(|e| format!("Error reading CSV line: {}", e))?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let parts: Vec<&str> = if trimmed.contains(';') {
                trimmed.split(';').collect()
            } else {
                trimmed.split(',').collect()
            };

            if parts.len() >= 2 {
                let char_name = parts[0].trim().trim_matches('"').trim_matches('\'');
                let text = parts[1..].join(",").trim().trim_matches('"').trim_matches('\'').to_string();

                items.push(RawExtractedItem {
                    character_hint: if char_name.is_empty() { None } else { Some(char_name.to_string()) },
                    text,
                    time_start_ms: None,
                    time_end_ms: None,
                });
            } else {
                items.push(RawExtractedItem {
                    character_hint: None,
                    text: trimmed.trim_matches('"').trim_matches('\'').to_string(),
                    time_start_ms: None,
                    time_end_ms: None,
                });
            }
        }

        Ok(items)
    }

    /// Plain text parser with multithreaded Rayon batching
    fn parse_txt(path: &Path) -> Result<Vec<RawExtractedItem>, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read TXT file: {}", e))?;

        let items: Vec<RawExtractedItem> = content
            .par_lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .map(|l| RawExtractedItem {
                character_hint: None,
                text: l.to_string(),
                time_start_ms: None,
                time_end_ms: None,
            })
            .collect();

        Ok(items)
    }

    // =========================================================================
    // Timecode parsing helpers (returns milliseconds)
    // =========================================================================

    fn parse_ass_time_to_ms(time_str: &str) -> u64 {
        // Format: H:MM:SS.cc (centiseconds)
        let parts: Vec<&str> = time_str.split(':').collect();
        if parts.len() != 3 {
            return 0;
        }

        let h: u64 = parts[0].parse().unwrap_or(0);
        let m: u64 = parts[1].parse().unwrap_or(0);

        let sec_parts: Vec<&str> = parts[2].split('.').collect();
        let s: u64 = sec_parts.first().and_then(|v| v.parse().ok()).unwrap_or(0);
        let cs: u64 = sec_parts.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);

        h * 3600_000 + m * 60_000 + s * 1000 + cs * 10
    }

    fn parse_srt_time_to_ms(time_str: &str) -> u64 {
        // Format: HH:MM:SS,mmm or HH:MM:SS.mmm
        let split_char = if time_str.contains(',') { ',' } else { '.' };
        let parts: Vec<&str> = time_str.split(split_char).collect();
        if parts.is_empty() {
            return 0;
        }

        let hms: Vec<&str> = parts[0].split(':').collect();
        if hms.len() != 3 {
            return 0;
        }

        let h: u64 = hms[0].parse().unwrap_or(0);
        let m: u64 = hms[1].parse().unwrap_or(0);
        let s: u64 = hms[2].parse().unwrap_or(0);
        let ms: u64 = parts.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);

        h * 3600_000 + m * 60_000 + s * 1000 + ms
    }

    fn parse_vtt_time_to_ms(time_str: &str) -> u64 {
        // Format: MM:SS.mmm or HH:MM:SS.mmm
        let parts: Vec<&str> = time_str.split('.').collect();
        if parts.is_empty() {
            return 0;
        }

        let ms: u64 = parts.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
        let hms: Vec<&str> = parts[0].split(':').collect();

        if hms.len() == 3 {
            let h: u64 = hms[0].parse().unwrap_or(0);
            let m: u64 = hms[1].parse().unwrap_or(0);
            let s: u64 = hms[2].parse().unwrap_or(0);
            h * 3600_000 + m * 60_000 + s * 1000 + ms
        } else if hms.len() == 2 {
            let m: u64 = hms[0].parse().unwrap_or(0);
            let s: u64 = hms[1].parse().unwrap_or(0);
            m * 60_000 + s * 1000 + ms
        } else {
            0
        }
    }
}

// Macro helper for thread-safe static regex caching
macro_rules! lazy_static_regex {
    ($name:ident, $re:expr) => {
        static $name: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        let $name = $name.get_or_init(|| regex::Regex::new($re).expect("Invalid regex pattern"));
    };
}
use lazy_static_regex;

/// Tauri 2.0 Command: Parse native script file
#[tauri::command]
pub async fn parse_script_file(file_path: String) -> Result<ParsedScriptResponse, String> {
    tokio::task::spawn_blocking(move || {
        ScriptParserEngine::parse_file(&file_path)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}
