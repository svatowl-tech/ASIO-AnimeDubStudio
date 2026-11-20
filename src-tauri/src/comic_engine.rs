use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{BufReader, Cursor, Read};
use std::net::IpAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use quick_xml::events::Event;
use quick_xml::Reader as XmlReader;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, ORIGIN, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;
use url::Url;

const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ALLOWED_LIB_SITE_HOSTS: &[&str] = &[
    "mangalib.me",
    "ranobelib.me",
    "slashlib.me",
    "yaoilib.me",
    "hentailib.me",
    "lib.social",
    "v3.mangalib.me",
    "v2.mangalib.me",
    "v1.mangalib.me",
    "v2.ranobelib.me",
    "v2.slashlib.me",
    "v4.hentailib.me",
    "test-front.mangalib.me",
];

const ALLOWED_LIB_API_HOSTS: &[&str] = &[
    "api.cdnlibs.org",
    "api.lib.social",
    "api2.mangalib.me",
    "api.mangalib.me",
];

const FALLBACK_IMAGE_SERVERS: &[&str] = &[
    "https://img33.imgslib.link",
    "https://img3.mixlib.me",
    "https://img2.mixlib.me",
    "https://img4.imgslib.link",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibBranchInfo {
    pub branch_id: Option<i64>,
    pub team_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibChapterMeta {
    pub id: String,
    pub volume: String,
    pub number: String,
    pub name: String,
    pub branches: Vec<LibBranchInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibTitleInfo {
    pub slug: String,
    pub site_id: u8,
    pub site_domain: String,
    pub site_label: String,
    pub title: String,
    pub rus_title: Option<String>,
    pub cover_url: Option<String>,
    pub summary: Option<String>,
    pub is_ranobe: bool,
    pub chapters: Vec<LibChapterMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibDownloadChapterSpec {
    pub id: String,
    pub volume: String,
    pub number: String,
    pub name: String,
    pub branch_id: Option<i64>,
    pub branch_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibDownloadRequest {
    pub url: String,
    pub slug: String,
    pub site_id: u8,
    pub site_domain: String,
    pub title: String,
    pub cover_url: Option<String>,
    pub is_ranobe: bool,
    pub project_path: String,
    pub chapters: Vec<LibDownloadChapterSpec>,
    pub token: Option<String>,
    pub api_base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicPagePayload {
    pub id: String,
    pub index: usize,
    pub image_path: Option<String>,
    pub pdf_page_number: Option<u32>,
    pub text_blocks: Option<Vec<String>>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicChapterPayload {
    pub id: String,
    pub volume: String,
    pub number: String,
    pub title: String,
    pub branch_name: Option<String>,
    pub pages: Vec<ComicPagePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicImportResult {
    pub id: String,
    pub title: String,
    pub source_type: String,
    pub source_url: Option<String>,
    pub site_domain: Option<String>,
    pub cover_path: Option<String>,
    pub pdf_path: Option<String>,
    pub is_ranobe: bool,
    pub chapters: Vec<ComicChapterPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComicImportProgressEvent {
    stage: String,
    current_chapter: usize,
    total_chapters: usize,
    current_page: usize,
    total_pages: usize,
    message: String,
}

fn is_disallowed_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_multicast()
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0b1100_0000) == 64)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || ((v6.segments()[0] & 0xfe00) == 0xfc00)
                || ((v6.segments()[0] & 0xffc0) == 0xfe80)
        }
    }
}

fn validate_https_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw.trim()).map_err(|_| "Некорректный формат ссылки".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Разрешены только безопасные HTTPS-ссылки".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Ссылка не должна содержать учетные данные".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "В ссылке отсутствует домен".to_string())?
        .to_lowercase();
    if host == "localhost" || host.ends_with(".local") || host.ends_with(".internal") {
        return Err("Доступ к локальным хостам запрещен".to_string());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_disallowed_ip(ip) {
            return Err("Доступ к приватным IP-адресам запрещен".to_string());
        }
        return Err("Прямые IP-адреса не поддерживаются для импорта".to_string());
    }
    Ok(parsed)
}

fn is_allowed_host(host: &str, allowlist: &[&str]) -> bool {
    let normalized = host.trim().to_lowercase();
    allowlist.iter().any(|allowed| {
        normalized == *allowed || normalized.ends_with(&format!(".{}", allowed))
    })
}

fn validate_lib_site_url(raw: &str) -> Result<(Url, String, u8, String, bool, String), String> {
    let parsed = validate_https_url(raw)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "Не удалось определить домен".to_string())?
        .to_lowercase();

    if !is_allowed_host(&host, ALLOWED_LIB_SITE_HOSTS) {
        return Err(
            "Поддерживаются только сайты семейства Lib (mangalib.me, ranobelib.me, slashlib.me, hentailib.me, lib.social)"
                .to_string(),
        );
    }

    let (site_id, site_label, is_ranobe) = if host.contains("ranobelib") {
        (3u8, "RanobeLib".to_string(), true)
    } else if host.contains("slashlib") || host.contains("yaoilib") {
        (2u8, "SlashLib".to_string(), false)
    } else if host.contains("hentailib") {
        (4u8, "HentaiLib".to_string(), false)
    } else {
        (1u8, "MangaLib".to_string(), false)
    };

    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|s| s.filter(|seg| !seg.is_empty()).collect())
        .unwrap_or_default();

    // Expected paths:
    // /ru/manga/272748--yasuui-jeonbuini-doegetseupnida
    // /manga/272748--slug
    // /ru/book/12345--slug
    // /ru/12345--slug/read/v1/c1
    let mut slug: Option<String> = None;
    for (idx, seg) in segments.iter().enumerate() {
        let lower = seg.to_lowercase();
        if (lower == "manga" || lower == "book" || lower == "ranobe") && idx + 1 < segments.len() {
            slug = Some(segments[idx + 1].to_string());
            break;
        }
    }

    if slug.is_none() {
        for seg in &segments {
            if seg.contains("--") && seg.len() > 3 {
                slug = Some((*seg).to_string());
                break;
            }
        }
    }

    if slug.is_none() {
        if let Some(first_non_lang) = segments
            .iter()
            .find(|s| !matches!(s.to_lowercase().as_str(), "ru" | "en" | "uk" | "read" | "manga" | "book"))
        {
            slug = Some((*first_non_lang).to_string());
        }
    }

    let slug = slug.ok_or_else(|| {
        "Не удалось извлечь идентификатор тайтла из ссылки. Вставьте ссылку на страницу манги/ранобэ."
            .to_string()
    })?;

    if !slug
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Некорректный идентификатор тайтла в ссылке".to_string());
    }

    Ok((parsed, host, site_id, site_label, is_ranobe, slug))
}

fn validate_api_base(api_base: Option<&str>) -> Result<Vec<String>, String> {
    if let Some(custom) = api_base {
        let trimmed = custom.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            let parsed = validate_https_url(trimmed)?;
            let host = parsed.host_str().unwrap_or_default().to_lowercase();
            if !is_allowed_host(&host, ALLOWED_LIB_API_HOSTS) && !is_allowed_host(&host, ALLOWED_LIB_SITE_HOSTS) {
                return Err("Указанное зеркало API не входит в доверенный список семейства Lib".to_string());
            }
            return Ok(vec![trimmed.to_string()]);
        }
    }
    Ok(vec![
        "https://api.cdnlibs.org/api".to_string(),
        "https://api.lib.social/api".to_string(),
    ])
}

fn sanitize_path_segment(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == '_' || c == '-');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn ensure_confined_dir(project_path: &str, sub_segments: &[&str]) -> Result<PathBuf, String> {
    let base = PathBuf::from(project_path);
    if project_path.trim().is_empty() || !base.exists() {
        return Err("Папка проекта не найдена. Сначала выберите или сохраните проект.".to_string());
    }
    let comics_root = base.join("comics");
    fs::create_dir_all(&comics_root)
        .map_err(|e| format!("Не удалось создать папку comics в проекте: {}", e))?;

    let canon_root = fs::canonicalize(&comics_root)
        .map_err(|e| format!("Ошибка проверки пути comics: {}", e))?;

    let mut target = canon_root.clone();
    for seg in sub_segments {
        let safe = sanitize_path_segment(seg, "item");
        target.push(safe);
    }

    fs::create_dir_all(&target)
        .map_err(|e| format!("Не удалось создать директорию комикса: {}", e))?;

    let canon_target = fs::canonicalize(&target)
        .map_err(|e| format!("Ошибка проверки целевого пути: {}", e))?;

    if !canon_target.starts_with(&canon_root) {
        return Err("Обнаружена попытка выхода за пределы папки проекта".to_string());
    }

    Ok(canon_target)
}

fn to_project_relative(project_root: &Path, full_path: &Path) -> String {
    if let Ok(canon_proj) = fs::canonicalize(project_root) {
        if let Ok(canon_file) = fs::canonicalize(full_path) {
            if let Ok(rel) = canon_file.strip_prefix(&canon_proj) {
                let s = rel.to_string_lossy().replace('\\', "/");
                return format!("./{}", s.trim_start_matches('/'));
            }
        }
    }
    full_path.to_string_lossy().replace('\\', "/")
}

fn build_lib_client(site_id: u8, site_domain: &str, token: Option<&str>) -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT));

    if let Ok(val) = HeaderValue::from_str(&site_id.to_string()) {
        headers.insert("Site-Id", val);
    }
    let origin_str = format!("https://{}", site_domain);
    if let Ok(val) = HeaderValue::from_str(&origin_str) {
        headers.insert(ORIGIN, val);
    }
    let referer_str = format!("https://{}/", site_domain);
    if let Ok(val) = HeaderValue::from_str(&referer_str) {
        headers.insert(REFERER, val);
    }
    if let Some(tok) = token {
        let trimmed = tok.trim();
        if !trimmed.is_empty() {
            let auth_val = if trimmed.to_lowercase().starts_with("bearer ") {
                trimmed.to_string()
            } else {
                format!("Bearer {}", trimmed)
            };
            if let Ok(hv) = HeaderValue::from_str(&auth_val) {
                headers.insert(AUTHORIZATION, hv);
            }
        }
    }

    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Не удалось инициализировать HTTP-клиент: {}", e))
}

async fn fetch_json_with_retry(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let mut last_err = String::new();
    for attempt in 0..3u32 {
        match client.get(url).send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.as_u16() == 429 || status.is_server_error() {
                    last_err = format!("Сервер ответил статусом {}", status.as_u16());
                    tokio::time::sleep(Duration::from_millis(700 * (attempt as u64 + 1))).await;
                    continue;
                }
                if status.as_u16() == 401 || status.as_u16() == 403 {
                    return Err(format!(
                        "Доступ ограничен сервером (HTTP {}). Если тайтл 18+ или закрыт по лицензии — укажите Bearer-токен аккаунта Lib в настройках доступа.",
                        status.as_u16()
                    ));
                }
                if !status.is_success() {
                    return Err(format!("Ошибка API Lib: HTTP {}", status.as_u16()));
                }
                return resp
                    .json::<Value>()
                    .await
                    .map_err(|e| format!("Некорректный JSON ответ от Lib API: {}", e));
            }
            Err(e) => {
                last_err = format!("Сетевая ошибка: {}", e);
                tokio::time::sleep(Duration::from_millis(500 * (attempt as u64 + 1))).await;
            }
        }
    }
    Err(last_err)
}

fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();

    loop {
        match (ai.peek(), bi.peek()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(&ac), Some(&bc)) => {
                if ac.is_ascii_digit() && bc.is_ascii_digit() {
                    let mut an = String::new();
                    while let Some(&c) = ai.peek() {
                        if c.is_ascii_digit() {
                            an.push(c);
                            ai.next();
                        } else {
                            break;
                        }
                    }
                    let mut bn = String::new();
                    while let Some(&c) = bi.peek() {
                        if c.is_ascii_digit() {
                            bn.push(c);
                            bi.next();
                        } else {
                            break;
                        }
                    }
                    let a_num = an.parse::<u128>().unwrap_or(0);
                    let b_num = bn.parse::<u128>().unwrap_or(0);
                    match a_num.cmp(&b_num) {
                        Ordering::Equal => {
                            if an.len() != bn.len() {
                                return an.len().cmp(&bn.len());
                            }
                        }
                        other => return other,
                    }
                } else {
                    let al = ac.to_lowercase().next().unwrap_or(ac);
                    let bl = bc.to_lowercase().next().unwrap_or(bc);
                    ai.next();
                    bi.next();
                    if al != bl {
                        return al.cmp(&bl);
                    }
                }
            }
        }
    }
}

fn parse_chapter_sort_key(vol: &str, num: &str) -> (f64, f64) {
    let v = vol.trim().replace(',', ".").parse::<f64>().unwrap_or(0.0);
    let n = num.trim().replace(',', ".").parse::<f64>().unwrap_or(0.0);
    (v, n)
}

fn extract_prosemirror_paragraphs(node: &Value, out: &mut Vec<String>) {
    match node {
        Value::Object(map) => {
            let node_type = map.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if matches!(node_type, "paragraph" | "heading" | "blockquote" | "listItem") {
                let mut buf = String::new();
                collect_inline_text(node, &mut buf);
                let trimmed = buf.split_whitespace().collect::<Vec<_>>().join(" ");
                if !trimmed.is_empty() {
                    out.push(trimmed);
                }
                return;
            }
            if let Some(Value::Array(content)) = map.get("content") {
                for child in content {
                    extract_prosemirror_paragraphs(child, out);
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                extract_prosemirror_paragraphs(item, out);
            }
        }
        _ => {}
    }
}

fn collect_inline_text(node: &Value, buf: &mut String) {
    if let Value::Object(map) = node {
        if let Some(t) = map.get("text").and_then(|v| v.as_str()) {
            buf.push_str(t);
        }
        if map.get("type").and_then(|v| v.as_str()) == Some("hardBreak") {
            buf.push('\n');
        }
        if let Some(Value::Array(content)) = map.get("content") {
            for child in content {
                collect_inline_text(child, buf);
            }
        }
    }
}

fn strip_html_to_paragraphs(html: &str) -> Vec<String> {
    let normalized = html
        .replace("</p>", "\n")
        .replace("</div>", "\n")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</h1>", "\n")
        .replace("</h2>", "\n")
        .replace("</h3>", "\n");

    let mut plain = String::with_capacity(normalized.len());
    let mut in_tag = false;
    for ch in normalized.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => plain.push(ch),
            _ => {}
        }
    }

    let decoded = plain
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&laquo;", "«")
        .replace("&raquo;", "»")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&hellip;", "...")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">");

    decoded
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect()
}

fn chunk_paragraphs_into_pages(paragraphs: Vec<String>, chapter_id: &str) -> Vec<ComicPagePayload> {
    let mut pages = Vec::new();
    let mut current = Vec::new();
    let mut char_acc = 0usize;

    for para in paragraphs {
        if !current.is_empty() && char_acc + para.len() > 1400 {
            let idx = pages.len();
            pages.push(ComicPagePayload {
                id: format!("{}-p-{}", chapter_id, idx + 1),
                index: idx,
                image_path: None,
                pdf_page_number: None,
                text_blocks: Some(current),
                width: None,
                height: None,
            });
            current = Vec::new();
            char_acc = 0;
        }
        char_acc += para.len();
        current.push(para);
    }

    if !current.is_empty() || pages.is_empty() {
        let idx = pages.len();
        pages.push(ComicPagePayload {
            id: format!("{}-p-{}", chapter_id, idx + 1),
            index: idx,
            image_path: None,
            pdf_page_number: None,
            text_blocks: Some(if current.is_empty() {
                vec!["(Пустая текстовая глава)".to_string()]
            } else {
                current
            }),
            width: None,
            height: None,
        });
    }

    pages
}

fn guess_image_ext(url_path: &str, content_type: Option<&str>) -> &'static str {
    let clean = url_path.split('?').next().unwrap_or(url_path).to_lowercase();
    if clean.ends_with(".webp") {
        return "webp";
    }
    if clean.ends_with(".png") {
        return "png";
    }
    if clean.ends_with(".gif") {
        return "gif";
    }
    if clean.ends_with(".avif") {
        return "avif";
    }
    if clean.ends_with(".jpeg") || clean.ends_with(".jpg") {
        return "jpg";
    }
    if let Some(ct) = content_type {
        let ct_l = ct.to_lowercase();
        if ct_l.contains("webp") {
            return "webp";
        }
        if ct_l.contains("png") {
            return "png";
        }
        if ct_l.contains("gif") {
            return "gif";
        }
        if ct_l.contains("avif") {
            return "avif";
        }
    }
    "jpg"
}

fn is_image_filename(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".png")
        || lower.ends_with(".webp")
        || lower.ends_with(".gif")
        || lower.ends_with(".avif")
        || lower.ends_with(".bmp")
}

async fn resolve_lib_image_servers(
    client: &reqwest::Client,
    api_base: &str,
    site_id: u8,
) -> Vec<String> {
    let mut servers = Vec::new();
    let url = format!("{}/constants?fields[]=imageServers", api_base);
    if let Ok(json) = fetch_json_with_retry(client, &url).await {
        if let Some(list) = json
            .get("data")
            .and_then(|d| d.get("imageServers"))
            .and_then(|s| s.as_array())
        {
            // Order: main -> secondary -> compress -> others
            let mut prioritized: Vec<(u8, String)> = Vec::new();
            for item in list {
                let matches_site = item
                    .get("site_ids")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().any(|id| id.as_u64() == Some(site_id as u64)))
                    .unwrap_or(true);
                if !matches_site {
                    continue;
                }
                if let Some(raw_url) = item.get("url").and_then(|u| u.as_str()) {
                    if validate_https_url(raw_url).is_ok() {
                        let prio = match item.get("id").and_then(|v| v.as_str()).unwrap_or("") {
                            "main" => 0,
                            "secondary" => 1,
                            "compress" => 2,
                            _ => 3,
                        };
                        prioritized.push((prio, raw_url.trim_end_matches('/').to_string()));
                    }
                }
            }
            prioritized.sort_by_key(|(p, _)| *p);
            for (_, u) in prioritized {
                if !servers.contains(&u) {
                    servers.push(u);
                }
            }
        }
    }

    for fb in FALLBACK_IMAGE_SERVERS {
        let s = (*fb).to_string();
        if !servers.contains(&s) {
            servers.push(s);
        }
    }
    servers
}

#[tauri::command]
pub async fn lib_fetch_manga_info(
    url: String,
    token: Option<String>,
    api_base: Option<String>,
) -> Result<LibTitleInfo, String> {
    let (_parsed_url, site_domain, site_id, site_label, is_ranobe, slug) =
        validate_lib_site_url(&url)?;
    let bases = validate_api_base(api_base.as_deref())?;
    let client = build_lib_client(site_id, &site_domain, token.as_deref())?;

    let mut manga_json: Option<Value> = None;
    let mut working_base = String::new();
    let mut last_err = String::new();

    for base in &bases {
        let info_url = format!(
            "{}/manga/{}?fields[]=summary&fields[]=chapters_count&fields[]=otherNames",
            base, slug
        );
        match fetch_json_with_retry(&client, &info_url).await {
            Ok(v) => {
                manga_json = Some(v);
                working_base = base.clone();
                break;
            }
            Err(e) => {
                last_err = e;
            }
        }
    }

    let manga_json = manga_json.ok_or_else(|| {
        if last_err.is_empty() {
            "Не удалось получить данные тайтла с Lib API".to_string()
        } else {
            last_err
        }
    })?;

    let data = manga_json.get("data").unwrap_or(&manga_json);
    let rus_title = data
        .get("rus_name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let eng_title = data
        .get("eng_name")
        .and_then(|v| v.as_str())
        .or_else(|| data.get("name").and_then(|v| v.as_str()))
        .unwrap_or(&slug)
        .trim()
        .to_string();
    let title = rus_title.clone().unwrap_or(eng_title);

    let cover_url = data
        .get("cover")
        .and_then(|c| {
            c.get("default")
                .or_else(|| c.get("thumbnail"))
                .and_then(|u| u.as_str())
        })
        .map(|s| s.to_string())
        .filter(|u| validate_https_url(u).is_ok());

    let summary = data
        .get("summary")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let chapters_url = format!("{}/manga/{}/chapters", working_base, slug);
    let chapters_json = fetch_json_with_retry(&client, &chapters_url).await?;

    let mut chapters: Vec<LibChapterMeta> = chapters_json
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .map(|ch| {
                    let id = ch
                        .get("id")
                        .map(|v| match v {
                            Value::Number(n) => n.to_string(),
                            Value::String(s) => s.clone(),
                            _ => uuid::Uuid::new_v4().to_string(),
                        })
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                    let volume = ch
                        .get("volume")
                        .map(|v| match v {
                            Value::String(s) => s.clone(),
                            Value::Number(n) => n.to_string(),
                            _ => "1".to_string(),
                        })
                        .unwrap_or_else(|| "1".to_string());
                    let number = ch
                        .get("number")
                        .map(|v| match v {
                            Value::String(s) => s.clone(),
                            Value::Number(n) => n.to_string(),
                            _ => "1".to_string(),
                        })
                        .unwrap_or_else(|| "1".to_string());
                    let name = ch
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string();

                    let branches = ch
                        .get("branches")
                        .and_then(|b| b.as_array())
                        .map(|b_arr| {
                            b_arr
                                .iter()
                                .map(|br| {
                                    let branch_id = br.get("branch_id").and_then(|v| v.as_i64());
                                    let team_names = br
                                        .get("teams")
                                        .and_then(|t| t.as_array())
                                        .map(|teams| {
                                            teams
                                                .iter()
                                                .filter_map(|tm| {
                                                    tm.get("name")
                                                        .and_then(|n| n.as_str())
                                                        .map(|s| s.to_string())
                                                })
                                                .collect::<Vec<_>>()
                                        })
                                        .unwrap_or_default();
                                    LibBranchInfo {
                                        branch_id,
                                        team_names,
                                    }
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();

                    LibChapterMeta {
                        id,
                        volume,
                        number,
                        name,
                        branches,
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    chapters.sort_by(|a, b| {
        let ka = parse_chapter_sort_key(&a.volume, &a.number);
        let kb = parse_chapter_sort_key(&b.volume, &b.number);
        ka.0.partial_cmp(&kb.0)
            .unwrap_or(Ordering::Equal)
            .then_with(|| ka.1.partial_cmp(&kb.1).unwrap_or(Ordering::Equal))
    });

    Ok(LibTitleInfo {
        slug,
        site_id,
        site_domain,
        site_label,
        title,
        rus_title,
        cover_url,
        summary,
        is_ranobe,
        chapters,
    })
}

#[tauri::command]
pub async fn lib_download_chapters(
    app: AppHandle,
    request: LibDownloadRequest,
) -> Result<ComicImportResult, String> {
    if request.chapters.is_empty() {
        return Err("Не выбрана ни одна глава для загрузки".to_string());
    }

    let (_parsed_url, site_domain, site_id, _site_label, detected_ranobe, slug) =
        validate_lib_site_url(&request.url)?;
    let is_ranobe = request.is_ranobe || detected_ranobe;
    let bases = validate_api_base(request.api_base.as_deref())?;
    let client = build_lib_client(site_id, &site_domain, request.token.as_deref())?;

    let project_root = PathBuf::from(&request.project_path);
    let safe_slug = sanitize_path_segment(&slug, "comic");
    let comic_dir = ensure_confined_dir(&request.project_path, &[&safe_slug])?;

    let api_base = bases[0].clone();
    let image_servers = if is_ranobe {
        Vec::new()
    } else {
        resolve_lib_image_servers(&client, &api_base, site_id).await
    };

    // Download cover image if available
    let mut cover_path: Option<String> = None;
    if let Some(ref c_url) = request.cover_url {
        if validate_https_url(c_url).is_ok() {
            if let Ok(resp) = client.get(c_url).send().await {
                if resp.status().is_success() {
                    let ct = resp
                        .headers()
                        .get("content-type")
                        .and_then(|h| h.to_str().ok())
                        .map(|s| s.to_string());
                    if let Ok(bytes) = resp.bytes().await {
                        let ext = guess_image_ext(c_url, ct.as_deref());
                        let dest = comic_dir.join(format!("cover.{}", ext));
                        if fs::write(&dest, &bytes).is_ok() {
                            cover_path = Some(to_project_relative(&project_root, &dest));
                        }
                    }
                }
            }
        }
    }

    let total_chapters = request.chapters.len();
    let mut result_chapters = Vec::with_capacity(total_chapters);
    let semaphore = Arc::new(Semaphore::new(4));

    for (ch_idx, ch) in request.chapters.iter().enumerate() {
        let chapter_label = if ch.name.is_empty() {
            format!("Том {} · Глава {}", ch.volume, ch.number)
        } else {
            format!("Том {} · Глава {} — {}", ch.volume, ch.number, ch.name)
        };

        let _ = app.emit(
            "comic-import-progress",
            ComicImportProgressEvent {
                stage: "chapter".to_string(),
                current_chapter: ch_idx + 1,
                total_chapters,
                current_page: 0,
                total_pages: 0,
                message: format!("Загрузка метаданных: {}", chapter_label),
            },
        );

        let mut chapter_json: Option<Value> = None;
        let mut last_err = String::new();
        for base in &bases {
            let mut ch_url = format!(
                "{}/manga/{}/chapter?number={}&volume={}",
                base,
                slug,
                url::form_urlencoded::byte_serialize(ch.number.as_bytes()).collect::<String>(),
                url::form_urlencoded::byte_serialize(ch.volume.as_bytes()).collect::<String>()
            );
            if let Some(bid) = ch.branch_id {
                ch_url.push_str(&format!("&branch_id={}", bid));
            }
            match fetch_json_with_retry(&client, &ch_url).await {
                Ok(v) => {
                    chapter_json = Some(v);
                    break;
                }
                Err(e) => {
                    last_err = e;
                }
            }
        }

        let chapter_json = chapter_json.ok_or_else(|| {
            format!(
                "Не удалось загрузить главу {} (Том {}): {}",
                ch.number, ch.volume, last_err
            )
        })?;

        let data = chapter_json.get("data").unwrap_or(&chapter_json);
        let chapter_folder_name = format!(
            "ch_v{}_n{}",
            sanitize_path_segment(&ch.volume, "1"),
            sanitize_path_segment(&ch.number, "1")
        );
        let chapter_dir = ensure_confined_dir(&request.project_path, &[&safe_slug, &chapter_folder_name])?;
        let chapter_id = format!("lib-{}-v{}-n{}", safe_slug, ch.volume, ch.number);

        // Ranobe text chapter handling
        if is_ranobe || (data.get("pages").is_none() && data.get("content").is_some()) {
            let mut paragraphs = Vec::new();
            if let Some(content) = data.get("content") {
                match content {
                    Value::String(html) => {
                        paragraphs = strip_html_to_paragraphs(html);
                    }
                    Value::Object(_) | Value::Array(_) => {
                        extract_prosemirror_paragraphs(content, &mut paragraphs);
                    }
                    _ => {}
                }
            }
            let pages = chunk_paragraphs_into_pages(paragraphs, &chapter_id);
            let _ = app.emit(
                "comic-import-progress",
                ComicImportProgressEvent {
                    stage: "pages".to_string(),
                    current_chapter: ch_idx + 1,
                    total_chapters,
                    current_page: pages.len(),
                    total_pages: pages.len(),
                    message: format!("Сохранено страниц текста: {}", chapter_label),
                },
            );
            result_chapters.push(ComicChapterPayload {
                id: chapter_id,
                volume: ch.volume.clone(),
                number: ch.number.clone(),
                title: chapter_label,
                branch_name: ch.branch_name.clone(),
                pages,
            });
            continue;
        }

        // Manga/Manhwa image chapter handling
        let raw_pages = data
            .get("pages")
            .and_then(|p| p.as_array())
            .cloned()
            .unwrap_or_default();

        let total_pages = raw_pages.len();
        if total_pages == 0 {
            return Err(format!(
                "Глава {} не содержит страниц (возможно, требуется авторизация на сайте Lib)",
                chapter_label
            ));
        }

        let mut tasks = Vec::with_capacity(total_pages);
        for (p_idx, page_val) in raw_pages.into_iter().enumerate() {
            let page_rel_url = page_val
                .get("url")
                .and_then(|v| v.as_str())
                .or_else(|| page_val.get("image").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            let width = page_val.get("width").and_then(|v| v.as_u64()).map(|n| n as u32);
            let height = page_val.get("height").and_then(|v| v.as_u64()).map(|n| n as u32);

            let sem = semaphore.clone();
            let client_cl = client.clone();
            let servers_cl = image_servers.clone();
            let ch_dir_cl = chapter_dir.clone();
            let proj_root_cl = project_root.clone();
            let ch_id_cl = chapter_id.clone();

            tasks.push(tokio::spawn(async move {
                let _permit = sem
                    .acquire_owned()
                    .await
                    .map_err(|_| "Семафор загрузки прерван".to_string())?;

                let mut candidate_urls: Vec<String> = Vec::new();
                if page_rel_url.starts_with("https://") {
                    if validate_https_url(&page_rel_url).is_ok() {
                        candidate_urls.push(page_rel_url.clone());
                    }
                } else {
                    let clean_rel = page_rel_url.trim_start_matches('/');
                    for srv in &servers_cl {
                        candidate_urls.push(format!("{}/{}", srv.trim_end_matches('/'), clean_rel));
                    }
                }

                let mut downloaded: Option<(Vec<u8>, Option<String>, String)> = None;
                let mut err_msg = String::new();

                'servers: for full_url in candidate_urls {
                    if validate_https_url(&full_url).is_err() {
                        continue;
                    }
                    for attempt in 0..2u32 {
                        match client_cl.get(&full_url).send().await {
                            Ok(resp) => {
                                if resp.status().is_success() {
                                    let ct = resp
                                        .headers()
                                        .get("content-type")
                                        .and_then(|h| h.to_str().ok())
                                        .map(|s| s.to_string());
                                    if let Ok(bytes) = resp.bytes().await {
                                        if !bytes.is_empty() {
                                            downloaded = Some((bytes.to_vec(), ct, full_url.clone()));
                                            break 'servers;
                                        }
                                    }
                                } else if resp.status().as_u16() == 429 {
                                    tokio::time::sleep(Duration::from_millis(600 * (attempt as u64 + 1))).await;
                                } else {
                                    err_msg = format!("HTTP {} при загрузке страницы {}", resp.status().as_u16(), p_idx + 1);
                                    break;
                                }
                            }
                            Err(e) => {
                                err_msg = format!("Сетевая ошибка страницы {}: {}", p_idx + 1, e);
                            }
                        }
                    }
                }

                let (bytes, ct, used_url) = downloaded.ok_or_else(|| {
                    if err_msg.is_empty() {
                        format!("Не удалось скачать страницу {}", p_idx + 1)
                    } else {
                        err_msg
                    }
                })?;

                let ext = guess_image_ext(&used_url, ct.as_deref());
                let file_name = format!("page_{:04}.{}", p_idx + 1, ext);
                let out_path = ch_dir_cl.join(&file_name);
                fs::write(&out_path, &bytes)
                    .map_err(|e| format!("Ошибка записи страницы {} на диск: {}", p_idx + 1, e))?;

                let rel_path = to_project_relative(&proj_root_cl, &out_path);
                Ok::<ComicPagePayload, String>(ComicPagePayload {
                    id: format!("{}-p-{}", ch_id_cl, p_idx + 1),
                    index: p_idx,
                    image_path: Some(rel_path),
                    pdf_page_number: None,
                    text_blocks: None,
                    width,
                    height,
                })
            }));
        }

        let mut pages = Vec::with_capacity(total_pages);
        let mut completed = 0usize;
        for task in tasks {
            let page = task
                .await
                .map_err(|e| format!("Ошибка потока загрузки: {}", e))??;
            completed += 1;
            let _ = app.emit(
                "comic-import-progress",
                ComicImportProgressEvent {
                    stage: "pages".to_string(),
                    current_chapter: ch_idx + 1,
                    total_chapters,
                    current_page: completed,
                    total_pages,
                    message: format!("{} — стр. {}/{}", chapter_label, completed, total_pages),
                },
            );
            pages.push(page);
        }

        pages.sort_by_key(|p| p.index);

        result_chapters.push(ComicChapterPayload {
            id: chapter_id,
            volume: ch.volume.clone(),
            number: ch.number.clone(),
            title: chapter_label,
            branch_name: ch.branch_name.clone(),
            pages,
        });

        // Polite pause between chapters to avoid rate limits
        if ch_idx + 1 < total_chapters {
            tokio::time::sleep(Duration::from_millis(350)).await;
        }
    }

    Ok(ComicImportResult {
        id: format!("comic-lib-{}", safe_slug),
        title: request.title,
        source_type: "lib".to_string(),
        source_url: Some(request.url),
        site_domain: Some(site_domain),
        cover_path,
        pdf_path: None,
        is_ranobe,
        chapters: result_chapters,
    })
}

fn safe_zip_relative_path(raw_name: &str) -> Option<PathBuf> {
    let p = Path::new(raw_name);
    let mut clean = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::Normal(os) => clean.push(os),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if clean.as_os_str().is_empty() {
        None
    } else {
        Some(clean)
    }
}

fn extract_cbz_local(file_path: &Path, project_path: &str) -> Result<ComicImportResult, String> {
    let stem = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("comic")
        .to_string();
    let safe_slug = sanitize_path_segment(&stem, "cbz_comic");
    let comic_dir = ensure_confined_dir(project_path, &[&safe_slug])?;
    let project_root = PathBuf::from(project_path);

    let file = File::open(file_path).map_err(|e| format!("Не удалось открыть CBZ-архив: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|e| format!("Некорректный ZIP/CBZ архив: {}", e))?;

    // Group entries by parent directory to detect chapters
    let mut chapter_groups: BTreeMap<String, Vec<(String, usize)>> = BTreeMap::new();
    for i in 0..archive.len() {
        let entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        let raw_name = entry.name().to_string();
        if raw_name.contains("__MACOSX") || raw_name.starts_with('.') {
            continue;
        }
        let Some(safe_rel) = safe_zip_relative_path(&raw_name) else {
            continue;
        };
        let file_name = safe_rel
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("");
        if file_name.starts_with('.') || !is_image_filename(file_name) {
            continue;
        }

        let group_key = safe_rel
            .parent()
            .and_then(|p| p.to_str())
            .map(|s| s.replace('\\', "/"))
            .unwrap_or_default();

        chapter_groups
            .entry(group_key)
            .or_default()
            .push((raw_name, i));
    }

    if chapter_groups.is_empty() {
        return Err("В CBZ-архиве не найдено изображений страниц".to_string());
    }

    let mut group_keys: Vec<String> = chapter_groups.keys().cloned().collect();
    group_keys.sort_by(|a, b| natural_cmp(a, b));

    let mut chapters = Vec::new();
    let mut cover_path: Option<String> = None;

    for (ch_idx, gkey) in group_keys.into_iter().enumerate() {
        let mut entries = chapter_groups.remove(&gkey).unwrap_or_default();
        entries.sort_by(|(a, _), (b, _)| natural_cmp(a, b));

        let ch_folder = format!("ch_{:03}", ch_idx + 1);
        let ch_dir = ensure_confined_dir(project_path, &[&safe_slug, &ch_folder])?;
        let ch_id = format!("cbz-{}-ch-{}", safe_slug, ch_idx + 1);

        let mut pages = Vec::new();
        for (p_idx, (raw_name, zip_idx)) in entries.into_iter().enumerate() {
            let mut entry = archive
                .by_index(zip_idx)
                .map_err(|e| format!("Ошибка чтения файла в CBZ: {}", e))?;
            let mut buf = Vec::new();
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("Ошибка распаковки страницы CBZ: {}", e))?;

            let ext = guess_image_ext(&raw_name, None);
            let out_file = ch_dir.join(format!("page_{:04}.{}", p_idx + 1, ext));
            fs::write(&out_file, &buf)
                .map_err(|e| format!("Ошибка записи страницы CBZ на диск: {}", e))?;

            let rel = to_project_relative(&project_root, &out_file);
            if cover_path.is_none() {
                cover_path = Some(rel.clone());
            }

            pages.push(ComicPagePayload {
                id: format!("{}-p-{}", ch_id, p_idx + 1),
                index: p_idx,
                image_path: Some(rel),
                pdf_page_number: None,
                text_blocks: None,
                width: None,
                height: None,
            });
        }

        let title = if gkey.trim().is_empty() {
            format!("Глава {}", ch_idx + 1)
        } else {
            gkey.split('/').last().unwrap_or(&gkey).to_string()
        };

        chapters.push(ComicChapterPayload {
            id: ch_id,
            volume: "1".to_string(),
            number: (ch_idx + 1).to_string(),
            title,
            branch_name: None,
            pages,
        });
    }

    let _ = comic_dir;

    Ok(ComicImportResult {
        id: format!("comic-cbz-{}", safe_slug),
        title: stem,
        source_type: "cbz".to_string(),
        source_url: None,
        site_domain: None,
        cover_path,
        pdf_path: None,
        is_ranobe: false,
        chapters,
    })
}

fn resolve_zip_href(base_dir: &str, href: &str) -> Option<String> {
    let decoded = href.split('#').next().unwrap_or(href).split('?').next().unwrap_or(href);
    let combined = if base_dir.is_empty() {
        decoded.to_string()
    } else {
        format!("{}/{}", base_dir.trim_end_matches('/'), decoded)
    };
    let mut parts: Vec<&str> = Vec::new();
    for seg in combined.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    Some(parts.join("/"))
}

fn extract_epub_local(file_path: &Path, project_path: &str) -> Result<ComicImportResult, String> {
    let stem = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("book")
        .to_string();
    let safe_slug = sanitize_path_segment(&stem, "epub_comic");
    let project_root = PathBuf::from(project_path);

    let file = File::open(file_path).map_err(|e| format!("Не удалось открыть EPUB: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|e| format!("Некорректный EPUB архив: {}", e))?;

    // 1. Locate OPF via META-INF/container.xml
    let mut opf_path: Option<String> = None;
    if let Ok(mut container) = archive.by_name("META-INF/container.xml") {
        let mut xml = String::new();
        if container.read_to_string(&mut xml).is_ok() {
            let mut reader = XmlReader::from_reader(Cursor::new(xml.as_bytes()));
            let mut buf = Vec::new();
            loop {
                match reader.read_event_into(&mut buf) {
                    Ok(Event::Empty(ref e)) | Ok(Event::Start(ref e)) => {
                        if e.name().into_inner().ends_with(b"rootfile") {
                            for attr in e.attributes().flatten() {
                                if attr.key.into_inner() == b"full-path" {
                                    if let Ok(val) = attr.unescape_value() {
                                        opf_path = Some(val.to_string());
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    Ok(Event::Eof) => break,
                    _ => {}
                }
                buf.clear();
            }
        }
    }

    let mut manifest: HashMap<String, (String, String)> = HashMap::new(); // id -> (href, media_type)
    let mut spine_ids: Vec<String> = Vec::new();
    let mut book_title = stem.clone();
    let opf_base_dir = opf_path
        .as_deref()
        .and_then(|p| p.rsplit_once('/').map(|(d, _)| d.to_string()))
        .unwrap_or_default();

    if let Some(ref opf) = opf_path {
        if let Ok(mut opf_file) = archive.by_name(opf) {
            let mut xml = String::new();
            if opf_file.read_to_string(&mut xml).is_ok() {
                let mut reader = XmlReader::from_reader(Cursor::new(xml.as_bytes()));
                let mut buf = Vec::new();
                let mut in_title = false;
                loop {
                    match reader.read_event_into(&mut buf) {
                        Ok(Event::Start(ref e)) => {
                            let tag = e.name().into_inner();
                            if tag == b"dc:title" || tag == b"title" {
                                in_title = true;
                            }
                        }
                        Ok(Event::Text(e)) => {
                            if in_title {
                                if let Ok(t) = e.unescape() {
                                    let trimmed = t.trim();
                                    if !trimmed.is_empty() {
                                        book_title = trimmed.to_string();
                                    }
                                }
                                in_title = false;
                            }
                        }
                        Ok(Event::Empty(ref e)) => {
                            let tag = e.name().into_inner();
                            if tag.ends_with(b"item") {
                                let mut id = String::new();
                                let mut href = String::new();
                                let mut media = String::new();
                                for attr in e.attributes().flatten() {
                                    let key = attr.key.into_inner();
                                    if let Ok(v) = attr.unescape_value() {
                                        if key == b"id" {
                                            id = v.to_string();
                                        } else if key == b"href" {
                                            href = v.to_string();
                                        } else if key == b"media-type" {
                                            media = v.to_string();
                                        }
                                    }
                                }
                                if !id.is_empty() && !href.is_empty() {
                                    manifest.insert(id, (href, media));
                                }
                            } else if tag.ends_with(b"itemref") {
                                for attr in e.attributes().flatten() {
                                    if attr.key.into_inner() == b"idref" {
                                        if let Ok(v) = attr.unescape_value() {
                                            spine_ids.push(v.to_string());
                                        }
                                    }
                                }
                            }
                        }
                        Ok(Event::Eof) => break,
                        _ => {}
                    }
                    buf.clear();
                }
            }
        }
    }

    // Collect spine XHTML paths in exact reading order
    let mut spine_files: Vec<String> = Vec::new();
    for idref in &spine_ids {
        if let Some((href, _media)) = manifest.get(idref) {
            if let Some(resolved) = resolve_zip_href(&opf_base_dir, href) {
                spine_files.push(resolved);
            }
        }
    }

    // Fallback if OPF had no spine
    if spine_files.is_empty() {
        for i in 0..archive.len() {
            if let Ok(e) = archive.by_index(i) {
                let n = e.name().to_string();
                let l = n.to_lowercase();
                if l.ends_with(".xhtml") || l.ends_with(".html") || l.ends_with(".htm") {
                    spine_files.push(n);
                }
            }
        }
        spine_files.sort_by(|a, b| natural_cmp(a, b));
    }

    let img_dir = ensure_confined_dir(project_path, &[&safe_slug, "pages"])?;
    let mut image_pages: Vec<ComicPagePayload> = Vec::new();
    let mut text_chapters: Vec<ComicChapterPayload> = Vec::new();
    let mut cover_path: Option<String> = None;

    for xhtml_path in &spine_files {
        let mut xhtml_str = String::new();
        if let Ok(mut entry) = archive.by_name(xhtml_path) {
            let _ = entry.read_to_string(&mut xhtml_str);
        }
        if xhtml_str.trim().is_empty() {
            continue;
        }

        let xhtml_dir = xhtml_path
            .rsplit_once('/')
            .map(|(d, _)| d)
            .unwrap_or("");

        // Extract referenced images inside the spine doc (fixed-layout manga EPUBs)
        let mut found_images: Vec<String> = Vec::new();
        let mut reader = XmlReader::from_reader(Cursor::new(xhtml_str.as_bytes()));
        let mut buf = Vec::new();
        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                    let tag = e.name().into_inner();
                    if tag == b"img" || tag == b"image" {
                        for attr in e.attributes().flatten() {
                            let k = attr.key.into_inner();
                            if k == b"src" || k == b"xlink:href" || k == b"href" {
                                if let Ok(v) = attr.unescape_value() {
                                    if let Some(resolved) = resolve_zip_href(xhtml_dir, &v) {
                                        found_images.push(resolved);
                                    }
                                }
                            }
                        }
                    }
                }
                Ok(Event::Eof) => break,
                _ => {}
            }
            buf.clear();
        }

        let text_paras = strip_html_to_paragraphs(&xhtml_str);
        let text_len: usize = text_paras.iter().map(|p| p.len()).sum();

        // If the page is primarily an image comic page (little/no prose text)
        if !found_images.is_empty() && text_len < 120 {
            for img_zip_path in found_images {
                if let Ok(mut img_entry) = archive.by_name(&img_zip_path) {
                    let mut bytes = Vec::new();
                    if img_entry.read_to_end(&mut bytes).is_ok() && !bytes.is_empty() {
                        let p_idx = image_pages.len();
                        let ext = guess_image_ext(&img_zip_path, None);
                        let out_file = img_dir.join(format!("page_{:04}.{}", p_idx + 1, ext));
                        if fs::write(&out_file, &bytes).is_ok() {
                            let rel = to_project_relative(&project_root, &out_file);
                            if cover_path.is_none() {
                                cover_path = Some(rel.clone());
                            }
                            image_pages.push(ComicPagePayload {
                                id: format!("epub-{}-p-{}", safe_slug, p_idx + 1),
                                index: p_idx,
                                image_path: Some(rel),
                                pdf_page_number: None,
                                text_blocks: None,
                                width: None,
                                height: None,
                            });
                        }
                    }
                }
            }
        } else if !text_paras.is_empty() {
            let ch_num = text_chapters.len() + 1;
            let ch_id = format!("epub-{}-ch-{}", safe_slug, ch_num);
            let ch_title = text_paras
                .first()
                .filter(|s| s.len() < 80)
                .cloned()
                .unwrap_or_else(|| format!("Глава {}", ch_num));
            let pages = chunk_paragraphs_into_pages(text_paras, &ch_id);
            text_chapters.push(ComicChapterPayload {
                id: ch_id,
                volume: "1".to_string(),
                number: ch_num.to_string(),
                title: ch_title,
                branch_name: None,
                pages,
            });
        }
    }

    // If image-based manga EPUB
    if !image_pages.is_empty() && image_pages.len() >= text_chapters.len() {
        return Ok(ComicImportResult {
            id: format!("comic-epub-{}", safe_slug),
            title: book_title,
            source_type: "epub".to_string(),
            source_url: None,
            site_domain: None,
            cover_path,
            pdf_path: None,
            is_ranobe: false,
            chapters: vec![ComicChapterPayload {
                id: format!("epub-{}-ch-1", safe_slug),
                volume: "1".to_string(),
                number: "1".to_string(),
                title: book_title.clone(),
                branch_name: None,
                pages: image_pages,
            }],
        });
    }

    if !text_chapters.is_empty() {
        return Ok(ComicImportResult {
            id: format!("comic-epub-{}", safe_slug),
            title: book_title,
            source_type: "epub".to_string(),
            source_url: None,
            site_domain: None,
            cover_path,
            pdf_path: None,
            is_ranobe: true,
            chapters: text_chapters,
        });
    }

    Err("В EPUB-файле не найдено ни изображений страниц, ни текстовых глав".to_string())
}

fn import_pdf_local(file_path: &Path, project_path: &str) -> Result<ComicImportResult, String> {
    let stem = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("comic_pdf")
        .to_string();
    let safe_slug = sanitize_path_segment(&stem, "pdf_comic");
    let comic_dir = ensure_confined_dir(project_path, &[&safe_slug])?;
    let project_root = PathBuf::from(project_path);

    let dest_pdf = comic_dir.join(format!("{}.pdf", safe_slug));
    fs::copy(file_path, &dest_pdf)
        .map_err(|e| format!("Не удалось скопировать PDF в папку проекта: {}", e))?;

    // Fast page count via lopdf (fallback 1 if encrypted/non-standard; frontend pdf.js will refine)
    let page_count = lopdf::Document::load(&dest_pdf)
        .map(|d| d.get_pages().len().max(1))
        .unwrap_or(1);

    let ch_id = format!("pdf-{}-ch-1", safe_slug);
    let pages: Vec<ComicPagePayload> = (0..page_count)
        .map(|i| ComicPagePayload {
            id: format!("{}-p-{}", ch_id, i + 1),
            index: i,
            image_path: None,
            pdf_page_number: Some((i + 1) as u32),
            text_blocks: None,
            width: None,
            height: None,
        })
        .collect();

    let rel_pdf = to_project_relative(&project_root, &dest_pdf);

    Ok(ComicImportResult {
        id: format!("comic-pdf-{}", safe_slug),
        title: stem,
        source_type: "pdf".to_string(),
        source_url: None,
        site_domain: None,
        cover_path: None,
        pdf_path: Some(rel_pdf),
        is_ranobe: false,
        chapters: vec![ComicChapterPayload {
            id: ch_id,
            volume: "1".to_string(),
            number: "1".to_string(),
            title: "PDF документ".to_string(),
            branch_name: None,
            pages,
        }],
    })
}

#[tauri::command]
pub async fn import_local_comic(
    _app: AppHandle,
    file_path: String,
    project_path: String,
) -> Result<ComicImportResult, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&file_path);
        if !path.exists() {
            return Err("Выбранный файл комикса не найден на диске".to_string());
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        match ext.as_str() {
            "cbz" | "zip" => extract_cbz_local(&path, &project_path),
            "epub" => extract_epub_local(&path, &project_path),
            "pdf" => import_pdf_local(&path, &project_path),
            _ => Err(format!(
                "Формат .{} не поддерживается. Используйте .cbz, .pdf или .epub.",
                ext
            )),
        }
    })
    .await
    .map_err(|e| format!("Ошибка фонового импорта комикса: {}", e))?
}

#[tauri::command]
pub async fn save_comic_page_image(
    project_path: String,
    comic_id: String,
    chapter_id: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let safe_comic = sanitize_path_segment(&comic_id, "comic");
        let safe_chapter = sanitize_path_segment(&chapter_id, "ch1");
        let safe_file = sanitize_path_segment(&file_name, "page.png");
        let dir = ensure_confined_dir(&project_path, &[&safe_comic, &safe_chapter])?;
        let out_path = dir.join(safe_file);
        fs::write(&out_path, &bytes).map_err(|e| format!("Ошибка записи страницы: {}", e))?;
        Ok(to_project_relative(Path::new(&project_path), &out_path))
    })
    .await
    .map_err(|e| format!("Ошибка сохранения страницы: {}", e))?
}
