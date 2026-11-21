// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: the native host (native-host/src-tauri/src/main.rs).
//
// All source-text assertions: the host is Rust, so node cannot import
// it. (Reading native-host/ for assertions is fine; MODIFYING it is
// forbidden — another agent owns it.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const mainRs = () => src('../../native-host/src-tauri/src/main.rs');

// ------------------------------------------------- 2.19.22 staging ---

test('2.19.22 (2026-11-18): a picked file with no disk path stages under %TEMP%/imgvault-tg-stage/<session>/<name>; absolute paths pass through', () => {
  const rs = mainRs();
  const fn = rs.slice(rs.indexOf('fn resolve_file_write_target'));
  assert.ok(fn.includes("if given.is_empty() || PathBuf::from(given).is_relative() {"));
  assert.ok(fn.includes('.join("imgvault-tg-stage")'));
  assert.ok(fn.includes('.join(sanitize_request_id(request_id))'));
  assert.ok(fn.includes('.join(sanitize_stage_file_name(file_name))'));
  assert.ok(fn.includes('PathBuf::from(given)'));
});

test('2.19.22 (2026-11-18): staged names are sanitized so they cannot escape the stage folder (no separators, 120-char cap, "file" fallback)', () => {
  const rs = mainRs();
  const fn = rs.slice(rs.indexOf('fn sanitize_stage_file_name'));
  assert.ok(fn.includes(".filter(|c| !matches!(c, '/' | '\\\\' | ':' | '*' | '?' | '\"' | '<' | '>' | '|' | '\\0'))"));
  assert.ok(fn.includes('let clean = clean.trim().trim_matches(\'.\');'));
  assert.ok(fn.includes('"file".to_string()'));
  assert.ok(fn.includes('clean.chars().take(120).collect()'));
});

test('2.19.22 (2026-11-18): file_delete only ever deletes under %TEMP% with the imgvault- marker, and "already gone" is a success', () => {
  const rs = mainRs();
  assert.ok(rs.includes('path.starts_with(env::temp_dir()) && path.display().to_string().contains("imgvault-")'));
  assert.ok(rs.includes('"Refusing to delete a file outside the imgvault temp area: {}"'));
  assert.ok(rs.includes('Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false)'));
  assert.ok(rs.includes('if deleted { "deleted".to_string() } else { "already gone".to_string() }'));
});

test('2.19.22 (2026-11-18): the file-write dispatch answers one complete event per message, and finish echoes the byte count', () => {
  const rs = mainRs();
  assert.ok(rs.includes('"file_write_start" => {'));
  assert.ok(rs.includes('"file_write_chunk" => {'));
  assert.ok(rs.includes('"file_write_finish" => {'));
  assert.ok(rs.includes('"file_delete" => {'));
  const finish = rs.slice(rs.indexOf('"file_write_finish" => {'));
  assert.ok(finish.includes('Ok((path, size)) => NativeResponse'));
  assert.ok(finish.includes('message: Some(size.to_string())'));
});

// ------------------------------------------------- probe / telegram ---

test('2.19.22 (2026-11-18): ping answers "Native host reachable" in the same complete-event shape', () => {
  const rs = mainRs();
  const ping = rs.slice(rs.indexOf('"ping" => NativeResponse {'));
  assert.ok(ping.includes('message: Some("Native host reachable".to_string())'));
  assert.ok(ping.includes('event: Some("complete".to_string())'));
});

test('2.19.6 (2026-11-03): telegram_upload spawns telegram_upload.py and parses its PROGRESS:<current>:<total>:<percent> lines', () => {
  const rs = mainRs();
  assert.ok(rs.includes('"telegram_upload" => {'));
  // 2.19.30: the script lookup moved into the shared resolve_telegram_script
  // helper (upload + verify); the upload still resolves telegram_upload.py.
  assert.ok(rs.includes('resolve_telegram_script("telegram_upload.py")'));
  assert.ok(rs.includes('fn resolve_telegram_script(script_name: &str) -> Option<String> {'));
  assert.ok(rs.includes('.join("scripts").join(script_name)'));
  assert.ok(rs.includes('fn parse_telegram_uploader_line(line: &str) -> TelegramUploaderLine {'));
  assert.ok(rs.includes('PROGRESS:<current>:<total>:<percent>'));
  assert.ok(rs.includes('telegram_upload.py script not found (looked beside the exe and in the dev clone)'));
});

test('2.19.30 (2026-11-21): telegram_verify spawns telegram_verify.py with --message-id and returns its RESULT json', () => {
  const rs = mainRs();
  assert.ok(rs.includes('"telegram_verify" => {'));
  assert.ok(rs.includes('resolve_telegram_script("telegram_verify.py")'));
  assert.ok(rs.includes('fn handle_telegram_verify('));
  assert.ok(rs.includes('.arg("--message-id")'));
  assert.ok(rs.includes('message: Some("Telegram verify succeeded".to_string())'));
  assert.ok(rs.includes('Missing message_id or channel for telegram_verify'));
});

// ------------------------------------------------- video normalize ---

// FIXED 2.19.23: AGENTS.md 2.13.14 says the ffmpeg preset is `slow`,
// but the host ran `medium` (ffmpeg's default) since the day the entry
// was written. The code follows the documented decision now.
test('2.13.14/15 (2026-09-28): video normalize re-encodes with libx264 CRF 12 / AAC 320k / faststart, hardware decode, all threads', () => {
  const rs = mainRs();
  const fn = rs.slice(rs.indexOf('fn video_normalize_finish'));
  assert.ok(fn.includes('.args(["-y", "-hwaccel", "auto", "-threads", "0", "-i"])'));
  assert.ok(fn.includes('.args(VIDEO_NORMALIZE_ENCODE_ARGS)'));
  assert.ok(rs.includes('"-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "slow",'));
  assert.ok(rs.includes('"-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "320k",'));
  assert.ok(rs.includes('"-movflags", "+faststart",'));
  assert.ok(!rs.includes('"-preset", "medium"'), 'the medium preset must be gone');
});

test('2.13.15 (2026-09-28): the normalized output is read back in 700 KiB base64 chunks (Chrome drops native messages above 1 MiB)', () => {
  const rs = mainRs();
  const fn = rs.slice(rs.indexOf('fn video_normalize_read'));
  assert.ok(fn.includes('let mut bytes = vec![0u8; max_bytes.min(700 * 1024)];'));
});

// ------------------------------------------------- message safety ---

test('native message safety: truncation never splits a UTF-8 character and prefers a newline cut', () => {
  const rs = mainRs();
  const fn = rs.slice(rs.indexOf('fn truncate_for_native_message'));
  assert.ok(fn.includes('while safe_cut > 0 && !text.is_char_boundary(safe_cut) {'));
  assert.ok(fn.includes("let cut = truncated.rfind('\\n').unwrap_or(safe_cut);"));
  assert.ok(fn.includes('"{}… [truncated {} bytes, showing first {} of {}]"'));
});

test('download path extraction: stdout first, stderr fallback, and only clean absolute paths with a real extension count', () => {
  const rs = mainRs();
  const extract = rs.slice(rs.indexOf('fn extract_downloaded_path'));
  assert.ok(extract.includes('.find(|line| looks_like_downloaded_path(line))'));
  assert.ok(extract.includes('.or_else(|| stderr_text.lines().rev().find(|line| looks_like_downloaded_path(line)))'));
  const looks = rs.slice(rs.indexOf('fn looks_like_downloaded_path'));
  assert.ok(looks.includes("trimmed.starts_with('[')"));
  assert.ok(looks.includes('trimmed.starts_with("WARNING:")'));
  assert.ok(looks.includes('trimmed.starts_with("ERROR:")'));
  assert.ok(looks.includes("name.contains('.') && !name.ends_with('.')"));
});

test('download path extraction: the FULL streams are scanned — truncating the tail used to hide the path and fake a failure', () => {
  const rs = mainRs();
  assert.ok(rs.includes('Callers MUST run this on the FULL, untruncated streams:'));
  assert.ok(rs.includes('truncate_for_native_message(&stdout_text, 40_000)'));
  assert.ok(rs.includes('truncate_for_native_message(&stderr_text, 40_000)'));
});

// ------------------------------------------------- yt-dlp ---

test('ukdevilz mirror (2.12.x): /watch/{owner}_{id} rewrites to the upstream VK URL; only digits, - and _ survive', () => {
  const rs = mainRs();
  const fn = rs.slice(rs.indexOf('fn rewrite_mirror_url'));
  assert.ok(fn.includes('if host == "ukdevilz.com" || host.ends_with(".ukdevilz.com") {'));
  assert.ok(fn.includes('path.strip_prefix("ukdevilz.com/watch/")'));
  assert.ok(fn.includes('.or_else(|| path.strip_prefix("www.ukdevilz.com/watch/"))'));
  assert.ok(fn.includes('.all(|c| c.is_ascii_digit() || c == \'-\' || c == \'_\')'));
});

test('yt-dlp: both download paths rewrite mirrors and impersonate Chrome', () => {
  const rs = mainRs();
  assert.equal((rs.match(/\.arg\(rewrite_mirror_url\(url\)\)/g) || []).length, 2);
  assert.equal((rs.match(/command\.arg\("--impersonate"\)\.arg\("chrome"\);/g) || []).length, 2);
  assert.ok(rs.includes('fn download_video_with_progress('));
});

test('download cancel + resume: a per-request cancel flag file, taskkill kill, and a journal the host can read and delete', () => {
  const rs = mainRs();
  assert.ok(rs.includes('fn get_cancel_flag_path(request_id: &str) -> PathBuf {'));
  assert.ok(rs.includes('fn write_cancel_flag(request_id: &str) -> Result<(), String> {'));
  assert.ok(rs.includes('fn has_cancel_flag(request_id: &str) -> bool {'));
  assert.ok(rs.includes('Command::new("taskkill")'));
  assert.ok(rs.includes('fn read_download_journal(request_id: &str) -> Option<serde_json::Value> {'));
  assert.ok(rs.includes('"delete_download_journal" => {'));
});

// ------------------------------------------------- host self-tests ---

test('native host: the Rust unit-test module exists and covers the ping round trip', () => {
  const rs = mainRs();
  assert.ok(rs.includes('#[cfg(test)]\nmod tests {'));
  assert.ok((rs.match(/#\[test\]/g) || []).length >= 80);
  assert.ok(rs.includes('serde_json::from_str(r#"{"action":"ping"}"#)'));
  assert.ok(rs.includes('assert_eq!(msg.action, "ping");'));
});

// ------------------------------------------------- gap-closing pins ---

test('2.12.20 (2026-09-01): the worker tracks cancelling downloads in a synchronous in-memory Set — the async storage flag raced the kill', () => {
  const bg = src('../src/background/background.js');
  assert.ok(bg.includes('this.cancellingNativeDownloads = new Set();'));
  assert.ok(bg.includes('this.cancellingNativeDownloads.add(activeRequestId);'));
  assert.ok(bg.includes('this.cancellingNativeDownloads.delete(activeRequestId);'));
});
