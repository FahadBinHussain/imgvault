use serde::{Deserialize, Serialize};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::{HKEY, RegKey};
#[cfg(target_os = "windows")]
use winapi::um::winuser::{MessageBoxW, MB_ICONERROR, MB_ICONINFORMATION, MB_OK};

const EXTENSION_ID: &str = "cjialghkacooiecjckibhcifilfiibnn";

#[cfg(target_os = "windows")]
fn read_registry_string(root: HKEY, subkey: &str, value_name: &str) -> Option<String> {
    let key = RegKey::predef(root).open_subkey(subkey).ok()?;
    key.get_value::<String, _>(value_name).ok()
}

#[cfg(target_os = "windows")]
fn reload_windows_path_environment() -> Result<String, String> {
    let process_path = env::var("PATH").unwrap_or_default();
    let user_path = read_registry_string(HKEY_CURRENT_USER, r"Environment", "Path").unwrap_or_default();
    let machine_path = read_registry_string(
        HKEY_LOCAL_MACHINE,
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        "Path",
    ).unwrap_or_default();

    let merged_path = [process_path, user_path, machine_path]
        .into_iter()
        .flat_map(|value| {
            value
                .split(';')
                .map(|entry| entry.trim().to_string())
                .collect::<Vec<String>>()
        })
        .filter(|entry| !entry.is_empty())
        .fold(Vec::<String>::new(), |mut acc, entry| {
            if !acc.iter().any(|existing| existing.eq_ignore_ascii_case(&entry)) {
                acc.push(entry);
            }
            acc
        })
        .join(";");

    env::set_var("PATH", &merged_path);
    Ok(merged_path)
}

#[derive(Debug, Serialize, Deserialize)]
struct NativeMessage {
    action: String,
    url: Option<String>,
    output_path: Option<String>,
    cookies_data: Option<Vec<BrowserCookie>>,
    request_id: Option<String>,
    format: Option<String>,
    data: Option<String>,
    file_name: Option<String>,
    offset: Option<u64>,
    max_bytes: Option<usize>,
    file_path: Option<String>,
    channel: Option<String>,
    caption: Option<String>,
    message_id: Option<String>,
    session_path: Option<String>,
    api_id: Option<String>,
    api_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct NativeResponse {
    success: bool,
    event: Option<String>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    message: Option<String>,
    line: Option<String>,
    stream: Option<String>,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
    stdout: Option<String>,
    stderr: Option<String>,
}

fn video_session_path(request_id: &str, suffix: &str) -> PathBuf {
    env::temp_dir().join(format!("imgvault-{}-{}", sanitize_request_id(request_id), suffix))
}

fn video_normalize_start(request_id: &str) -> Result<(), String> {
    let input = video_session_path(request_id, "input");
    let output = video_session_path(request_id, "output.mp4");
    let _ = fs::remove_file(&input);
    let _ = fs::remove_file(&output);
    fs::File::create(input).map(|_| ()).map_err(|e| format!("Could not create native video input: {}", e))
}

fn video_normalize_chunk(request_id: &str, encoded: &str) -> Result<(), String> {
    let bytes = BASE64.decode(encoded).map_err(|e| format!("Invalid native video chunk: {}", e))?;
    let path = video_session_path(request_id, "input");
    let mut file = fs::OpenOptions::new().append(true).open(&path)
        .map_err(|e| format!("Could not open native video input: {}", e))?;
    file.write_all(&bytes).map_err(|e| format!("Could not write native video chunk: {}", e))
}

/// Vault video normalization quality (AGENTS.md 2.13.14): H.264 CRF 12
/// with the `slow` preset and AAC 320k — visually near-lossless, broad
/// Chromium compatibility. The code shipped `medium` (ffmpeg's default)
/// on the same day the entry was written; no entry ever chose medium,
/// so the code follows the documented decision (fixed 2.19.23).
const VIDEO_NORMALIZE_ENCODE_ARGS: &[&str] = &[
    "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "slow",
    "-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "320k",
    "-movflags", "+faststart",
];

fn video_normalize_finish(request_id: &str) -> Result<u64, String> {
    let input = video_session_path(request_id, "input");
    let output = video_session_path(request_id, "output.mp4");
    let result = Command::new("ffmpeg")
        .args(["-y", "-hwaccel", "auto", "-threads", "0", "-i"])
        .arg(&input)
        .args(VIDEO_NORMALIZE_ENCODE_ARGS)
        .arg(&output)
        .output()
        .map_err(|e| format!("Native FFmpeg is unavailable: {}", e))?;
    if !result.status.success() {
        let detail = String::from_utf8_lossy(&result.stderr);
        return Err(format!("Native FFmpeg conversion failed: {}", detail.trim()));
    }
    fs::metadata(output).map(|meta| meta.len()).map_err(|e| format!("Native FFmpeg produced no output: {}", e))
}

fn video_normalize_read(request_id: &str, offset: u64, max_bytes: usize) -> Result<(String, u64, bool), String> {
    let path = video_session_path(request_id, "output.mp4");
    let mut file = fs::File::open(&path).map_err(|e| format!("Could not open native video output: {}", e))?;
    use std::io::Seek;
    file.seek(std::io::SeekFrom::Start(offset)).map_err(|e| format!("Could not seek native video output: {}", e))?;
    let mut bytes = vec![0u8; max_bytes.min(700 * 1024)];
    let count = file.read(&mut bytes).map_err(|e| format!("Could not read native video output: {}", e))?;
    bytes.truncate(count);
    let total = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    Ok((BASE64.encode(bytes), offset, offset + count as u64 >= total))
}

fn video_normalize_cleanup(request_id: &str) {
    let _ = fs::remove_file(video_session_path(request_id, "input"));
    let _ = fs::remove_file(video_session_path(request_id, "output.mp4"));
}

// ---- generic file writer ----------------------------------------------------
// Used when the extension already holds the finished bytes (e.g. a Suno clip
// that had to be decrypted in the service worker) and only needs a place on
// disk. The target path is remembered in a sidecar file so every chunk
// message stays small - a base64 chunk of 512 KiB is already ~700 KiB on the
// wire, and Chrome drops native messages above 1 MiB.

fn file_write_target_path(request_id: &str) -> PathBuf {
    video_session_path(request_id, "target-path")
}

// A staged file keeps the original name (Telethon derives the mime type and
// the visible file name from the path), minus anything that could escape the
// stage folder.
fn sanitize_stage_file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'))
        .collect();
    let clean = clean.trim().trim_matches('.');
    if clean.is_empty() {
        "file".to_string()
    } else {
        clean.chars().take(120).collect()
    }
}

// Where a file-write session lands on disk. An empty or relative path means
// the caller has no disk path to offer - a file picked in the browser never
// has one. Stage it under %TEMP% instead so the native Telegram uploader
// still gets a real file. Absolute paths (the Suno flow) pass through
// unchanged.
fn resolve_file_write_target(request_id: &str, output_path: &str, file_name: &str) -> PathBuf {
    let given = output_path.trim();
    if given.is_empty() || PathBuf::from(given).is_relative() {
        env::temp_dir()
            .join("imgvault-tg-stage")
            .join(sanitize_request_id(request_id))
            .join(sanitize_stage_file_name(file_name))
    } else {
        PathBuf::from(given)
    }
}

fn file_write_start(request_id: &str, output_path: &str, file_name: &str) -> Result<PathBuf, String> {
    let target = resolve_file_write_target(request_id, output_path, file_name);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create the output folder {}: {}", parent.display(), e))?;
        }
    }
    fs::File::create(&target)
        .map_err(|e| format!("Could not create the output file {}: {}", target.display(), e))?;
    fs::write(file_write_target_path(request_id), target.display().to_string().as_bytes())
        .map_err(|e| format!("Could not remember the output path: {}", e))?;
    Ok(target)
}

// A path is only ever deleted when it sits under %TEMP% and carries the
// imgvault- marker, so a wrong path from a bug can never eat a user file.
fn is_deletable_staged_file(path: &Path) -> bool {
    path.starts_with(env::temp_dir()) && path.display().to_string().contains("imgvault-")
}

// Delete a staged temp file after its upload.
// Returns true when a file was removed, false when it was already gone.
fn delete_staged_file(path: &str) -> Result<bool, String> {
    let target = PathBuf::from(path);
    if !is_deletable_staged_file(&target) {
        return Err(format!(
            "Refusing to delete a file outside the imgvault temp area: {}",
            path
        ));
    }
    match fs::remove_file(&target) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("Could not delete {}: {}", target.display(), e)),
    }
}

fn file_write_resolve_target(request_id: &str) -> Result<PathBuf, String> {
    let sidecar = file_write_target_path(request_id);
    let raw = fs::read_to_string(&sidecar)
        .map_err(|e| format!("No native file-write session for {}: {}", request_id, e))?;
    Ok(PathBuf::from(raw.trim()))
}

fn file_write_chunk(request_id: &str, encoded: &str) -> Result<(), String> {
    let bytes = BASE64.decode(encoded).map_err(|e| format!("Invalid native file chunk: {}", e))?;
    let target = file_write_resolve_target(request_id)?;
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&target)
        .map_err(|e| format!("Could not open the output file {}: {}", target.display(), e))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Could not write the output file {}: {}", target.display(), e))
}

fn file_write_finish(request_id: &str) -> Result<(String, u64), String> {
    let target = file_write_resolve_target(request_id)?;
    let size = fs::metadata(&target)
        .map_err(|e| format!("Could not stat the output file {}: {}", target.display(), e))?
        .len();
    let _ = fs::remove_file(file_write_target_path(request_id));
    Ok((target.display().to_string(), size))
}

struct DownloadOutcome {
    message: String,
    file_path: Option<String>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BrowserCookie {
    domain: String,
    host_only: bool,
    path: String,
    secure: bool,
    expiration_date: i64,
    name: String,
    value: String,
}

fn get_executable_directory() -> Result<PathBuf, String> {
    let exe_path = env::current_exe()
        .map_err(|e| format!("Failed to get executable path: {}", e))?;

    exe_path
        .parent()
        .map(|dir| dir.to_path_buf())
        .ok_or_else(|| "Failed to get executable directory".to_string())
}

fn get_cookies_path() -> Result<PathBuf, String> {
    Ok(get_executable_directory()?.join("cookies.txt"))
}

fn get_default_videos_directory() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let user_profile = env::var("USERPROFILE")
            .map_err(|e| format!("Failed to resolve USERPROFILE for default Videos path: {}", e))?;
        Ok(PathBuf::from(user_profile).join("Videos"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        env::current_dir().map_err(|e| format!("Failed to resolve default download directory: {}", e))
    }
}

fn get_output_directory(output_path: &str) -> Result<PathBuf, String> {
    PathBuf::from(output_path)
        .parent()
        .map(|dir| dir.to_path_buf())
        .ok_or_else(|| "Failed to determine download directory from output_path".to_string())
}

fn sanitize_request_id(request_id: &str) -> String {
    request_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn get_request_pid_path(request_id: &str) -> PathBuf {
    env::temp_dir().join(format!(
        "imgvault-native-download-{}.pid",
        sanitize_request_id(request_id)
    ))
}

fn write_request_pid(request_id: &str, pid: u32) -> Result<(), String> {
    fs::write(get_request_pid_path(request_id), pid.to_string())
        .map_err(|e| format!("Failed to write request pid file: {}", e))
}

fn remove_request_pid(request_id: &str) {
    let _ = fs::remove_file(get_request_pid_path(request_id));
}

fn get_cancel_flag_path(request_id: &str) -> PathBuf {
    env::temp_dir().join(format!(
        "imgvault-native-download-{}.cancel",
        sanitize_request_id(request_id)
    ))
}

fn write_cancel_flag(request_id: &str) -> Result<(), String> {
    fs::write(get_cancel_flag_path(request_id), "1")
        .map_err(|e| format!("Failed to write cancel flag: {}", e))
}

fn has_cancel_flag(request_id: &str) -> bool {
    get_cancel_flag_path(request_id).exists()
}

fn remove_cancel_flag(request_id: &str) {
    let _ = fs::remove_file(get_cancel_flag_path(request_id));
}

fn truncate_for_native_message(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    // Find a safe UTF-8 boundary at or before max_bytes
    let mut safe_cut = max_bytes;
    while safe_cut > 0 && !text.is_char_boundary(safe_cut) {
        safe_cut -= 1;
    }
    let truncated = &text[..safe_cut];
    // Prefer to cut at last newline to avoid breaking mid-line
    let cut = truncated.rfind('\n').unwrap_or(safe_cut);
    // Ensure the chosen cut is still a char boundary (newline is always 1 byte)
    let mut final_cut = cut;
    while final_cut > 0 && !text.is_char_boundary(final_cut) {
        final_cut -= 1;
    }
    format!(
        "{}… [truncated {} bytes, showing first {} of {}]",
        &text[..final_cut],
        text.len() - final_cut,
        final_cut,
        text.len()
    )
}

fn looks_like_downloaded_path(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('[')
        || trimmed.starts_with("WARNING:")
        || trimmed.starts_with("ERROR:")
    {
        return false;
    }
    // Must be an absolute-ish filesystem path: `C:\` / `C:/`, a `\\UNC\` share,
    // or a leading `/` (nix). This rejects ffmpeg log lines like
    // `Input #0, ... from 'C:\...'` and bare URLs (`https://...`).
    let drive_absolute = trimmed.len() >= 3
        && trimmed.as_bytes()[1] == b':'
        && (trimmed.as_bytes()[2] == b'\\' || trimmed.as_bytes()[2] == b'/');
    let absolute = drive_absolute
        || trimmed.starts_with("\\\\")
        || trimmed.starts_with('/');
    if !absolute {
        return false;
    }
    // The final path segment must carry a real extension.
    let name = trimmed.rsplit(['\\', '/']).next().unwrap_or("");
    name.contains('.') && !name.ends_with('.')
}

/// Pull the final output file path that `--print after_move:filepath` emitted.
/// The path is the last clean line yt-dlp writes, so scan `stdout` first (that
/// is where `--print` writes), then fall back to `stderr` in case it landed on
/// the progress stream. Callers MUST run this on the FULL, untruncated streams:
/// head-truncating the payload (Chrome's 1 MB native-message cap) cuts off the
/// tail where the path lives, which used to surface as a false
/// "yt-dlp did not return a file path" after the download had actually finished.
fn extract_downloaded_path(stdout_text: &str, stderr_text: &str) -> Option<String> {
    stdout_text
        .lines()
        .rev()
        .find(|line| looks_like_downloaded_path(line))
        .or_else(|| stderr_text.lines().rev().find(|line| looks_like_downloaded_path(line)))
        .map(|line| line.trim().to_string())
}

// Completion journal: the single-threaded host keeps downloading even if the
// extension's port dies (extension reload / service worker restart), so the
// extension can't receive the final result. The host records the outcome to a
// per-request journal file in the temp dir; the extension reads it on startup
// and adopts the real result (completed -> normal completion flow with the
// pending auto-upload, failed -> failure state) instead of guessing.
fn get_request_journal_path(request_id: &str) -> PathBuf {
    env::temp_dir().join(format!(
        "imgvault-yt-dlp-journal-{}.json",
        sanitize_request_id(request_id)
    ))
}

fn write_download_journal(
    request_id: &str,
    status: &str,
    file_path: Option<&str>,
    message: Option<&str>,
    stdout: Option<&str>,
    stderr: Option<&str>,
) -> Result<(), String> {
    let entry = serde_json::json!({
        "requestId": request_id,
        "status": status,
        "file_path": file_path,
        "message": message,
        "stdout": stdout,
        "stderr": stderr,
        "completedAt": chrono_now_ms(),
    });
    let path = get_request_journal_path(request_id);
    fs::write(&path, serde_json::to_string_pretty(&entry).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to write download journal {}: {}", path.display(), e))
}

fn read_download_journal(request_id: &str) -> Option<serde_json::Value> {
    let path = get_request_journal_path(request_id);
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<serde_json::Value>(&raw).ok()
}

fn remove_download_journal(request_id: &str) {
    let _ = fs::remove_file(get_request_journal_path(request_id));
}

// Upload completion journal: same shape as the download journal, for the
// native Telegram upload. The page that owns the upload port can die (tab
// frozen/discarded by Edge sleeping tabs, extension reload, crash) while
// the Telethon child keeps running in its own process — the upload then
// completes server-side but the result never reaches any live context,
// and the run stays "running" forever (2026-11-24: a 381 MB vault upload
// stuck at 74%, post msg 701 landed, no vault item saved). The host
// records the outcome to a per-request journal file in the temp dir; the
// extension re-checks it when the event stream goes silent or when it
// reconciles a stale run, and adopts the real result instead of guessing.
fn get_upload_journal_path(request_id: &str) -> PathBuf {
    env::temp_dir().join(format!(
        "imgvault-tg-upload-journal-{}.json",
        sanitize_request_id(request_id)
    ))
}

fn write_upload_journal(
    request_id: &str,
    status: &str,
    file_path: Option<&str>,
    channel: Option<&str>,
    message: Option<&str>,
    stdout: Option<&str>,
    stderr: Option<&str>,
) -> Result<(), String> {
    let entry = serde_json::json!({
        "requestId": request_id,
        "status": status,
        "file_path": file_path,
        "channel": channel,
        "message": message,
        "stdout": stdout,
        "stderr": stderr,
        "completedAt": chrono_now_ms(),
    });
    let path = get_upload_journal_path(request_id);
    fs::write(&path, serde_json::to_string_pretty(&entry).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to write upload journal {}: {}", path.display(), e))
}

fn read_upload_journal(request_id: &str) -> Option<serde_json::Value> {
    let path = get_upload_journal_path(request_id);
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<serde_json::Value>(&raw).ok()
}

fn remove_upload_journal(request_id: &str) {
    let _ = fs::remove_file(get_upload_journal_path(request_id));
}

fn chrono_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(_) => 0,
    }
}

#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // Try graceful termination first (no /F), give yt-dlp a moment to clean up its .part file,
    // then force kill if it is still alive. This avoids leaving a corrupt partial file
    // and is noticeably faster to settle than an immediate /F.
    let graceful = Command::new("taskkill")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("Failed to execute taskkill: {}", e))?;

    // If graceful succeeded the process tree is already gone
    if graceful.success() {
        std::thread::sleep(std::time::Duration::from_millis(400));
        // Probe whether the PID still exists via tasklist
        let probe = Command::new("tasklist")
            .arg("/FI")
            .arg(format!("PID eq {}", pid))
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(output) = probe {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            // tasklist prints the PID when still alive
            if !stdout.contains(&pid.to_string()) {
                return Ok(());
            }
        } else {
            return Ok(());
        }
    }

    // Force kill fallback
    let status = Command::new("taskkill")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .arg("/F")
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("Failed to execute taskkill: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("taskkill failed with exit code {:?}", status.code()))
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree(pid: u32) -> Result<(), String> {
    let status = Command::new("kill")
        .arg("-9")
        .arg(pid.to_string())
        .status()
        .map_err(|e| format!("Failed to execute kill: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("kill failed with exit code {:?}", status.code()))
    }
}

fn cancel_download_request(request_id: &str) -> Result<String, String> {
    let pid_path = get_request_pid_path(request_id);
    // Graceful stop: if no pid file, the download already finished or was already stopped.
    // Return success so the UI doesn't show a scary "No active download" error.
    if !pid_path.exists() {
        // Check if a cancel flag already exists — second stop click while first is still settling
        if has_cancel_flag(request_id) {
            return Ok(format!("Stop already requested for {}", request_id));
        }
        // Also check journal — if download finished naturally between the UI read and the stop click
        if read_download_journal(request_id).is_some() {
            return Ok(format!("Download already finished for {}", request_id));
        }
        return Ok(format!("No active download for {} — already stopped", request_id));
    }

    let pid_text = fs::read_to_string(&pid_path)
        .map_err(|e| format!("Failed to read request pid file: {}", e))?;
    let pid = pid_text
        .trim()
        .parse::<u32>()
        .map_err(|e| format!("Failed to parse request pid: {}", e))?;

    // Flag the request as user-cancelled so the blocked download thread can
    // distinguish a kill from a real yt-dlp failure and send a small
    // "Download stopped by user" response instead of a multi-MB stdout dump
    // (which would exceed Chrome's 1 MB native-message limit and surface as
    // "Error when communicating with the native messaging host.").
    let _ = write_cancel_flag(request_id);

    match kill_process_tree(pid) {
        Ok(_) => {
            remove_request_pid(request_id);
            Ok(format!("Stop signal sent for request {}", request_id))
        }
        Err(e) => {
            // Even if taskkill reports failure (process already exited), treat as success —
            // the important part is the cancel flag above, which tells the download thread
            // to settle gracefully.
            remove_request_pid(request_id);
            Ok(format!("Stop signal sent for request {} ({}). Cleaning up.", request_id, e))
        }
    }
}

fn write_temp_cookies_file(cookies: &[BrowserCookie]) -> Result<PathBuf, String> {
    let temp_dir = env::temp_dir();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to create timestamp for temp cookie file: {}", e))?
        .as_millis();
    let path = temp_dir.join(format!("imgvault-yt-dlp-cookies-{}.txt", timestamp));

    let mut contents = String::from("# Netscape HTTP Cookie File\n# Generated by ImgVault\n");
    for cookie in cookies {
        let include_subdomains = if cookie.host_only { "FALSE" } else { "TRUE" };
        let secure = if cookie.secure { "TRUE" } else { "FALSE" };
        contents.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
            cookie.domain,
            include_subdomains,
            cookie.path,
            secure,
            cookie.expiration_date.max(0),
            cookie.name,
            cookie.value
        ));
    }

    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write temporary cookies file: {}", e))?;

    Ok(path)
}

fn add_cookies_argument(command: &mut Command, cookies_data: Option<&[BrowserCookie]>) -> Result<Option<PathBuf>, String> {
    if let Some(cookies) = cookies_data {
        if !cookies.is_empty() {
            let temp_path = write_temp_cookies_file(cookies)?;
            command.arg("--cookies").arg(&temp_path);
            return Ok(Some(temp_path));
        }
    }

    let cookies_path = get_cookies_path()?;
    if cookies_path.exists() {
        command.arg("--cookies").arg(&cookies_path);
        return Ok(Some(cookies_path));
    }

    Ok(None)
}

fn cleanup_temp_cookies_file(path: &Option<PathBuf>) {
    if let Some(path) = path {
        if let Some(file_name) = path.file_name().and_then(|name| name.to_str()) {
            if file_name.starts_with("imgvault-yt-dlp-cookies-") {
                let _ = fs::remove_file(path);
            }
        }
    }
}

/// Rewrite mirror-site URLs to their canonical upstream URL so yt-dlp can use
/// the dedicated extractor instead of the generic one.
///
/// ukdevilz.com mirrors VK videos under `/watch/{owner_id}_{video_id}`; its own
/// `/videofile/{id}.mp4` endpoint returns stale links (Cloudflare challenge /
/// 404) while the upstream `vk.com/video-{owner}_{id}` resolves cleanly.
fn rewrite_mirror_url(url: &str) -> String {
    let lowered = url.to_ascii_lowercase();
    let host = lowered
        .split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .map(|h| h.split('@').last().unwrap_or(h))
        .map(|h| h.split(':').next().unwrap_or(h))
        .unwrap_or_default();

    if host == "ukdevilz.com" || host.ends_with(".ukdevilz.com") {
        if let Some(captures) = lowered
            .split("://")
            .nth(1)
            .and_then(|rest| rest.split(['?', '#']).next())
            .and_then(|path| {
                path.strip_prefix("ukdevilz.com/watch/")
                    .or_else(|| path.strip_prefix("www.ukdevilz.com/watch/"))
            })
        {
            let video_id = captures.trim_end_matches('/');
            if !video_id.is_empty()
                && video_id
                    .chars()
                    .all(|c| c.is_ascii_digit() || c == '-' || c == '_')
            {
                return format!("https://vk.com/video{}", video_id);
            }
        }
    }

    url.to_string()
}

const TELEGRAM_ACCOUNT: &str = "+8801956799504";
const DEFAULT_TELEGRAM_API_ID: &str = "27462865";
const DEFAULT_TELEGRAM_API_HASH: &str = "63358074ffa2262b19f4451497a85b34";

fn telegram_account_dir(app_data: &str) -> String {
    format!(r"{}\mainframe\accounts\telegram\{}", app_data, TELEGRAM_ACCOUNT)
}

#[derive(Debug, PartialEq)]
struct TelegramUploadArgs {
    session: String,
    api_id: String,
    api_hash: String,
}

// Resolve the Telethon session path and API credentials. Explicit values win;
// otherwise the api-id.txt / api-hash.txt file contents (when the caller read
// them) win; otherwise the compiled-in defaults apply. File contents are
// trimmed, explicit values are used as given.
fn resolve_telegram_upload_args(
    app_data: &str,
    session_path: Option<&str>,
    api_id: Option<&str>,
    api_hash: Option<&str>,
    api_id_file: Option<&str>,
    api_hash_file: Option<&str>,
) -> TelegramUploadArgs {
    let session = session_path
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!(r"{}\telegram", telegram_account_dir(app_data)));
    let api_id = api_id
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| api_id_file.map(|contents| contents.trim().to_string()))
        .unwrap_or_else(|| DEFAULT_TELEGRAM_API_ID.to_string());
    let api_hash = api_hash
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| api_hash_file.map(|contents| contents.trim().to_string()))
        .unwrap_or_else(|| DEFAULT_TELEGRAM_API_HASH.to_string());
    TelegramUploadArgs {
        session,
        api_id,
        api_hash,
    }
}

// One stdout line from telegram_upload.py / telegram_download.py:
// PROGRESS:<current>:<total>:<percent>, DATA:<base64 of <=512 KiB>,
// RESULT:<json>, ERROR:<message>, or anything else (ignored).
#[derive(Debug, PartialEq)]
enum TelegramUploaderLine {
    Progress {
        current: String,
        total: String,
        percent: String,
    },
    Data(String),
    Result(String),
    Error(String),
    Other,
}

fn parse_telegram_uploader_line(line: &str) -> TelegramUploaderLine {
    if let Some(progress) = line.strip_prefix("PROGRESS:") {
        let parts: Vec<&str> = progress.split(':').collect();
        if parts.len() >= 3 {
            return TelegramUploaderLine::Progress {
                current: parts[0].to_string(),
                total: parts[1].to_string(),
                percent: parts[2].to_string(),
            };
        }
        return TelegramUploaderLine::Other;
    }
    if let Some(data) = line.strip_prefix("DATA:") {
        return TelegramUploaderLine::Data(data.to_string());
    }
    if let Some(res) = line.strip_prefix("RESULT:") {
        return TelegramUploaderLine::Result(res.to_string());
    }
    if let Some(err) = line.strip_prefix("ERROR:") {
        return TelegramUploaderLine::Error(err.to_string());
    }
    TelegramUploaderLine::Other
}

// Where a telegram helper script (telegram_upload.py, telegram_verify.py,
// telegram_download.py) lives: next to the exe in `scripts/`, with the dev-clone path as the
// fallback (the release exe ships beside the repo checkout, so both
// resolve to the same file on the laptop).
fn resolve_telegram_script(script_name: &str) -> Option<String> {
    let exe_dir = env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let script_path = exe_dir
        .map(|d| d.join("scripts").join(script_name))
        .unwrap_or_else(|| PathBuf::from("native-host/scripts").join(script_name));
    if script_path.exists() {
        return Some(script_path.display().to_string());
    }
    let dev_fallback = PathBuf::from(r"C:\Users\Admin\Downloads\imgvault\native-host\scripts").join(script_name);
    if dev_fallback.exists() {
        return Some(dev_fallback.display().to_string());
    }
    None
}

fn handle_telegram_upload(
    stdout: &mut io::Stdout,
    request_id: Option<&str>,
    file_path: &str,
    channel: &str,
    caption: Option<&str>,
    session_path: Option<&str>,
    api_id: Option<&str>,
    api_hash: Option<&str>,
) -> NativeResponse {
    let app_data = env::var("APPDATA").unwrap_or_default();
    let account_dir = telegram_account_dir(&app_data);
    // The credential files are only read when no explicit value was given.
    let api_id_file = if api_id.filter(|s| !s.trim().is_empty()).is_none() {
        fs::read_to_string(format!(r"{}\api-id.txt", account_dir)).ok()
    } else {
        None
    };
    let api_hash_file = if api_hash.filter(|s| !s.trim().is_empty()).is_none() {
        fs::read_to_string(format!(r"{}\api-hash.txt", account_dir)).ok()
    } else {
        None
    };
    let resolved = resolve_telegram_upload_args(
        &app_data,
        session_path,
        api_id,
        api_hash,
        api_id_file.as_deref(),
        api_hash_file.as_deref(),
    );

    let script_str = match resolve_telegram_script("telegram_upload.py") {
        Some(path) => path,
        None => {
            return NativeResponse {
                success: false,
                event: Some("complete".to_string()),
                request_id: request_id.map(|s| s.to_string()),
                message: Some("telegram_upload.py script not found (looked beside the exe and in the dev clone)".to_string()),
                line: None,
                stream: None,
                file_path: None,
                stdout: None,
                stderr: None,
            };
        }
    };

    let mut cmd = Command::new("python");
    cmd.arg(&script_str)
        .arg("--session")
        .arg(&resolved.session)
        .arg("--api-id")
        .arg(&resolved.api_id)
        .arg("--api-hash")
        .arg(&resolved.api_hash)
        .arg("--channel")
        .arg(channel)
        .arg("--file")
        .arg(file_path);

    if let Some(cap) = caption.filter(|s| !s.is_empty()) {
        cmd.arg("--caption").arg(cap);
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return NativeResponse {
                success: false,
                event: Some("complete".to_string()),
                request_id: request_id.map(|s| s.to_string()),
                message: Some(format!("Failed to spawn python uploader: {}", e)),
                line: None,
                stream: None,
                file_path: None,
                stdout: None,
                stderr: None,
            };
        }
    };

    let child_stdout = child.stdout.take();
    let child_stderr = child.stderr.take();

    // Drain stderr on its own thread from the start: the old code only
    // read it AFTER child.wait(), so a chatty child (Telethon warnings,
    // tracebacks) could fill the pipe buffer and block forever mid-upload
    // — the page would see a stuck upload with no error at all. The yt-dlp
    // handler already drains both streams concurrently; this is the same
    // fix for the telegram path.
    let stderr_handle = child_stderr.map(|err| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = BufReader::new(err).read_to_string(&mut buf);
            buf
        })
    });

    // The journal is the only record that survives the extension page
    // dying mid-upload (tab freeze/discard, reload, crash): "running"
    // goes down at spawn so a later re-check can tell "still uploading"
    // from "never started", and the terminal entry lands below.
    if let Some(active_request_id) = request_id {
        if let Err(error) = write_upload_journal(
            active_request_id,
            "running",
            Some(file_path),
            Some(channel),
            Some("Telegram upload started"),
            None,
            None,
        ) {
            eprintln!("[NATIVE] Failed to persist upload journal: {}", error);
        }
    }

    let mut final_result: Option<String> = None;
    let mut last_error: Option<String> = None;

    if let Some(out) = child_stdout {
        let reader = BufReader::new(out);
        for line_res in reader.lines() {
            if let Ok(line) = line_res {
                match parse_telegram_uploader_line(&line) {
                    TelegramUploaderLine::Progress { current, total, percent } => {
                        let _ = send_native_response(
                            stdout,
                            &NativeResponse {
                                success: true,
                                event: Some("progress".to_string()),
                                request_id: request_id.map(|s| s.to_string()),
                                message: Some(format!("Uploaded {} / {} ({}%)", current, total, percent)),
                                line: Some(line.clone()),
                                stream: Some("stdout".to_string()),
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        );
                    }
                    TelegramUploaderLine::Result(res) => final_result = Some(res),
                    TelegramUploaderLine::Error(err) => last_error = Some(err),
                    TelegramUploaderLine::Data(_) => {}
                    TelegramUploaderLine::Other => {}
                }
            }
        }
    }

    let status = child.wait();
    let stderr_text = stderr_handle
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();

    let response = if let Some(res_json) = final_result {
        NativeResponse {
            success: true,
            event: Some("complete".to_string()),
            request_id: request_id.map(|s| s.to_string()),
            message: Some("Telegram upload succeeded".to_string()),
            line: None,
            stream: None,
            file_path: Some(file_path.to_string()),
            stdout: Some(res_json),
            stderr: None,
        }
    } else {
        let err_msg = last_error
            .or_else(|| {
                if !stderr_text.trim().is_empty() {
                    Some(stderr_text.trim().to_string())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| format!("Uploader exited with code {:?}", status.ok().and_then(|s| s.code())));

        NativeResponse {
            success: false,
            event: Some("complete".to_string()),
            request_id: request_id.map(|s| s.to_string()),
            message: Some(err_msg),
            line: None,
            stream: None,
            file_path: None,
            stdout: None,
            stderr: Some(stderr_text.clone()),
        }
    };

    // Terminal journal entry: this is what the extension reads when the
    // page that owned the port is gone. Best-effort only — a failed
    // journal write must never turn a successful upload into a failure.
    // The stderr tail is trimmed: a traceback can be long and the journal
    // is a file, not a message, but there is no reason to keep megabytes.
    if let Some(active_request_id) = request_id {
        let stderr_tail: String = stderr_text.chars().rev().take(4096).collect::<String>().chars().rev().collect();
        let journal_result = if response.success {
            write_upload_journal(
                active_request_id,
                "completed",
                Some(file_path),
                Some(channel),
                Some("Telegram upload succeeded"),
                response.stdout.as_deref(),
                None,
            )
        } else {
            write_upload_journal(
                active_request_id,
                "failed",
                Some(file_path),
                Some(channel),
                response.message.as_deref(),
                None,
                if stderr_tail.trim().is_empty() { None } else { Some(stderr_tail.as_str()) },
            )
        };
        if let Err(error) = journal_result {
            eprintln!("[NATIVE] Failed to persist upload journal: {}", error);
        }
    }

    response
}

// Verify one Telegram channel file through the Telethon session — the
// only reader that can see a file the Bot API getFile gate refuses
// (> 20 MB, e.g. the 30 MB ceramic spz). telegram_verify.py reads the
// message by id and prints RESULT:{ok, messageId, size, name}; the
// extension compares the size against the stored size (exact match =
// found). No progress events: a verify is one read, not a transfer.
fn handle_telegram_verify(
    request_id: Option<&str>,
    message_id: &str,
    channel: &str,
    session_path: Option<&str>,
    api_id: Option<&str>,
    api_hash: Option<&str>,
) -> NativeResponse {
    let app_data = env::var("APPDATA").unwrap_or_default();
    let account_dir = telegram_account_dir(&app_data);
    let api_id_file = if api_id.filter(|s| !s.trim().is_empty()).is_none() {
        fs::read_to_string(format!(r"{}\api-id.txt", account_dir)).ok()
    } else {
        None
    };
    let api_hash_file = if api_hash.filter(|s| !s.trim().is_empty()).is_none() {
        fs::read_to_string(format!(r"{}\api-hash.txt", account_dir)).ok()
    } else {
        None
    };
    let resolved = resolve_telegram_upload_args(
        &app_data,
        session_path,
        api_id,
        api_hash,
        api_id_file.as_deref(),
        api_hash_file.as_deref(),
    );

    let script_str = match resolve_telegram_script("telegram_verify.py") {
        Some(path) => path,
        None => {
            return NativeResponse {
                success: false,
                event: Some("complete".to_string()),
                request_id: request_id.map(|s| s.to_string()),
                message: Some("telegram_verify.py script not found (looked beside the exe and in the dev clone)".to_string()),
                line: None,
                stream: None,
                file_path: None,
                stdout: None,
                stderr: None,
            };
        }
    };

    let mut cmd = Command::new("python");
    cmd.arg(&script_str)
        .arg("--session")
        .arg(&resolved.session)
        .arg("--api-id")
        .arg(&resolved.api_id)
        .arg("--api-hash")
        .arg(&resolved.api_hash)
        .arg("--channel")
        .arg(channel)
        .arg("--message-id")
        .arg(message_id);

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return NativeResponse {
                success: false,
                event: Some("complete".to_string()),
                request_id: request_id.map(|s| s.to_string()),
                message: Some(format!("Failed to spawn python verifier: {}", e)),
                line: None,
                stream: None,
                file_path: None,
                stdout: None,
                stderr: None,
            };
        }
    };

    let child_stdout = child.stdout.take();
    let child_stderr = child.stderr.take();

    let mut final_result: Option<String> = None;
    let mut last_error: Option<String> = None;

    if let Some(out) = child_stdout {
        let reader = BufReader::new(out);
        for line_res in reader.lines() {
            if let Ok(line) = line_res {
                match parse_telegram_uploader_line(&line) {
                    TelegramUploaderLine::Result(res) => final_result = Some(res),
                    TelegramUploaderLine::Error(err) => last_error = Some(err),
                    _ => {}
                }
            }
        }
    }

    let status = child.wait();
    let stderr_text = child_stderr
        .map(|err| {
            let mut buf = String::new();
            let _ = BufReader::new(err).read_to_string(&mut buf);
            buf
        })
        .unwrap_or_default();

    if let Some(res_json) = final_result {
        NativeResponse {
            success: true,
            event: Some("complete".to_string()),
            request_id: request_id.map(|s| s.to_string()),
            message: Some("Telegram verify succeeded".to_string()),
            line: None,
            stream: None,
            file_path: None,
            stdout: Some(res_json),
            stderr: None,
        }
    } else {
        let err_msg = last_error
            .or_else(|| {
                if !stderr_text.trim().is_empty() {
                    Some(stderr_text.trim().to_string())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| format!("Verifier exited with code {:?}", status.ok().and_then(|s| s.code())));

        NativeResponse {
            success: false,
            event: Some("complete".to_string()),
            request_id: request_id.map(|s| s.to_string()),
            message: Some(err_msg),
            line: None,
            stream: None,
            file_path: None,
            stdout: None,
            stderr: Some(stderr_text),
        }
    }
}

// Download a byte range of one Telegram channel file through the Telethon
// session — the only reader for a vault blob the Bot API can never serve:
// a Telethon-uploaded file has no Bot API file_id (the extension stores
// `native-<messageId>`), and getFile refuses any file over 20 MB anyway.
// telegram_download.py prints DATA:<base64> lines (<=512 KiB of bytes
// each) plus a final RESULT:{ok, messageId, offset, length, size}; each
// DATA line goes out to the extension as its own native message (event
// "data") the moment it arrives, so a 72 MB blob never sits in one
// 1 MiB-capped native message. Length 0 means "to end of file".
fn handle_telegram_download(
    stdout: &mut io::Stdout,
    request_id: Option<&str>,
    message_id: &str,
    channel: &str,
    offset: u64,
    length: u64,
    session_path: Option<&str>,
    api_id: Option<&str>,
    api_hash: Option<&str>,
) -> NativeResponse {
    let app_data = env::var("APPDATA").unwrap_or_default();
    let account_dir = telegram_account_dir(&app_data);
    let api_id_file = if api_id.filter(|s| !s.trim().is_empty()).is_none() {
        fs::read_to_string(format!(r"{}\api-id.txt", account_dir)).ok()
    } else {
        None
    };
    let api_hash_file = if api_hash.filter(|s| !s.trim().is_empty()).is_none() {
        fs::read_to_string(format!(r"{}\api-hash.txt", account_dir)).ok()
    } else {
        None
    };
    let resolved = resolve_telegram_upload_args(
        &app_data,
        session_path,
        api_id,
        api_hash,
        api_id_file.as_deref(),
        api_hash_file.as_deref(),
    );

    let script_str = match resolve_telegram_script("telegram_download.py") {
        Some(path) => path,
        None => {
            return NativeResponse {
                success: false,
                event: Some("complete".to_string()),
                request_id: request_id.map(|s| s.to_string()),
                message: Some("telegram_download.py script not found (looked beside the exe and in the dev clone)".to_string()),
                line: None,
                stream: None,
                file_path: None,
                stdout: None,
                stderr: None,
            };
        }
    };

    let mut cmd = Command::new("python");
    cmd.arg(&script_str)
        .arg("--session")
        .arg(&resolved.session)
        .arg("--api-id")
        .arg(&resolved.api_id)
        .arg("--api-hash")
        .arg(&resolved.api_hash)
        .arg("--channel")
        .arg(channel)
        .arg("--message-id")
        .arg(message_id)
        .arg("--offset")
        .arg(offset.to_string())
        .arg("--length")
        .arg(length.to_string());

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return NativeResponse {
                success: false,
                event: Some("complete".to_string()),
                request_id: request_id.map(|s| s.to_string()),
                message: Some(format!("Failed to spawn python downloader: {}", e)),
                line: None,
                stream: None,
                file_path: None,
                stdout: None,
                stderr: None,
            };
        }
    };

    let child_stdout = child.stdout.take();
    let child_stderr = child.stderr.take();

    let mut final_result: Option<String> = None;
    let mut last_error: Option<String> = None;

    if let Some(out) = child_stdout {
        let reader = BufReader::new(out);
        for line_res in reader.lines() {
            if let Ok(line) = line_res {
                match parse_telegram_uploader_line(&line) {
                    TelegramUploaderLine::Data(_) => {
                        let _ = send_native_response(
                            stdout,
                            &NativeResponse {
                                success: true,
                                event: Some("data".to_string()),
                                request_id: request_id.map(|s| s.to_string()),
                                message: None,
                                line: Some(line.clone()),
                                stream: Some("stdout".to_string()),
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        );
                    }
                    TelegramUploaderLine::Result(res) => final_result = Some(res),
                    TelegramUploaderLine::Error(err) => last_error = Some(err),
                    _ => {}
                }
            }
        }
    }

    let status = child.wait();
    let stderr_text = child_stderr
        .map(|err| {
            let mut buf = String::new();
            let _ = BufReader::new(err).read_to_string(&mut buf);
            buf
        })
        .unwrap_or_default();

    if let Some(res_json) = final_result {
        NativeResponse {
            success: true,
            event: Some("complete".to_string()),
            request_id: request_id.map(|s| s.to_string()),
            message: Some("Telegram download succeeded".to_string()),
            line: None,
            stream: None,
            file_path: None,
            stdout: Some(res_json),
            stderr: None,
        }
    } else {
        let err_msg = last_error
            .or_else(|| {
                if !stderr_text.trim().is_empty() {
                    Some(stderr_text.trim().to_string())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| format!("Downloader exited with code {:?}", status.ok().and_then(|s| s.code())));

        NativeResponse {
            success: false,
            event: Some("complete".to_string()),
            request_id: request_id.map(|s| s.to_string()),
            message: Some(err_msg),
            line: None,
            stream: None,
            file_path: None,
            stdout: None,
            stderr: Some(stderr_text),
        }
    }
}

// Chrome native messaging framing: a 4-byte native-endian length prefix
// (little-endian on every target this host ships for) followed by the JSON
// payload.
fn encode_native_response(response: &NativeResponse) -> Result<Vec<u8>, String> {
    let response_json = serde_json::to_string(response)
        .map_err(|e| format!("Failed to serialize response: {}", e))?;
    let mut bytes = Vec::with_capacity(4 + response_json.len());
    bytes.extend_from_slice(&(response_json.len() as u32).to_ne_bytes());
    bytes.extend_from_slice(response_json.as_bytes());
    Ok(bytes)
}

fn send_native_response(stdout: &mut io::Stdout, response: &NativeResponse) -> Result<(), String> {
    let bytes = encode_native_response(response)?;

    stdout
        .write_all(&bytes[..4])
        .map_err(|e| format!("Failed to write response length: {}", e))?;
    stdout
        .write_all(&bytes[4..])
        .map_err(|e| format!("Failed to write response content: {}", e))?;
    stdout
        .flush()
        .map_err(|e| format!("Failed to flush stdout: {}", e))?;

    Ok(())
}

// Check if the native messaging host is registered
fn check_registration() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path = r"Software\Google\Chrome\NativeMessagingHosts\com.imgvault.nativehost";
        
        match hkcu.open_subkey(path) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    Ok(false)
}

// Register the native messaging host
fn register_host(extension_id: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Get the executable path
        let exe_path = env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?;
        
        let exe_dir = exe_path.parent()
            .ok_or("Failed to get executable directory")?;
        
        // Create manifest.json with provided extension ID
        let manifest_path = exe_dir.join("manifest.json");
        let allowed_origin = format!("chrome-extension://{}/", extension_id);
        
        let manifest_content = serde_json::json!({
            "name": "com.imgvault.nativehost",
            "description": "ImgVault Native Messaging Host",
            "path": exe_path.to_str().unwrap(),
            "type": "stdio",
            "allowed_origins": [
                allowed_origin
            ]
        });
        
        fs::write(&manifest_path, serde_json::to_string_pretty(&manifest_content).unwrap())
            .map_err(|e| format!("Failed to write manifest: {}", e))?;
        
        // Write registry key
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path = r"Software\Google\Chrome\NativeMessagingHosts\com.imgvault.nativehost";
        
        let (key, _) = hkcu.create_subkey(path)
            .map_err(|e| format!("Failed to create registry key: {}", e))?;
        
        key.set_value("", &manifest_path.to_str().unwrap())
            .map_err(|e| format!("Failed to set registry value: {}", e))?;
        
        Ok(())
    }
    
    #[cfg(not(target_os = "windows"))]
    Err("Registration only supported on Windows".to_string())
}

// Unregister the native messaging host
fn unregister_host() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Delete registry key
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let parent_path = r"Software\Google\Chrome\NativeMessagingHosts";
        let host_name = "com.imgvault.nativehost";
        
        match hkcu.open_subkey_with_flags(parent_path, winreg::enums::KEY_WRITE) {
            Ok(parent_key) => {
                match parent_key.delete_subkey(host_name) {
                    Ok(_) => {},
                    Err(e) => return Err(format!("Failed to delete registry key: {}", e)),
                }
            },
            Err(e) => return Err(format!("Failed to open parent registry key: {}", e)),
        }
        
        // Delete manifest.json if it exists
        let exe_path = env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?;
        
        let exe_dir = exe_path.parent()
            .ok_or("Failed to get executable directory")?;
        
        let manifest_path = exe_dir.join("manifest.json");
        if manifest_path.exists() {
            fs::remove_file(&manifest_path)
                .map_err(|e| format!("Failed to delete manifest: {}", e))?;
        }
        
        Ok(())
    }
    
    #[cfg(not(target_os = "windows"))]
    Err("Unregistration only supported on Windows".to_string())
}

fn reload_path() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        reload_windows_path_environment()
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("PATH reload is only supported on Windows".to_string())
    }
}

fn check_cookies() -> Result<String, String> {
    let cookies_path = get_cookies_path()?;
    if cookies_path.exists() {
        Ok(format!("cookies.txt found: {}", cookies_path.display()))
    } else {
        Err(format!("cookies.txt not found: {}", cookies_path.display()))
    }
}

// Join the non-empty yt-dlp streams for an error report, stderr first.
fn combine_ytdlp_output(stdout_text: &str, stderr_text: &str) -> String {
    [stderr_text.trim(), stdout_text.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn ytdlp_failure_message(combined: &str, exit_code: Option<i32>) -> String {
    if combined.is_empty() {
        format!("yt-dlp failed with exit code {:?}", exit_code)
    } else {
        format!("yt-dlp failed:\n{}", combined)
    }
}

// A long title can push the output path past the filesystem limit; retry once
// with the title capped at 180 bytes. `combined_lower` is the lowercased
// combined yt-dlp output.
fn should_retry_with_short_title(output_path: &str, combined_lower: &str) -> bool {
    output_path.contains("%(title)s")
        && !output_path.contains("%(title).180B")
        && (combined_lower.contains("unable to open for writing")
            || combined_lower.contains("no such file or directory"))
}

// The site served an unreadable page (or a 403); retry up to 2 more times.
fn should_retry_extraction(attempt: u32, combined_lower: &str) -> bool {
    attempt < 2
        && (combined_lower.contains("unable to extract universal data for rehydration")
            || combined_lower.contains("http error 403"))
}

// Download video using yt-dlp
fn download_video(url: &str, output_path: &str, cookies_data: Option<&[BrowserCookie]>) -> Result<DownloadOutcome, DownloadOutcome> {
    let output_dir = get_output_directory(output_path)
        .map_err(|message| DownloadOutcome {
            message,
            file_path: None,
            stdout: String::new(),
            stderr: String::new(),
        })?;

    if !output_dir.exists() {
        fs::create_dir_all(&output_dir)
            .map_err(|e| DownloadOutcome {
                message: format!("Failed to create download directory {}: {}", output_dir.display(), e),
                file_path: None,
                stdout: String::new(),
                stderr: String::new(),
            })?;
    }

    let mut command = Command::new("yt-dlp");
    command
        .arg(rewrite_mirror_url(url))
        .arg("--verbose")
        .arg("-o")
        .arg(output_path)
        .arg("-f")
        .arg("bestvideo+bestaudio/best")
        .arg("--merge-output-format")
        .arg("mkv")
        .arg("--windows-filenames")
        .arg("--no-playlist")
        .arg("--progress")
        .arg("--newline")
        .arg("--print")
        .arg("after_move:filepath")
        .current_dir(&output_dir);

    let cookies_path = add_cookies_argument(&mut command, cookies_data)
        .map_err(|e| DownloadOutcome {
            message: e,
            file_path: None,
            stdout: String::new(),
            stderr: String::new(),
        })?;

    // Mimic a real Chrome fingerprint for every download. Needed for
    // Cloudflare-challenged hosts (tiktok.com and other generic-extractor
    // sites); harmless elsewhere.
    command.arg("--impersonate").arg("chrome");
    
    // Hide CMD window on Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    
    let output = command
        .output()
        .map_err(|e| DownloadOutcome {
            message: match &cookies_path {
                Some(path) => format!("Failed to execute yt-dlp: {} (cookies: {})", e, path.display()),
                None => format!("Failed to execute yt-dlp: {}", e),
            },
            file_path: None,
            stdout: String::new(),
            stderr: String::new(),
        })?;

    cleanup_temp_cookies_file(&cookies_path);
    
    let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();
    let file_path = extract_downloaded_path(&stdout_text, &stderr_text);

    if output.status.success() {
        if let Some(file_path) = file_path {
            Ok(DownloadOutcome {
                message: "Download complete".to_string(),
                file_path: Some(file_path),
                stdout: stdout_text,
                stderr: stderr_text,
            })
        } else {
            Err(DownloadOutcome {
                message: "yt-dlp did not return a file path".to_string(),
                file_path: None,
                stdout: stdout_text,
                stderr: stderr_text,
            })
        }
    } else {
        let combined = combine_ytdlp_output(&stdout_text, &stderr_text);

        Err(DownloadOutcome {
            message: ytdlp_failure_message(&combined, output.status.code()),
            file_path: None,
            stdout: stdout_text,
            stderr: stderr_text,
        })
    }
}

// Classify a failed test download from its stderr: a 403 gets a fixed
// message, an ffmpeg failure names its first stderr line, anything else
// reports its first stderr line.
// (Only called by test_download, which is itself currently unused.)
#[allow(dead_code)]
fn classify_test_download_error(stderr_text: &str) -> String {
    let stderr_lower = stderr_text.to_lowercase();
    if stderr_lower.contains("http error 403") {
        "yt-dlp failed: HTTP Error 403 Forbidden".to_string()
    } else if stderr_lower.contains("ffmpeg") {
        format!(
            "yt-dlp failed (ffmpeg error): {}",
            stderr_text.lines().next().unwrap_or("see stderr")
        )
    } else {
        format!(
            "yt-dlp failed: {}",
            stderr_text.lines().next().unwrap_or(stderr_text)
        )
    }
}

// Test download with detailed output (for GUI)
fn test_download(url: String, output_path: String, hide_window: bool) -> Result<serde_json::Value, String> {
    eprintln!("[yt-dlp] Starting download: {}", url);
    eprintln!("[yt-dlp] Output path: {}", output_path);
    eprintln!("[yt-dlp] Hide window: {}", hide_window);
    
    let mut command = Command::new("yt-dlp");
    command
        .arg(&url)
        .arg("-f")
        .arg("bestvideo+bestaudio/best")
        .arg("--merge-output-format")
        .arg("mkv")
        .arg("-o")
        .arg(&output_path)
        .arg("--no-playlist")
        .arg("--progress")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let cookies_path = add_cookies_argument(&mut command, None)?;
    match &cookies_path {
        Some(path) => eprintln!("[yt-dlp] Using cookies: {}", path.display()),
        None => eprintln!("[yt-dlp] cookies.txt not found next to native host executable"),
    }
    
    // Hide CMD window on Windows if requested
    #[cfg(target_os = "windows")]
    if hide_window {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    
    let output = command
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}. Make sure yt-dlp is in the same folder or in PATH", e))?;

    let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();

    for line in stdout_text.lines() {
        eprintln!("[yt-dlp][stdout] {}", line);
    }

    for line in stderr_text.lines() {
        eprintln!("[yt-dlp][stderr] {}", line);
    }
    
    if output.status.success() {
        eprintln!("[yt-dlp] ✅ Download completed successfully");
        Ok(serde_json::json!({
            "success": true,
            "filePath": output_path,
            "stdout": stdout_text,
            "stderr": stderr_text
        }))
    } else {
        eprintln!("[yt-dlp] Download failed with exit code: {:?}", output.status.code());
        let detail = classify_test_download_error(&stderr_text);
        Err(serde_json::json!({
            "message": detail,
            "stdout": stdout_text,
            "stderr": stderr_text
        }).to_string())
    }
}

fn find_yt_dlp() -> Result<String, String> {
    let mut command = Command::new("yt-dlp");
    command.arg("--version");

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if version.is_empty() {
            "yt-dlp is available".to_string()
        } else {
            format!("yt-dlp version: {}", version)
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("yt-dlp returned exit code {:?}", output.status.code())
        } else {
            stderr
        })
    }
}

fn download_video_with_progress(
    url: &str,
    output_path: &str,
    cookies_data: Option<&[BrowserCookie]>,
    request_id: Option<&str>,
    stdout: &mut io::Stdout,
    format_override: Option<&str>,
    attempt: u32,
) -> Result<DownloadOutcome, DownloadOutcome> {
    let output_dir = get_output_directory(output_path)
        .map_err(|message| DownloadOutcome {
            message,
            file_path: None,
            stdout: String::new(),
            stderr: String::new(),
        })?;

    if !output_dir.exists() {
        fs::create_dir_all(&output_dir)
            .map_err(|e| DownloadOutcome {
                message: format!("Failed to create download directory {}: {}", output_dir.display(), e),
                file_path: None,
                stdout: String::new(),
                stderr: String::new(),
            })?;
    }

    let format = format_override.unwrap_or("bestvideo+bestaudio/best");
    let mut command = Command::new("yt-dlp");
    command
        .arg(rewrite_mirror_url(url))
        .arg("--verbose")
        .arg("-o")
        .arg(output_path)
        .arg("-f")
        .arg(format)
        .arg("--merge-output-format")
        .arg("mkv")
        .arg("--windows-filenames")
        .arg("--no-playlist")
        .arg("--progress")
        .arg("--newline")
        .arg("--print")
        .arg("after_move:filepath")
        .current_dir(&output_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Mimic a real Chrome fingerprint for every download. Needed for
    // Cloudflare-challenged hosts (tiktok.com and other generic-extractor
    // sites); harmless elsewhere.
    command.arg("--impersonate").arg("chrome");

    let cookies_path = add_cookies_argument(&mut command, cookies_data)
        .map_err(|e| DownloadOutcome {
            message: e,
            file_path: None,
            stdout: String::new(),
            stderr: String::new(),
        })?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|e| DownloadOutcome {
        message: match &cookies_path {
            Some(path) => format!("Failed to execute yt-dlp: {} (cookies: {})", e, path.display()),
            None => format!("Failed to execute yt-dlp: {}", e),
        },
        file_path: None,
        stdout: String::new(),
        stderr: String::new(),
    })?;

    if let Some(active_request_id) = request_id {
        if let Err(error) = write_request_pid(active_request_id, child.id()) {
            eprintln!("[NATIVE] Failed to persist request pid: {}", error);
        }
    }

    let stdout_pipe = child.stdout.take().ok_or_else(|| DownloadOutcome {
        message: "Failed to capture yt-dlp stdout".to_string(),
        file_path: None,
        stdout: String::new(),
        stderr: String::new(),
    })?;
    let stderr_pipe = child.stderr.take().ok_or_else(|| DownloadOutcome {
        message: "Failed to capture yt-dlp stderr".to_string(),
        file_path: None,
        stdout: String::new(),
        stderr: String::new(),
    })?;

    let (tx, rx) = mpsc::channel::<(String, String)>();

    let stdout_tx = tx.clone();
    let stdout_handle = std::thread::spawn(move || {
        let mut collected = Vec::new();
        let mut reader = BufReader::new(stdout_pipe);
        let mut buffer = Vec::new();

        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buffer)
                        .trim_end_matches(['\r', '\n'])
                        .to_string();
                    if !line.trim().is_empty() {
                        let _ = stdout_tx.send(("stdout".to_string(), line.clone()));
                    }
                    collected.push(line);
                }
                Err(error) => {
                    collected.push(format!("[ImgVault] Failed to read yt-dlp stdout: {}", error));
                    break;
                }
            }
        }

        collected.join("\n")
    });

    let stderr_handle = std::thread::spawn(move || {
        let mut collected = Vec::new();
        let mut reader = BufReader::new(stderr_pipe);
        let mut buffer = Vec::new();

        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buffer)
                        .trim_end_matches(['\r', '\n'])
                        .to_string();
                    if !line.trim().is_empty() {
                        let _ = tx.send(("stderr".to_string(), line.clone()));
                    }
                    collected.push(line);
                }
                Err(error) => {
                    collected.push(format!("[ImgVault] Failed to read yt-dlp stderr: {}", error));
                    break;
                }
            }
        }

        collected.join("\n")
    });

    while let Ok((stream, line)) = rx.recv() {
        let progress_response = NativeResponse {
            success: true,
            event: Some("progress".to_string()),
            request_id: request_id.map(|value| value.to_string()),
            message: None,
            line: Some(line),
            stream: Some(stream),
            file_path: None,
            stdout: None,
            stderr: None,
        };

        if let Err(error) = send_native_response(stdout, &progress_response) {
            eprintln!("[NATIVE] Failed to send progress update: {}", error);
        }
    }

    let status = child.wait().map_err(|e| DownloadOutcome {
        message: format!("Failed while waiting for yt-dlp: {}", e),
        file_path: None,
        stdout: String::new(),
        stderr: String::new(),
    })?;

    if let Some(active_request_id) = request_id {
        remove_request_pid(active_request_id);
    }

    cleanup_temp_cookies_file(&cookies_path);

    let mut stdout_text = stdout_handle.join().unwrap_or_else(|_| String::new());
    let mut stderr_text = stderr_handle.join().unwrap_or_else(|_| String::new());

    // If the user requested a stop, the child was killed via taskkill. The
    // stdout/stderr buffers can be hundreds of KB (progress spam) and the
    // final native message would exceed Chrome's 1 MB limit, which surfaces
    // as "Error when communicating with the native messaging host." Treat
    // this as a graceful cancellation with a small, clear message instead of
    // dumping the full yt-dlp log back over the wire.
    let is_user_cancelled = request_id.map(|id| has_cancel_flag(id)).unwrap_or(false);
    if is_user_cancelled {
        if let Some(active_request_id) = request_id {
            remove_cancel_flag(active_request_id);
            remove_request_pid(active_request_id);
        }
        // Keep only a tiny tail for diagnostics; the full log is already streamed as progress
        stdout_text = truncate_for_native_message(&stdout_text, 8000);
        stderr_text = truncate_for_native_message(&stderr_text, 8000);
        return Err(DownloadOutcome {
            message: "Download stopped by user".to_string(),
            file_path: None,
            stdout: stdout_text,
            stderr: stderr_text,
        });
    }

    // Extract the final path from the FULL streams BEFORE truncating. The
    // `--print after_move:filepath` line is the last thing yt-dlp writes, so a
    // head-truncate to 40 KB (needed for Chrome's 1 MB native-message cap) cuts
    // it off and produced a false "did not return a file path" after the
    // download had already finished.
    let file_path = extract_downloaded_path(&stdout_text, &stderr_text);

    // Truncate final payloads to stay safely under Chrome's 1 MB native
    // message cap (JSON envelope + both streams). 40 KB each is plenty for
    // diagnostics and avoids the silent disconnect.
    stdout_text = truncate_for_native_message(&stdout_text, 40_000);
    stderr_text = truncate_for_native_message(&stderr_text, 40_000);

    if status.success() {
        if let Some(file_path) = file_path {
            Ok(DownloadOutcome {
                message: "Download complete".to_string(),
                file_path: Some(file_path),
                stdout: stdout_text,
                stderr: stderr_text,
            })
        } else {
            Err(DownloadOutcome {
                message: "yt-dlp did not return a file path".to_string(),
                file_path: None,
                stdout: stdout_text,
                stderr: stderr_text,
            })
        }
    } else {
        let combined = combine_ytdlp_output(&stdout_text, &stderr_text);

        let lower_combined = combined.to_lowercase();
        let retry_short_title = should_retry_with_short_title(output_path, &lower_combined);

        if retry_short_title {
            let fallback_output_path = output_path.replace("%(title)s", "%(title).180B");
            let notice = NativeResponse {
                success: true,
                event: Some("progress".to_string()),
                request_id: request_id.map(|value| value.to_string()),
                message: None,
                line: Some(format!(
                    "[ImgVault] Retrying with shortened title template: {}",
                    fallback_output_path
                )),
                stream: Some("stderr".to_string()),
                file_path: None,
                stdout: None,
                stderr: None,
            };

            if let Err(error) = send_native_response(stdout, &notice) {
                eprintln!("[NATIVE] Failed to send retry notice: {}", error);
            }

            return download_video_with_progress(
                url,
                &fallback_output_path,
                cookies_data,
                request_id,
                stdout,
                None,
                attempt,
            );
        }

        let retry_extraction = should_retry_extraction(attempt, &lower_combined);

        if retry_extraction {
            let notice = NativeResponse {
                success: true,
                event: Some("progress".to_string()),
                request_id: request_id.map(|value| value.to_string()),
                message: None,
                line: Some(format!(
                    "[ImgVault] Site returned an unreadable page. Retrying (attempt {} of 3)",
                    attempt + 2
                )),
                stream: Some("stderr".to_string()),
                file_path: None,
                stdout: None,
                stderr: None,
            };

            if let Err(error) = send_native_response(stdout, &notice) {
                eprintln!("[NATIVE] Failed to send extraction retry notice: {}", error);
            }

            std::thread::sleep(std::time::Duration::from_millis(2500));

            return download_video_with_progress(
                url,
                output_path,
                cookies_data,
                request_id,
                stdout,
                format_override,
                attempt + 1,
            );
        }

        Err(DownloadOutcome {
            message: ytdlp_failure_message(&combined, status.code()),
            file_path: None,
            stdout: stdout_text,
            stderr: stderr_text,
        })
    }
}

#[cfg(target_os = "windows")]
fn to_wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn show_message_box(title: &str, message: &str, is_error: bool) {
    let title_w = to_wide_null(title);
    let message_w = to_wide_null(message);
    let flags = MB_OK | if is_error { MB_ICONERROR } else { MB_ICONINFORMATION };

    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message_w.as_ptr(),
            title_w.as_ptr(),
            flags,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn show_message_box(_title: &str, _message: &str, _is_error: bool) {}

// Handle native messaging (stdin/stdout communication)
fn handle_native_messaging() {
    #[cfg(target_os = "windows")]
    {
        if let Err(e) = reload_windows_path_environment() {
            eprintln!("[NATIVE] Failed to reload PATH on native startup: {}", e);
        } else {
            eprintln!("[NATIVE] Reloaded PATH on native startup");
        }
    }

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    
    loop {
        // Read message length (4 bytes, little-endian)
        let mut length_bytes = [0u8; 4];
        if stdin.lock().read_exact(&mut length_bytes).is_err() {
            break;
        }
        let message_length = u32::from_ne_bytes(length_bytes) as usize;
        
        // Read message content
        let mut message_buffer = vec![0u8; message_length];
        if stdin.lock().read_exact(&mut message_buffer).is_err() {
            break;
        }
        
        // Parse JSON message
        let msg = match String::from_utf8(message_buffer) {
            Ok(s) => s,
            Err(_) => continue,
        };
        
        eprintln!("[NATIVE] Received message: {}", msg);
        
        // Parse the message
        let response = match serde_json::from_str::<NativeMessage>(&msg) {
            Ok(native_msg) => {
                match native_msg.action.as_str() {
                    "video_normalize_start" => {
                        let request_id = native_msg.request_id.clone().unwrap_or_default();
                        match video_normalize_start(&request_id) {
                            Ok(()) => NativeResponse { success: true, event: Some("complete".to_string()), request_id: Some(request_id), message: Some("Native video session started".to_string()), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                            Err(error) => NativeResponse { success: false, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(error), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                        }
                    }
                    "video_normalize_chunk" => {
                        let request_id = native_msg.request_id.clone().unwrap_or_default();
                        match native_msg.data.as_deref().ok_or_else(|| "Missing video chunk data".to_string()).and_then(|data| video_normalize_chunk(&request_id, data)) {
                            Ok(()) => NativeResponse { success: true, event: Some("complete".to_string()), request_id: Some(request_id), message: Some("chunk accepted".to_string()), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                            Err(error) => NativeResponse { success: false, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(error), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                        }
                    }
                    "video_normalize_finish" => {
                        let request_id = native_msg.request_id.clone().unwrap_or_default();
                        match video_normalize_finish(&request_id) {
                            Ok(size) => NativeResponse { success: true, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(size.to_string()), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                            Err(error) => NativeResponse { success: false, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(error), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                        }
                    }
                    "video_normalize_read" => {
                        let request_id = native_msg.request_id.clone().unwrap_or_default();
                        match video_normalize_read(&request_id, native_msg.offset.unwrap_or(0), native_msg.max_bytes.unwrap_or(700 * 1024)) {
                            Ok((data, offset, done)) => NativeResponse { success: true, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(format!("{}:{}", offset, done)), line: None, stream: None, file_path: None, stdout: Some(data), stderr: None },
                            Err(error) => NativeResponse { success: false, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(error), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                        }
                    }
                    "video_normalize_cleanup" => {
                        if let Some(request_id) = native_msg.request_id.as_deref() { video_normalize_cleanup(request_id); }
                        NativeResponse { success: true, event: Some("complete".to_string()), request_id: native_msg.request_id.clone(), message: Some("Native video session cleaned up".to_string()), line: None, stream: None, file_path: None, stdout: None, stderr: None }
                    }
                    "file_write_start" => {
                        let request_id = native_msg.request_id.clone().unwrap_or_default();
                        let output_path = native_msg.output_path.clone().unwrap_or_default();
                        let file_name = native_msg.file_name.clone().unwrap_or_default();
                        match file_write_start(&request_id, &output_path, &file_name) {
                            Ok(path) => NativeResponse { success: true, event: Some("complete".to_string()), request_id: Some(request_id), message: Some("Native file session started".to_string()), line: None, stream: None, file_path: Some(path.display().to_string()), stdout: None, stderr: None },
                            Err(error) => NativeResponse { success: false, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(error), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                        }
                    }
                    "file_delete" => {
                        let request_id = native_msg.request_id.clone().unwrap_or_default();
                        match native_msg.file_path.as_deref().ok_or_else(|| "Missing file_path for file_delete".to_string()).and_then(delete_staged_file) {
                            Ok(deleted) => NativeResponse { success: true, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(if deleted { "deleted".to_string() } else { "already gone".to_string() }), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                            Err(error) => NativeResponse { success: false, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(error), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                        }
                    }
                    "file_write_chunk" => {
                        let request_id = native_msg.request_id.clone().unwrap_or_default();
                        match native_msg.data.as_deref().ok_or_else(|| "Missing file chunk data".to_string()).and_then(|data| file_write_chunk(&request_id, data)) {
                            Ok(()) => NativeResponse { success: true, event: Some("complete".to_string()), request_id: Some(request_id), message: Some("chunk accepted".to_string()), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                            Err(error) => NativeResponse { success: false, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(error), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                        }
                    }
                    "file_write_finish" => {
                        let request_id = native_msg.request_id.clone().unwrap_or_default();
                        match file_write_finish(&request_id) {
                            Ok((path, size)) => NativeResponse { success: true, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(size.to_string()), line: None, stream: None, file_path: Some(path), stdout: None, stderr: None },
                            Err(error) => NativeResponse { success: false, event: Some("complete".to_string()), request_id: Some(request_id), message: Some(error), line: None, stream: None, file_path: None, stdout: None, stderr: None },
                        }
                    }
                    "download" => {
                        let NativeMessage { url, output_path, cookies_data, request_id, format, .. } = native_msg;
                        if let (Some(url), Some(output_path)) = 
                            (url, output_path) 
                        {
                            eprintln!("[NATIVE] Processing download: {} -> {}", url, output_path);
                            match download_video_with_progress(&url, &output_path, cookies_data.as_deref(), request_id.as_deref(), &mut stdout, format.as_deref(), 0) {
                                Ok(file_path) => {
                                    if let Some(active_request_id) = request_id.as_deref() {
                                        if let Err(error) = write_download_journal(
                                            active_request_id,
                                            "completed",
                                            file_path.file_path.as_deref(),
                                            Some(&file_path.message),
                                            Some(&file_path.stdout),
                                            Some(&file_path.stderr),
                                        ) {
                                            eprintln!("[NATIVE] Failed to persist download journal: {}", error);
                                        }
                                    }
                                    eprintln!("[NATIVE] Download successful: {}", file_path.file_path.as_deref().unwrap_or(""));
                                    NativeResponse {
                                        success: true,
                                        event: Some("complete".to_string()),
                                        request_id,
                                        message: Some(file_path.message),
                                        line: None,
                                        stream: None,
                                        file_path: file_path.file_path,
                                        stdout: Some(file_path.stdout),
                                        stderr: Some(file_path.stderr),
                                    }
                                },
                                Err(e) => {
                                    if let Some(active_request_id) = request_id.as_deref() {
                                        if let Err(error) = write_download_journal(
                                            active_request_id,
                                            "failed",
                                            None,
                                            Some(&e.message),
                                            Some(&e.stdout),
                                            Some(&e.stderr),
                                        ) {
                                            eprintln!("[NATIVE] Failed to persist download journal: {}", error);
                                        }
                                    }
                                    eprintln!("[NATIVE] Download failed: {}", e.message);
                                    NativeResponse {
                                        success: false,
                                        event: Some("complete".to_string()),
                                        request_id,
                                        message: Some(e.message),
                                        line: None,
                                        stream: None,
                                        file_path: None,
                                        stdout: Some(e.stdout),
                                        stderr: Some(e.stderr),
                                    }
                                },
                            }
                        } else {
                            eprintln!("[NATIVE] Missing url or output_path");
                            NativeResponse {
                                success: false,
                                event: Some("complete".to_string()),
                                request_id,
                                message: Some("Missing url or output_path".to_string()),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            }
                        }
                    }
                    "reload_path" => {
                        match reload_path() {
                            Ok(_) => NativeResponse {
                                success: true,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some("PATH reloaded".to_string()),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                            Err(e) => NativeResponse {
                                success: false,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some(e),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    "ping" => NativeResponse {
                        success: true,
                        event: Some("complete".to_string()),
                        request_id: native_msg.request_id.clone(),
                        message: Some("Native host reachable".to_string()),
                        line: None,
                        stream: None,
                        file_path: None,
                        stdout: None,
                        stderr: None,
                    },
                    "read_download_journal" => {
                        match native_msg.request_id.as_deref().and_then(read_download_journal) {
                            Some(journal) => NativeResponse {
                                success: true,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some(
                                    journal
                                        .get("status")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown")
                                        .to_string(),
                                ),
                                line: None,
                                stream: None,
                                file_path: journal
                                    .get("file_path")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                stdout: Some(serde_json::to_string(&journal).unwrap_or_else(|_| "{}".to_string())),
                                stderr: None,
                            },
                            None => NativeResponse {
                                success: true,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some("missing".to_string()),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    "delete_download_journal" => {
                        if let Some(active_request_id) = native_msg.request_id.as_deref() {
                            remove_download_journal(active_request_id);
                            remove_request_pid(active_request_id);
                            remove_cancel_flag(active_request_id);
                        }
                        NativeResponse {
                            success: true,
                            event: Some("complete".to_string()),
                            request_id: native_msg.request_id.clone(),
                            message: Some("Download journal cleaned up".to_string()),
                            line: None,
                            stream: None,
                            file_path: None,
                            stdout: None,
                            stderr: None,
                        }
                    }
                    "read_upload_journal" => {
                        match native_msg.request_id.as_deref().and_then(read_upload_journal) {
                            Some(journal) => NativeResponse {
                                success: true,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some(
                                    journal
                                        .get("status")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown")
                                        .to_string(),
                                ),
                                line: None,
                                stream: None,
                                file_path: journal
                                    .get("file_path")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                stdout: Some(serde_json::to_string(&journal).unwrap_or_else(|_| "{}".to_string())),
                                stderr: None,
                            },
                            None => NativeResponse {
                                success: true,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some("missing".to_string()),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    "delete_upload_journal" => {
                        if let Some(active_request_id) = native_msg.request_id.as_deref() {
                            remove_upload_journal(active_request_id);
                        }
                        NativeResponse {
                            success: true,
                            event: Some("complete".to_string()),
                            request_id: native_msg.request_id.clone(),
                            message: Some("Upload journal cleaned up".to_string()),
                            line: None,
                            stream: None,
                            file_path: None,
                            stdout: None,
                            stderr: None,
                        }
                    }
                    "check_yt_dlp" => {
                        match find_yt_dlp() {
                            Ok(message) => NativeResponse {
                                success: true,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some(message),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                            Err(e) => NativeResponse {
                                success: false,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some(e),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    "check_cookies" => {
                        match check_cookies() {
                            Ok(message) => NativeResponse {
                                success: true,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some(message),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                            Err(e) => NativeResponse {
                                success: false,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some(e),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    "cancel_download" => {
                        match native_msg.request_id.as_deref() {
                            Some(request_id) => match cancel_download_request(request_id) {
                                Ok(message) => NativeResponse {
                                    success: true,
                                    event: Some("complete".to_string()),
                                    request_id: Some(request_id.to_string()),
                                    message: Some(message),
                                    line: None,
                                    stream: None,
                                    file_path: None,
                                    stdout: None,
                                    stderr: None,
                                },
                                Err(e) => NativeResponse {
                                    success: false,
                                    event: Some("complete".to_string()),
                                    request_id: Some(request_id.to_string()),
                                    message: Some(e),
                                    line: None,
                                    stream: None,
                                    file_path: None,
                                    stdout: None,
                                    stderr: None,
                                },
                            },
                            None => NativeResponse {
                                success: false,
                                event: Some("complete".to_string()),
                                request_id: None,
                                message: Some("Missing request_id for cancel_download".to_string()),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    "telegram_upload" => {
                        match (native_msg.file_path.as_deref(), native_msg.channel.as_deref()) {
                            (Some(fp), Some(ch)) => {
                                handle_telegram_upload(
                                    &mut stdout,
                                    native_msg.request_id.as_deref(),
                                    fp,
                                    ch,
                                    native_msg.caption.as_deref(),
                                    native_msg.session_path.as_deref(),
                                    native_msg.api_id.as_deref(),
                                    native_msg.api_hash.as_deref(),
                                )
                            }
                            _ => NativeResponse {
                                success: false,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some("Missing file_path or channel for telegram_upload".to_string()),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    "telegram_verify" => {
                        match (native_msg.message_id.as_deref(), native_msg.channel.as_deref()) {
                            (Some(mid), Some(ch)) => {
                                handle_telegram_verify(
                                    native_msg.request_id.as_deref(),
                                    mid,
                                    ch,
                                    native_msg.session_path.as_deref(),
                                    native_msg.api_id.as_deref(),
                                    native_msg.api_hash.as_deref(),
                                )
                            }
                            _ => NativeResponse {
                                success: false,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some("Missing message_id or channel for telegram_verify".to_string()),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    "telegram_download" => {
                        match (native_msg.message_id.as_deref(), native_msg.channel.as_deref()) {
                            (Some(mid), Some(ch)) => {
                                handle_telegram_download(
                                    &mut stdout,
                                    native_msg.request_id.as_deref(),
                                    mid,
                                    ch,
                                    native_msg.offset.unwrap_or(0),
                                    native_msg.max_bytes.unwrap_or(0) as u64,
                                    native_msg.session_path.as_deref(),
                                    native_msg.api_id.as_deref(),
                                    native_msg.api_hash.as_deref(),
                                )
                            }
                            _ => NativeResponse {
                                success: false,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some("Missing message_id or channel for telegram_download".to_string()),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    "get_default_video_directory" => {
                        match get_default_videos_directory() {
                            Ok(path) => NativeResponse {
                                success: true,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some(path.display().to_string()),
                                line: None,
                                stream: None,
                                file_path: Some(path.display().to_string()),
                                stdout: None,
                                stderr: None,
                            },
                            Err(e) => NativeResponse {
                                success: false,
                                event: Some("complete".to_string()),
                                request_id: native_msg.request_id.clone(),
                                message: Some(e),
                                line: None,
                                stream: None,
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    _ => {
                        eprintln!("[NATIVE] Unknown action: {}", native_msg.action);
                        NativeResponse {
                            success: false,
                            event: Some("complete".to_string()),
                            request_id: native_msg.request_id.clone(),
                            message: Some("Unknown action".to_string()),
                            line: None,
                            stream: None,
                            file_path: None,
                            stdout: None,
                            stderr: None,
                        }
                    },
                }
            }
            Err(e) => {
                eprintln!("[NATIVE] Failed to parse message: {}", e);
                NativeResponse {
                    success: false,
                    event: Some("complete".to_string()),
                    request_id: None,
                    message: Some(format!("Failed to parse message: {}", e)),
                    line: None,
                    stream: None,
                    file_path: None,
                    stdout: None,
                    stderr: None,
                }
            }
        };
        
        let response_json = serde_json::to_string(&response).unwrap_or_default();
        eprintln!("[NATIVE] Sending response: {}", response_json);

        if let Err(error) = send_native_response(&mut stdout, &response) {
            eprintln!("[NATIVE] {}", error);
            break;
        }
        
        eprintln!("[NATIVE] Response sent successfully");
    }
    
    eprintln!("[NATIVE] Native messaging loop ended");
}

fn main() {
    // Check if running in native mode (headless)
    let args: Vec<String> = env::args().collect();
    
    // If --native flag is passed, run in headless mode
    if args.contains(&"--native".to_string()) {
        handle_native_messaging();
        return;
    }
    
    // Try to detect if launched by Chrome
    // Chrome launches with stdin as a pipe for native messaging
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::io::AsRawHandle;
        use std::io::stdin;
        
        let handle = stdin().as_raw_handle();
        unsafe {
            use winapi::um::fileapi::GetFileType;
            use winapi::um::winbase::FILE_TYPE_PIPE;
            
            // If stdin is a pipe, we're in native messaging mode
            if GetFileType(handle as _) == FILE_TYPE_PIPE {
                handle_native_messaging();
                return;
            }
        }
    }

    match register_host(EXTENSION_ID.to_string()) {
        Ok(()) => {
            let message = format!(
                "ImgVault Native Host is registered.\n\nYou can close this window and use the extension now.\n\nExtension ID: {}",
                EXTENSION_ID
            );
            show_message_box("ImgVault Native Host", &message, false);
        }
        Err(error) => {
            let message = format!("Failed to register ImgVault Native Host.\n\n{}", error);
            show_message_box("ImgVault Native Host", &message, true);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    // Unique per test so parallel test threads never share a temp file.
    fn unique_request_id(tag: &str) -> String {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        format!("test-{}-{}-{}", std::process::id(), tag, n)
    }

    fn unique_temp_dir(prefix: &str, tag: &str) -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = env::temp_dir().join(format!("{}-{}-{}-{}", prefix, std::process::id(), tag, n));
        fs::create_dir_all(&dir).expect("create unique temp dir");
        dir
    }

    // Best-effort cleanup of files/dirs a test created, even if an assert fails.
    struct TestCleanup {
        paths: Vec<PathBuf>,
    }

    impl TestCleanup {
        fn new() -> Self {
            Self { paths: Vec::new() }
        }

        fn track(&mut self, path: PathBuf) {
            self.paths.push(path);
        }
    }

    impl Drop for TestCleanup {
        fn drop(&mut self) {
            for path in &self.paths {
                if path.is_dir() {
                    let _ = fs::remove_dir_all(path);
                } else {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }

    // ---- sanitizers ---------------------------------------------------------

    #[test]
    fn sanitize_request_id_keeps_safe_chars() {
        assert_eq!(sanitize_request_id("abc-123_XYZ"), "abc-123_XYZ");
    }

    #[test]
    fn sanitize_request_id_replaces_unsafe_chars() {
        assert_eq!(sanitize_request_id("a/b\\c:d e.f"), "a_b_c_d_e_f");
        assert_eq!(sanitize_request_id(".."), "__");
        assert_eq!(sanitize_request_id("héllo"), "h_llo");
    }

    #[test]
    fn sanitize_request_id_empty_stays_empty() {
        assert_eq!(sanitize_request_id(""), "");
    }

    #[test]
    fn sanitize_stage_file_name_keeps_plain_name() {
        assert_eq!(sanitize_stage_file_name("clip.mp4"), "clip.mp4");
        assert_eq!(sanitize_stage_file_name("my video (1).mkv"), "my video (1).mkv");
    }

    #[test]
    fn sanitize_stage_file_name_strips_separators_and_traversal() {
        assert_eq!(sanitize_stage_file_name("../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_stage_file_name("..\\..\\evil.mp4"), "evil.mp4");
        assert_eq!(sanitize_stage_file_name("sub/dir/file.mp4"), "subdirfile.mp4");
    }

    #[test]
    fn sanitize_stage_file_name_strips_windows_reserved_chars() {
        assert_eq!(sanitize_stage_file_name("a:b*c?d\"e<f>g|h"), "abcdefgh");
        assert_eq!(sanitize_stage_file_name("nul\0byte"), "nulbyte");
    }

    #[test]
    fn sanitize_stage_file_name_dots_only_becomes_file() {
        assert_eq!(sanitize_stage_file_name("..."), "file");
        assert_eq!(sanitize_stage_file_name(""), "file");
        assert_eq!(sanitize_stage_file_name("   "), "file");
        assert_eq!(sanitize_stage_file_name(".../..."), "file");
    }

    #[test]
    fn sanitize_stage_file_name_trims_dots_and_spaces() {
        assert_eq!(sanitize_stage_file_name(".hidden."), "hidden");
        assert_eq!(sanitize_stage_file_name("  clip.mp4  "), "clip.mp4");
    }

    #[test]
    fn sanitize_stage_file_name_truncates_to_120_chars() {
        let long = "a".repeat(200);
        let clean = sanitize_stage_file_name(&long);
        assert_eq!(clean.len(), 120);
        assert_eq!(clean, "a".repeat(120));
    }

    // ---- staging path resolution --------------------------------------------

    #[test]
    fn resolve_file_write_target_empty_path_stages_under_temp() {
        let target = resolve_file_write_target("req-1", "", "clip.mp4");
        assert_eq!(
            target,
            env::temp_dir()
                .join("imgvault-tg-stage")
                .join("req-1")
                .join("clip.mp4")
        );
    }

    #[test]
    fn resolve_file_write_target_whitespace_only_path_stages() {
        let target = resolve_file_write_target("req-1", "   ", "clip.mp4");
        assert_eq!(
            target,
            env::temp_dir()
                .join("imgvault-tg-stage")
                .join("req-1")
                .join("clip.mp4")
        );
    }

    #[test]
    fn resolve_file_write_target_relative_path_stages() {
        let target = resolve_file_write_target("req-1", "sub/dir/file.mp4", "picked.mp4");
        assert_eq!(
            target,
            env::temp_dir()
                .join("imgvault-tg-stage")
                .join("req-1")
                .join("picked.mp4")
        );
    }

    #[test]
    fn resolve_file_write_target_absolute_path_passes_through() {
        let absolute = env::temp_dir().join("imgvault-test-abs").join("clip.m4a");
        let target = resolve_file_write_target("req-1", absolute.to_str().unwrap(), "clip.m4a");
        assert_eq!(target, absolute);
    }

    #[test]
    fn resolve_file_write_target_trims_surrounding_whitespace() {
        let absolute = env::temp_dir().join("imgvault-test-abs").join("clip.m4a");
        let padded = format!("  {}  ", absolute.display());
        let target = resolve_file_write_target("req-1", &padded, "clip.m4a");
        assert_eq!(target, absolute);
    }

    #[test]
    fn resolve_file_write_target_traversal_cannot_escape_staging_dir() {
        let staging_root = env::temp_dir().join("imgvault-tg-stage");
        let target = resolve_file_write_target("../../etc", "../../../evil.mp4", "../../../evil.mp4");
        assert!(target.starts_with(&staging_root), "escaped staging dir: {}", target.display());
        assert!(
            !target.components().any(|c| matches!(c, std::path::Component::ParentDir)),
            "target still carries ..: {}",
            target.display()
        );
        // And the crafted names land as harmless flat names, not nested paths.
        assert_eq!(target.file_name().unwrap().to_str().unwrap(), "evil.mp4");
    }

    #[test]
    fn resolve_file_write_target_empty_file_name_becomes_file() {
        let target = resolve_file_write_target("req-1", "", "");
        assert_eq!(
            target,
            env::temp_dir()
                .join("imgvault-tg-stage")
                .join("req-1")
                .join("file")
        );
    }

    // The Suno flow hands the host a Windows absolute path; on Windows that
    // must pass through untouched. (Linux treats `C:\...` as relative, so
    // this case only runs where the path semantics apply.)
    #[cfg(target_os = "windows")]
    #[test]
    fn resolve_file_write_target_windows_absolute_path_passes_through() {
        let target = resolve_file_write_target("req-1", r"C:\Users\Admin\Videos\clip.m4a", "clip.m4a");
        assert_eq!(target, PathBuf::from(r"C:\Users\Admin\Videos\clip.m4a"));
    }

    // ---- file_delete guard --------------------------------------------------

    #[test]
    fn is_deletable_staged_file_accepts_marked_temp_path() {
        let path = env::temp_dir().join("imgvault-foo").join("bar.txt");
        assert!(is_deletable_staged_file(&path));
    }

    #[test]
    fn is_deletable_staged_file_accepts_marker_in_dir_name() {
        // The marker is checked against the whole display string, so a file
        // inside an imgvault- session dir is deletable even when the file
        // name itself carries no marker.
        let path = env::temp_dir().join("imgvault-tg-stage").join("req-1").join("clip.mp4");
        assert!(is_deletable_staged_file(&path));
    }

    #[test]
    fn is_deletable_staged_file_refuses_non_temp_path() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("imgvault-foo.txt");
        assert!(!is_deletable_staged_file(&path));
    }

    #[test]
    fn is_deletable_staged_file_refuses_temp_path_without_marker() {
        let path = env::temp_dir().join("plain-dir").join("file.txt");
        assert!(!is_deletable_staged_file(&path));
    }

    #[test]
    fn delete_staged_file_removes_file_and_reports_true_then_false() {
        let mut cleanup = TestCleanup::new();
        let dir = unique_temp_dir("imgvault-test", "delete");
        cleanup.track(dir.clone());
        let file = dir.join("staged.mp4");
        fs::write(&file, b"bytes").unwrap();

        assert_eq!(delete_staged_file(file.to_str().unwrap()), Ok(true));
        assert!(!file.exists());
        // Already gone is success, not an error.
        assert_eq!(delete_staged_file(file.to_str().unwrap()), Ok(false));
    }

    #[test]
    fn delete_staged_file_missing_file_is_success() {
        let path = env::temp_dir()
            .join("imgvault-test-never-created")
            .join("ghost.mp4");
        assert_eq!(delete_staged_file(path.to_str().unwrap()), Ok(false));
    }

    #[test]
    fn delete_staged_file_refuses_non_temp_and_keeps_file() {
        let mut cleanup = TestCleanup::new();
        let file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("imgvault-guard-test-{}-{}.txt", std::process::id(), TEST_COUNTER.fetch_add(1, Ordering::SeqCst)));
        cleanup.track(file.clone());
        fs::write(&file, b"do not delete").unwrap();

        let result = delete_staged_file(file.to_str().unwrap());
        assert!(result.is_err(), "non-temp path was accepted: {:?}", result);
        assert!(file.exists(), "refused delete still removed the file");
    }

    #[test]
    fn delete_staged_file_refuses_unmarked_temp_path_and_keeps_file() {
        let mut cleanup = TestCleanup::new();
        let dir = unique_temp_dir("plain-test", "delete");
        cleanup.track(dir.clone());
        let file = dir.join("file.txt");
        fs::write(&file, b"do not delete").unwrap();

        let result = delete_staged_file(file.to_str().unwrap());
        assert!(result.is_err(), "unmarked temp path was accepted: {:?}", result);
        assert!(file.exists(), "refused delete still removed the file");
    }

    // ---- telegram upload arg resolution -------------------------------------

    const APP_DATA: &str = r"C:\Users\Admin\AppData\Roaming";

    #[test]
    fn resolve_telegram_upload_args_defaults() {
        let args = resolve_telegram_upload_args(APP_DATA, None, None, None, None, None);
        assert_eq!(
            args,
            TelegramUploadArgs {
                session: r"C:\Users\Admin\AppData\Roaming\mainframe\accounts\telegram\+8801956799504\telegram".to_string(),
                api_id: "27462865".to_string(),
                api_hash: "63358074ffa2262b19f4451497a85b34".to_string(),
            }
        );
    }

    #[test]
    fn resolve_telegram_upload_args_explicit_session_wins() {
        let args = resolve_telegram_upload_args(
            APP_DATA,
            Some(r"D:\sessions\other"),
            None,
            None,
            None,
            None,
        );
        assert_eq!(args.session, r"D:\sessions\other");
        assert_eq!(args.api_id, "27462865");
    }

    #[test]
    fn resolve_telegram_upload_args_explicit_api_credentials_win() {
        let args = resolve_telegram_upload_args(
            APP_DATA,
            None,
            Some("111"),
            Some("hash-override"),
            Some("999"),
            Some("hash-from-file"),
        );
        assert_eq!(args.api_id, "111");
        assert_eq!(args.api_hash, "hash-override");
    }

    #[test]
    fn resolve_telegram_upload_args_file_contents_used_when_no_explicit() {
        let args = resolve_telegram_upload_args(
            APP_DATA,
            None,
            None,
            None,
            Some("  12345\n"),
            Some("abcdef\r\n"),
        );
        assert_eq!(args.api_id, "12345");
        assert_eq!(args.api_hash, "abcdef");
    }

    #[test]
    fn resolve_telegram_upload_args_blank_explicit_falls_back() {
        // A blank explicit value is treated as absent: file contents win,
        // and without a file the compiled-in default applies.
        let with_file = resolve_telegram_upload_args(APP_DATA, None, Some("   "), Some(""), Some("777"), Some("h"));
        assert_eq!(with_file.api_id, "777");
        assert_eq!(with_file.api_hash, "h");

        let without_file = resolve_telegram_upload_args(APP_DATA, None, Some("   "), Some("  "), None, None);
        assert_eq!(without_file.api_id, "27462865");
        assert_eq!(without_file.api_hash, "63358074ffa2262b19f4451497a85b34");
    }

    #[test]
    fn resolve_telegram_upload_args_empty_file_contents_stay_empty() {
        // Mirrors the current behavior: a present-but-empty credential file
        // yields an empty value, not the default (the default only applies
        // when the file cannot be read at all).
        let args = resolve_telegram_upload_args(APP_DATA, None, None, None, Some(""), Some("  \n"));
        assert_eq!(args.api_id, "");
        assert_eq!(args.api_hash, "");
    }

    #[test]
    fn telegram_account_dir_shape() {
        assert_eq!(
            telegram_account_dir(APP_DATA),
            r"C:\Users\Admin\AppData\Roaming\mainframe\accounts\telegram\+8801956799504"
        );
    }

    // ---- native message framing + message serde -----------------------------

    fn sample_response() -> NativeResponse {
        NativeResponse {
            success: true,
            event: Some("complete".to_string()),
            request_id: Some("req-9".to_string()),
            message: Some("done".to_string()),
            line: None,
            stream: None,
            file_path: Some("/tmp/out.mkv".to_string()),
            stdout: None,
            stderr: None,
        }
    }

    #[test]
    fn encode_native_response_prefixes_length_and_round_trips() {
        let bytes = encode_native_response(&sample_response()).unwrap();
        assert!(bytes.len() > 4);
        let prefix = u32::from_ne_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        assert_eq!(prefix, bytes.len() - 4, "length prefix must equal the JSON payload length");
        let parsed: serde_json::Value = serde_json::from_slice(&bytes[4..]).unwrap();
        assert_eq!(parsed["success"], true);
        assert_eq!(parsed["event"], "complete");
        assert_eq!(parsed["requestId"], "req-9");
        assert_eq!(parsed["message"], "done");
        assert_eq!(parsed["filePath"], "/tmp/out.mkv");
    }

    #[test]
    fn encode_native_response_uses_camel_case_keys() {
        let bytes = encode_native_response(&sample_response()).unwrap();
        let json = std::str::from_utf8(&bytes[4..]).unwrap();
        assert!(json.contains("\"requestId\""), "expected requestId in {json}");
        assert!(json.contains("\"filePath\""), "expected filePath in {json}");
        assert!(!json.contains("request_id"), "snake_case request_id leaked in {json}");
        assert!(!json.contains("file_path"), "snake_case file_path leaked in {json}");
    }

    #[test]
    fn native_message_deserializes_snake_case_fields() {
        let msg: NativeMessage = serde_json::from_str(
            r#"{"action":"download","url":"https://example.com/v","output_path":"/tmp/out.mkv","request_id":"req-1","format":"best","cookies_data":[{"domain":".example.com","host_only":false,"path":"/","secure":true,"expiration_date":123,"name":"n","value":"v"}]}"#,
        )
        .unwrap();
        assert_eq!(msg.action, "download");
        assert_eq!(msg.url.as_deref(), Some("https://example.com/v"));
        assert_eq!(msg.output_path.as_deref(), Some("/tmp/out.mkv"));
        assert_eq!(msg.request_id.as_deref(), Some("req-1"));
        assert_eq!(msg.format.as_deref(), Some("best"));
        let cookies = msg.cookies_data.unwrap();
        assert_eq!(cookies.len(), 1);
        assert_eq!(cookies[0].domain, ".example.com");
        assert!(cookies[0].secure);
        assert_eq!(msg.file_path, None);
    }

    #[test]
    fn native_message_missing_action_fails() {
        let result: Result<NativeMessage, _> = serde_json::from_str(r#"{"request_id":"req-1"}"#);
        assert!(result.is_err());
    }

    #[test]
    fn native_message_optional_fields_default_to_none() {
        let msg: NativeMessage = serde_json::from_str(r#"{"action":"ping"}"#).unwrap();
        assert_eq!(msg.action, "ping");
        assert_eq!(msg.url, None);
        assert_eq!(msg.request_id, None);
        assert!(msg.cookies_data.is_none());
    }

    #[test]
    fn native_message_telegram_verify_deserializes() {
        let msg: NativeMessage = serde_json::from_str(
            r#"{"action":"telegram_verify","message_id":"589","channel":"-1003959088547"}"#,
        )
        .unwrap();
        assert_eq!(msg.action, "telegram_verify");
        assert_eq!(msg.message_id.as_deref(), Some("589"));
        assert_eq!(msg.channel.as_deref(), Some("-1003959088547"));
        assert_eq!(msg.file_path, None);
    }

    #[test]
    fn native_message_telegram_download_deserializes_with_range() {
        let msg: NativeMessage = serde_json::from_str(
            r#"{"action":"telegram_download","message_id":"589","channel":"-1003959088547","offset":1048576,"max_bytes":8388608}"#,
        )
        .unwrap();
        assert_eq!(msg.action, "telegram_download");
        assert_eq!(msg.message_id.as_deref(), Some("589"));
        assert_eq!(msg.channel.as_deref(), Some("-1003959088547"));
        assert_eq!(msg.offset, Some(1048576));
        assert_eq!(msg.max_bytes, Some(8388608));
    }

    #[test]
    fn native_message_telegram_download_range_defaults_to_zero() {
        let msg: NativeMessage = serde_json::from_str(
            r#"{"action":"telegram_download","message_id":"589","channel":"-1003959088547"}"#,
        )
        .unwrap();
        assert_eq!(msg.offset, None);
        assert_eq!(msg.max_bytes, None);
    }

    #[test]
    fn resolve_telegram_script_missing_name_returns_none() {
        // No script by this name exists beside any exe or in the dev clone.
        assert_eq!(resolve_telegram_script("telegram_no_such_script.py"), None);
    }

    // ---- telegram uploader progress-line parsing ----------------------------

    #[test]
    fn parse_telegram_uploader_line_progress() {
        assert_eq!(
            parse_telegram_uploader_line("PROGRESS:1048576:2097152:50"),
            TelegramUploaderLine::Progress {
                current: "1048576".to_string(),
                total: "2097152".to_string(),
                percent: "50".to_string(),
            }
        );
    }

    #[test]
    fn parse_telegram_uploader_line_progress_needs_three_parts() {
        assert_eq!(parse_telegram_uploader_line("PROGRESS:1048576:2097152"), TelegramUploaderLine::Other);
        assert_eq!(parse_telegram_uploader_line("PROGRESS:"), TelegramUploaderLine::Other);
    }

    #[test]
    fn parse_telegram_uploader_line_result() {
        assert_eq!(
            parse_telegram_uploader_line(r#"RESULT:{"message_id":90}"#),
            TelegramUploaderLine::Result(r#"{"message_id":90}"#.to_string())
        );
    }

    #[test]
    fn parse_telegram_uploader_line_error() {
        assert_eq!(
            parse_telegram_uploader_line("ERROR:session expired"),
            TelegramUploaderLine::Error("session expired".to_string())
        );
    }

    #[test]
    fn parse_telegram_uploader_line_data() {
        assert_eq!(
            parse_telegram_uploader_line("DATA:aGVsbG8="),
            TelegramUploaderLine::Data("aGVsbG8=".to_string())
        );
        // A DATA line with no payload is still a data line (empty chunk).
        assert_eq!(
            parse_telegram_uploader_line("DATA:"),
            TelegramUploaderLine::Data(String::new())
        );
    }

    #[test]
    fn parse_telegram_uploader_line_other() {
        assert_eq!(parse_telegram_uploader_line("Connecting..."), TelegramUploaderLine::Other);
        assert_eq!(parse_telegram_uploader_line(""), TelegramUploaderLine::Other);
        assert_eq!(parse_telegram_uploader_line("progress:1:2:3"), TelegramUploaderLine::Other);
        assert_eq!(parse_telegram_uploader_line("data:aGVsbG8="), TelegramUploaderLine::Other);
    }

    // ---- truncate_for_native_message ----------------------------------------

    #[test]
    fn truncate_for_native_message_short_text_unchanged() {
        assert_eq!(truncate_for_native_message("hello", 100), "hello");
    }

    #[test]
    fn truncate_for_native_message_exact_limit_unchanged() {
        let text = "a".repeat(10);
        assert_eq!(truncate_for_native_message(&text, 10), text);
    }

    #[test]
    fn truncate_for_native_message_truncates_and_reports_counts() {
        let text = "a".repeat(100);
        assert_eq!(
            truncate_for_native_message(&text, 10),
            "aaaaaaaaaa\u{2026} [truncated 90 bytes, showing first 10 of 100]"
        );
    }

    #[test]
    fn truncate_for_native_message_prefers_newline_cut() {
        let text = format!("aaaa\n{}", "b".repeat(50));
        let out = truncate_for_native_message(&text, 10);
        assert!(out.starts_with("aaaa\u{2026}"), "expected cut at the newline: {out}");
        assert!(out.contains("showing first 4 of 55"), "counts wrong: {out}");
    }

    #[test]
    fn truncate_for_native_message_never_splits_utf8() {
        // 10 emoji = 40 bytes; a 10-byte cut lands mid-emoji, so the cut must
        // back off to the 8-byte boundary.
        let text = "\u{1F600}".repeat(10);
        assert_eq!(
            truncate_for_native_message(&text, 10),
            "\u{1F600}\u{1F600}\u{2026} [truncated 32 bytes, showing first 8 of 40]"
        );
        // A zero-byte budget must not panic either.
        assert_eq!(
            truncate_for_native_message("abc", 0),
            "\u{2026} [truncated 3 bytes, showing first 0 of 3]"
        );
    }

    // ---- downloaded-path detection ------------------------------------------

    #[test]
    fn looks_like_downloaded_path_accepts_windows_drive() {
        assert!(looks_like_downloaded_path(r"C:\Users\Admin\Videos\clip.mkv"));
        assert!(looks_like_downloaded_path("C:/Users/Admin/Videos/clip.mkv"));
    }

    #[test]
    fn looks_like_downloaded_path_accepts_unc() {
        assert!(looks_like_downloaded_path(r"\\server\share\clip.mkv"));
    }

    #[test]
    fn looks_like_downloaded_path_accepts_unix_absolute() {
        assert!(looks_like_downloaded_path("/home/user/Videos/clip.mkv"));
    }

    #[test]
    fn looks_like_downloaded_path_rejects_log_lines() {
        assert!(!looks_like_downloaded_path(""));
        assert!(!looks_like_downloaded_path("   "));
        assert!(!looks_like_downloaded_path("[download] 100% of 1.2GiB"));
        assert!(!looks_like_downloaded_path("WARNING: falling back"));
        assert!(!looks_like_downloaded_path("ERROR: unable to download"));
        assert!(!looks_like_downloaded_path("https://example.com/clip.mkv"));
        assert!(!looks_like_downloaded_path("relative/path/clip.mkv"));
        assert!(!looks_like_downloaded_path("/home/user/noext"));
        assert!(!looks_like_downloaded_path("/home/user/file."));
        assert!(!looks_like_downloaded_path(r"C:\path\noext"));
        // An ffmpeg log line quoting a path is not a path line.
        assert!(!looks_like_downloaded_path(r"Input #0, mov,mp4,m4a from 'C:\Videos\clip.mp4':"));
    }

    #[test]
    fn extract_downloaded_path_prefers_last_stdout_line() {
        let stdout = "[download] 100%\nC:\\Users\\Admin\\Videos\\clip.mkv\n[ffmpeg] Merging\n";
        assert_eq!(
            extract_downloaded_path(stdout, ""),
            Some(r"C:\Users\Admin\Videos\clip.mkv".to_string())
        );
    }

    #[test]
    fn extract_downloaded_path_falls_back_to_stderr() {
        assert_eq!(
            extract_downloaded_path("[download] 100%", "/home/user/clip.mkv\n"),
            Some("/home/user/clip.mkv".to_string())
        );
    }

    #[test]
    fn extract_downloaded_path_none_when_absent() {
        assert_eq!(extract_downloaded_path("[download] 100%", "ERROR: boom"), None);
        assert_eq!(extract_downloaded_path("", ""), None);
    }

    #[test]
    fn extract_downloaded_path_prefers_stdout_over_stderr() {
        assert_eq!(
            extract_downloaded_path("/tmp/a.mkv", "/tmp/b.mkv"),
            Some("/tmp/a.mkv".to_string())
        );
    }

    // ---- mirror URL rewrite -------------------------------------------------

    #[test]
    fn rewrite_mirror_url_rewrites_ukdevilz_watch() {
        assert_eq!(
            rewrite_mirror_url("https://ukdevilz.com/watch/12345_678"),
            "https://vk.com/video12345_678"
        );
    }

    #[test]
    fn rewrite_mirror_url_rewrites_www_and_strips_query_and_slash() {
        assert_eq!(
            rewrite_mirror_url("https://www.ukdevilz.com/watch/12345_678/?ref=x"),
            "https://vk.com/video12345_678"
        );
    }

    #[test]
    fn rewrite_mirror_url_rewrites_case_insensitive_host() {
        assert_eq!(
            rewrite_mirror_url("HTTPS://UKDEVILZ.COM/WATCH/12345_678"),
            "https://vk.com/video12345_678"
        );
    }

    #[test]
    fn rewrite_mirror_url_leaves_other_urls_alone() {
        assert_eq!(
            rewrite_mirror_url("https://www.youtube.com/watch?v=abc"),
            "https://www.youtube.com/watch?v=abc"
        );
        assert_eq!(
            rewrite_mirror_url("https://vk.com/video12345_678"),
            "https://vk.com/video12345_678"
        );
        // Not a /watch/ path.
        assert_eq!(
            rewrite_mirror_url("https://ukdevilz.com/videofile/123.mp4"),
            "https://ukdevilz.com/videofile/123.mp4"
        );
        // A non-numeric id is not a VK video id.
        assert_eq!(
            rewrite_mirror_url("https://ukdevilz.com/watch/abc123"),
            "https://ukdevilz.com/watch/abc123"
        );
        // A port on the host defeats the path match, so it passes through.
        assert_eq!(
            rewrite_mirror_url("https://ukdevilz.com:8080/watch/12345_678"),
            "https://ukdevilz.com:8080/watch/12345_678"
        );
    }

    // ---- yt-dlp output helpers ----------------------------------------------

    #[test]
    fn combine_ytdlp_output_orders_stderr_first() {
        assert_eq!(combine_ytdlp_output("out", "err"), "err\nout");
    }

    #[test]
    fn combine_ytdlp_output_skips_empty_parts() {
        assert_eq!(combine_ytdlp_output("out", ""), "out");
        assert_eq!(combine_ytdlp_output("", "err"), "err");
        assert_eq!(combine_ytdlp_output("  ", "\n"), "");
        assert_eq!(combine_ytdlp_output("  out  ", "  err  "), "err\nout");
    }

    #[test]
    fn ytdlp_failure_message_empty_combined_names_exit_code() {
        assert_eq!(
            ytdlp_failure_message("", Some(1)),
            "yt-dlp failed with exit code Some(1)"
        );
        assert_eq!(
            ytdlp_failure_message("", None),
            "yt-dlp failed with exit code None"
        );
    }

    #[test]
    fn ytdlp_failure_message_nonempty_combined() {
        assert_eq!(
            ytdlp_failure_message("ERROR: boom", Some(1)),
            "yt-dlp failed:\nERROR: boom"
        );
    }

    #[test]
    fn should_retry_with_short_title_cases() {
        let template = r"C:\Videos\%(title)s.%(ext)s";
        assert!(should_retry_with_short_title(template, "error: unable to open for writing"));
        assert!(should_retry_with_short_title(template, "no such file or directory"));
        // Already shortened: no second retry.
        assert!(!should_retry_with_short_title(
            r"C:\Videos\%(title).180B.%(ext)s",
            "unable to open for writing"
        ));
        // No title template at all.
        assert!(!should_retry_with_short_title(
            r"C:\Videos\fixed.%(ext)s",
            "unable to open for writing"
        ));
        // An unrelated failure is not a path-length problem.
        assert!(!should_retry_with_short_title(template, "http error 403"));
    }

    #[test]
    fn should_retry_extraction_cases() {
        assert!(should_retry_extraction(0, "unable to extract universal data for rehydration"));
        assert!(should_retry_extraction(1, "http error 403"));
        // Attempt 2 is the last attempt: no further retry.
        assert!(!should_retry_extraction(2, "http error 403"));
        assert!(!should_retry_extraction(3, "http error 403"));
        assert!(!should_retry_extraction(0, "some other failure"));
    }

    #[test]
    fn classify_test_download_error_cases() {
        assert_eq!(
            classify_test_download_error("ERROR: HTTP Error 403: Forbidden\nmore"),
            "yt-dlp failed: HTTP Error 403 Forbidden"
        );
        assert_eq!(
            classify_test_download_error("ffmpeg exited with code 1\nsecond line"),
            "yt-dlp failed (ffmpeg error): ffmpeg exited with code 1"
        );
        assert_eq!(
            classify_test_download_error("ERROR: Unsupported URL\nsecond line"),
            "yt-dlp failed: ERROR: Unsupported URL"
        );
        assert_eq!(classify_test_download_error(""), "yt-dlp failed: ");
    }

    // ---- cookies file --------------------------------------------------------

    #[test]
    fn write_temp_cookies_file_writes_netscape_format() {
        let cookies = vec![
            BrowserCookie {
                domain: ".example.com".to_string(),
                host_only: false,
                path: "/".to_string(),
                secure: true,
                expiration_date: 1_700_000_000,
                name: "session".to_string(),
                value: "abc".to_string(),
            },
            BrowserCookie {
                domain: "plain.example.com".to_string(),
                host_only: true,
                path: "/videos".to_string(),
                secure: false,
                expiration_date: -5,
                name: "x".to_string(),
                value: "y".to_string(),
            },
        ];
        let path = write_temp_cookies_file(&cookies).unwrap();
        let mut cleanup = TestCleanup::new();
        cleanup.track(path.clone());

        let contents = fs::read_to_string(&path).unwrap();
        assert!(contents.starts_with("# Netscape HTTP Cookie File\n# Generated by ImgVault\n"));
        assert!(contents.contains(".example.com\tTRUE\t/\tTRUE\t1700000000\tsession\tabc\n"));
        // host_only flips the subdomain flag, and a negative expiry clamps to 0.
        assert!(contents.contains("plain.example.com\tFALSE\t/videos\tFALSE\t0\tx\ty\n"));
    }

    #[test]
    fn cleanup_temp_cookies_file_removes_only_own_files() {
        let mut cleanup = TestCleanup::new();
        let ours = env::temp_dir().join(format!(
            "imgvault-yt-dlp-cookies-{}-{}.txt",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let other = env::temp_dir().join(format!(
            "plain-cookies-{}-{}.txt",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        cleanup.track(other.clone());
        fs::write(&ours, b"cookies").unwrap();
        fs::write(&other, b"cookies").unwrap();

        cleanup_temp_cookies_file(&Some(ours.clone()));
        assert!(!ours.exists(), "own cookies file was not removed");
        cleanup_temp_cookies_file(&Some(other.clone()));
        assert!(other.exists(), "a foreign file was removed");
        cleanup_temp_cookies_file(&None);
    }

    // ---- temp path builders + misc pure helpers ------------------------------

    #[test]
    fn session_and_request_paths_live_under_temp_and_carry_sanitized_id() {
        let id = "req/../1";
        assert_eq!(
            video_session_path(id, "input"),
            env::temp_dir().join("imgvault-req____1-input")
        );
        assert_eq!(
            get_request_pid_path(id),
            env::temp_dir().join("imgvault-native-download-req____1.pid")
        );
        assert_eq!(
            get_cancel_flag_path(id),
            env::temp_dir().join("imgvault-native-download-req____1.cancel")
        );
        assert_eq!(
            get_request_journal_path(id),
            env::temp_dir().join("imgvault-yt-dlp-journal-req____1.json")
        );
    }

    #[test]
    fn get_output_directory_returns_parent() {
        assert_eq!(
            get_output_directory("/home/user/Videos/%(title)s.mkv").unwrap(),
            PathBuf::from("/home/user/Videos")
        );
    }

    #[test]
    fn get_cookies_path_is_next_to_executable() {
        let cookies = get_cookies_path().unwrap();
        assert_eq!(cookies.file_name().unwrap().to_str().unwrap(), "cookies.txt");
        assert_eq!(cookies.parent().unwrap(), get_executable_directory().unwrap());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn get_default_videos_directory_non_windows_is_current_dir() {
        assert_eq!(get_default_videos_directory().unwrap(), env::current_dir().unwrap());
    }

    #[test]
    fn chrono_now_ms_is_plausible() {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let value = chrono_now_ms();
        assert!(value > 1_704_067_200_000, "before 2024-01-01: {value}");
        assert!(value <= now_ms + 1_000, "in the future: {value} > {now_ms}");
    }

    // ---- file round trips (real temp files, unique per test) -----------------

    #[test]
    fn video_normalize_start_chunk_round_trip() {
        let id = unique_request_id("vnorm");
        let input = video_session_path(&id, "input");
        assert!(video_normalize_start(&id).is_ok());
        assert_eq!(fs::read(&input).unwrap(), b"");

        video_normalize_chunk(&id, &BASE64.encode(b"hello")).unwrap();
        video_normalize_chunk(&id, &BASE64.encode(b" world")).unwrap();
        assert_eq!(fs::read(&input).unwrap(), b"hello world");

        assert!(video_normalize_chunk(&id, "!!!not-base64!!!").is_err());
        video_normalize_cleanup(&id);
        assert!(!input.exists());
    }

    #[test]
    fn video_normalize_chunk_without_start_fails() {
        let id = unique_request_id("vnorm-nostart");
        assert!(video_normalize_chunk(&id, &BASE64.encode(b"x")).is_err());
    }

    #[test]
    fn video_normalize_encode_args_match_the_documented_quality() {
        // AGENTS.md 2.13.14: H.264 CRF 12, `slow` preset, AAC 320k,
        // faststart. The code shipped ffmpeg's default `medium` preset
        // until 2.19.23; this pins the documented values.
        let args = VIDEO_NORMALIZE_ENCODE_ARGS;
        let value_of = |flag: &str| {
            args.iter()
                .position(|a| *a == flag)
                .and_then(|i| args.get(i + 1).copied())
        };
        assert_eq!(value_of("-preset"), Some("slow"));
        assert_eq!(value_of("-crf"), Some("12"));
        assert_eq!(value_of("-c:v"), Some("libx264"));
        assert_eq!(value_of("-c:a"), Some("aac"));
        assert_eq!(value_of("-b:a"), Some("320k"));
        assert!(args.contains(&"-pix_fmt"));
        assert!(args.contains(&"yuv420p"));
        assert!(args.contains(&"-movflags"));
        assert!(args.contains(&"+faststart"));
        assert!(!args.contains(&"medium"), "the medium preset must be gone");
    }

    #[test]
    fn file_write_start_chunk_finish_round_trip_staged() {
        let id = unique_request_id("fwstage");
        let mut cleanup = TestCleanup::new();

        let target = file_write_start(&id, "", "clip.mp4").unwrap();
        let session_dir = target.parent().unwrap().to_path_buf();
        cleanup.track(session_dir.clone());
        assert_eq!(
            target,
            env::temp_dir()
                .join("imgvault-tg-stage")
                .join(&id)
                .join("clip.mp4")
        );

        file_write_chunk(&id, &BASE64.encode(b"abc")).unwrap();
        file_write_chunk(&id, &BASE64.encode(b"def")).unwrap();
        let (path, size) = file_write_finish(&id).unwrap();
        assert_eq!(path, target.display().to_string());
        assert_eq!(size, 6);
        assert_eq!(fs::read(&target).unwrap(), b"abcdef");
        // finish removes the sidecar.
        assert!(!file_write_target_path(&id).exists());

        // The staged file is deletable through the guarded delete path.
        assert_eq!(delete_staged_file(&path), Ok(true));
        assert!(!target.exists());
    }

    #[test]
    fn file_write_start_absolute_path_round_trip() {
        let id = unique_request_id("fwabs");
        let mut cleanup = TestCleanup::new();
        let dir = unique_temp_dir("imgvault-test", "fwabs");
        cleanup.track(dir.clone());
        let absolute = dir.join("clip.m4a");

        let target = file_write_start(&id, absolute.to_str().unwrap(), "clip.m4a").unwrap();
        assert_eq!(target, absolute);
        file_write_chunk(&id, &BASE64.encode(b"data")).unwrap();
        let (path, size) = file_write_finish(&id).unwrap();
        assert_eq!(path, absolute.display().to_string());
        assert_eq!(size, 4);
        assert_eq!(fs::read(&absolute).unwrap(), b"data");
    }

    #[test]
    fn file_write_resolve_target_without_start_fails() {
        let id = unique_request_id("fw-nostart");
        assert!(file_write_resolve_target(&id).is_err());
        assert!(file_write_chunk(&id, &BASE64.encode(b"x")).is_err());
        assert!(file_write_finish(&id).is_err());
    }

    #[test]
    fn download_journal_write_read_remove_round_trip() {
        let id = unique_request_id("journal");
        let path = get_request_journal_path(&id);
        let mut cleanup = TestCleanup::new();
        cleanup.track(path.clone());

        assert_eq!(read_download_journal(&id), None);
        write_download_journal(
            &id,
            "completed",
            Some("/tmp/clip.mkv"),
            Some("Download complete"),
            Some("stdout"),
            Some("stderr"),
        )
        .unwrap();

        let journal = read_download_journal(&id).expect("journal readable");
        assert_eq!(journal["requestId"], id);
        assert_eq!(journal["status"], "completed");
        assert_eq!(journal["file_path"], "/tmp/clip.mkv");
        assert_eq!(journal["message"], "Download complete");
        assert!(journal["completedAt"].as_i64().unwrap() > 0);

        remove_download_journal(&id);
        assert_eq!(read_download_journal(&id), None);
    }

    #[test]
    fn upload_journal_write_read_remove_round_trip() {
        let id = unique_request_id("upload-journal");
        let path = get_upload_journal_path(&id);
        let mut cleanup = TestCleanup::new();
        cleanup.track(path.clone());

        assert_eq!(read_upload_journal(&id), None);
        write_upload_journal(
            &id,
            "running",
            Some(r"C:\Temp\imgvault-tg-stage\blob.bin"),
            Some("3959088547"),
            Some("Telegram upload started"),
            None,
            None,
        )
        .unwrap();
        let running = read_upload_journal(&id).expect("running journal readable");
        assert_eq!(running["requestId"], id);
        assert_eq!(running["status"], "running");
        assert_eq!(running["channel"], "3959088547");

        // The terminal write replaces the running entry in place.
        write_upload_journal(
            &id,
            "completed",
            Some(r"C:\Temp\imgvault-tg-stage\blob.bin"),
            Some("3959088547"),
            Some("Telegram upload succeeded"),
            Some(r#"{"ok":true,"messageId":701,"size":399456568}"#),
            None,
        )
        .unwrap();
        let journal = read_upload_journal(&id).expect("journal readable");
        assert_eq!(journal["status"], "completed");
        assert_eq!(journal["stdout"], r#"{"ok":true,"messageId":701,"size":399456568}"#);
        assert!(journal["completedAt"].as_i64().unwrap() > 0);

        remove_upload_journal(&id);
        assert_eq!(read_upload_journal(&id), None);
    }

    #[test]
    fn upload_journal_path_uses_sanitized_request_id() {
        let id = unique_request_id("upload-journal-path");
        let path = get_upload_journal_path(&id);
        assert_eq!(
            path,
            env::temp_dir().join(format!("imgvault-tg-upload-journal-{}.json", id))
        );
        // A hostile request id cannot escape the temp dir or pick another file.
        assert_eq!(
            get_upload_journal_path("../download-journal-x"),
            env::temp_dir().join("imgvault-tg-upload-journal-___download-journal-x.json")
        );
    }

    #[test]
    fn upload_journal_failed_entry_carries_the_error() {
        let id = unique_request_id("upload-journal-failed");
        let path = get_upload_journal_path(&id);
        let mut cleanup = TestCleanup::new();
        cleanup.track(path.clone());

        write_upload_journal(
            &id,
            "failed",
            Some(r"C:\Temp\imgvault-tg-stage\blob.bin"),
            Some("3959088547"),
            Some("Uploader exited with code Some(1)"),
            None,
            Some("Traceback (most recent call last): ..."),
        )
        .unwrap();
        let journal = read_upload_journal(&id).expect("journal readable");
        assert_eq!(journal["status"], "failed");
        assert_eq!(journal["message"], "Uploader exited with code Some(1)");
        assert!(journal["stderr"].as_str().unwrap().contains("Traceback"));
    }

    #[test]
    fn request_pid_and_cancel_flag_round_trip() {
        let id = unique_request_id("pidflag");
        let mut cleanup = TestCleanup::new();
        cleanup.track(get_request_pid_path(&id));
        cleanup.track(get_cancel_flag_path(&id));

        write_request_pid(&id, 4242).unwrap();
        assert_eq!(fs::read_to_string(get_request_pid_path(&id)).unwrap(), "4242");
        remove_request_pid(&id);
        assert!(!get_request_pid_path(&id).exists());

        assert!(!has_cancel_flag(&id));
        write_cancel_flag(&id).unwrap();
        assert!(has_cancel_flag(&id));
        remove_cancel_flag(&id);
        assert!(!has_cancel_flag(&id));
    }

    #[test]
    fn cancel_download_request_no_active_download() {
        let id = unique_request_id("cancel-none");
        let result = cancel_download_request(&id).unwrap();
        assert!(result.contains("No active download"), "unexpected: {result}");
    }

    #[test]
    fn cancel_download_request_reports_finished_journal() {
        let id = unique_request_id("cancel-done");
        let mut cleanup = TestCleanup::new();
        cleanup.track(get_request_journal_path(&id));
        write_download_journal(&id, "completed", None, None, None, None).unwrap();

        let result = cancel_download_request(&id).unwrap();
        assert!(result.contains("already finished"), "unexpected: {result}");
    }

    #[test]
    fn cancel_download_request_reports_existing_cancel_flag() {
        let id = unique_request_id("cancel-flag");
        let mut cleanup = TestCleanup::new();
        cleanup.track(get_cancel_flag_path(&id));
        write_cancel_flag(&id).unwrap();

        let result = cancel_download_request(&id).unwrap();
        assert!(result.contains("already requested"), "unexpected: {result}");
    }
}
