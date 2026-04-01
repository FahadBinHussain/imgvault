#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{self, Write, Read};
use std::process::{Command, Stdio};

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::{HKEY, RegKey};

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
}

#[derive(Debug, Serialize, Deserialize)]
struct NativeResponse {
    success: bool,
    message: Option<String>,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
    stdout: Option<String>,
    stderr: Option<String>,
}

struct DownloadOutcome {
    message: String,
    file_path: Option<String>,
    stdout: String,
    stderr: String,
}

// Check if the native messaging host is registered
#[tauri::command]
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
#[tauri::command]
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
#[tauri::command]
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

#[tauri::command]
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

// Download video using yt-dlp
fn download_video(url: &str, output_path: &str) -> Result<DownloadOutcome, DownloadOutcome> {
    let mut command = Command::new("yt-dlp");
    command
        .arg(url)
        .arg("--verbose")
        .arg("-f")
        .arg("bestvideo+bestaudio/best")
        .arg("--merge-output-format")
        .arg("mkv")
        .arg("-o")
        .arg(output_path)
        .arg("--no-playlist")
        .arg("--progress")
        .arg("--newline")
        .arg("--print")
        .arg("after_move:filepath");
    
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
            message: format!("Failed to execute yt-dlp: {}", e),
            file_path: None,
            stdout: String::new(),
            stderr: String::new(),
        })?;
    
    let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();
    let file_path = stdout_text
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string());

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
        let combined = [stderr_text.trim().to_string(), stdout_text.trim().to_string()]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("\n");

        Err(DownloadOutcome {
            message: if combined.is_empty() {
                format!("yt-dlp failed with exit code {:?}", output.status.code())
            } else {
                format!("yt-dlp failed:\n{}", combined)
            },
            file_path: None,
            stdout: stdout_text,
            stderr: stderr_text,
        })
    }
}

// Test download with detailed output (for GUI)
#[tauri::command]
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
        Err(serde_json::json!({
            "message": format!("yt-dlp failed with exit code: {:?}", output.status.code()),
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
                    "download" => {
                        if let (Some(url), Some(output_path)) = 
                            (native_msg.url, native_msg.output_path) 
                        {
                            eprintln!("[NATIVE] Processing download: {} -> {}", url, output_path);
                            match download_video(&url, &output_path) {
                                Ok(file_path) => {
                                    eprintln!("[NATIVE] Download successful: {}", file_path.file_path.as_deref().unwrap_or(""));
                                    NativeResponse {
                                        success: true,
                                        message: Some(file_path.message),
                                        file_path: file_path.file_path,
                                        stdout: Some(file_path.stdout),
                                        stderr: Some(file_path.stderr),
                                    }
                                },
                                Err(e) => {
                                    eprintln!("[NATIVE] Download failed: {}", e.message);
                                    NativeResponse {
                                        success: false,
                                        message: Some(e.message),
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
                                message: Some("Missing url or output_path".to_string()),
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
                                message: Some("PATH reloaded".to_string()),
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                            Err(e) => NativeResponse {
                                success: false,
                                message: Some(e),
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                        }
                    }
                    "ping" => NativeResponse {
                        success: true,
                        message: Some("Native host reachable".to_string()),
                        file_path: None,
                        stdout: None,
                        stderr: None,
                    },
                    "check_yt_dlp" => {
                        match find_yt_dlp() {
                            Ok(message) => NativeResponse {
                                success: true,
                                message: Some(message),
                                file_path: None,
                                stdout: None,
                                stderr: None,
                            },
                            Err(e) => NativeResponse {
                                success: false,
                                message: Some(e),
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
                            message: Some("Unknown action".to_string()),
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
                    message: Some(format!("Failed to parse message: {}", e)),
                    file_path: None,
                    stdout: None,
                    stderr: None,
                }
            }
        };
        
        // Send response with length header
        let response_json = serde_json::to_string(&response).unwrap();
        let response_length = response_json.len() as u32;
        
        eprintln!("[NATIVE] Sending response: {}", response_json);
        
        // Write length header (4 bytes, little-endian)
        if stdout.write_all(&response_length.to_ne_bytes()).is_err() {
            eprintln!("[NATIVE] Failed to write response length");
            break;
        }
        
        // Write response content
        if stdout.write_all(response_json.as_bytes()).is_err() {
            eprintln!("[NATIVE] Failed to write response content");
            break;
        }
        
        if stdout.flush().is_err() {
            eprintln!("[NATIVE] Failed to flush stdout");
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
    
    // Otherwise, run GUI mode
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![check_registration, register_host, unregister_host, reload_path, test_download])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
