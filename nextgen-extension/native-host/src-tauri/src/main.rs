#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

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
    file_path: Option<String>,
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

// Download video using yt-dlp
fn download_video(url: &str, output_path: &str) -> Result<String, String> {
    let output = Command::new("yt-dlp")
        .arg(url)
        .arg("-o")
        .arg(output_path)
        .arg("--no-playlist")
        .arg("--quiet")
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;
    
    if output.status.success() {
        Ok(output_path.to_string())
    } else {
        let error = String::from_utf8_lossy(&output.stderr);
        Err(format!("yt-dlp failed: {}", error))
    }
}

// Handle native messaging (stdin/stdout communication)
fn handle_native_messaging() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    
    for line in stdin.lock().lines() {
        match line {
            Ok(msg) => {
                // Parse the message
                match serde_json::from_str::<NativeMessage>(&msg) {
                    Ok(native_msg) => {
                        let response = match native_msg.action.as_str() {
                            "download" => {
                                if let (Some(url), Some(output_path)) = 
                                    (native_msg.url, native_msg.output_path) 
                                {
                                    match download_video(&url, &output_path) {
                                        Ok(file_path) => NativeResponse {
                                            success: true,
                                            message: Some("Download complete".to_string()),
                                            file_path: Some(file_path),
                                        },
                                        Err(e) => NativeResponse {
                                            success: false,
                                            message: Some(e),
                                            file_path: None,
                                        },
                                    }
                                } else {
                                    NativeResponse {
                                        success: false,
                                        message: Some("Missing url or output_path".to_string()),
                                        file_path: None,
                                    }
                                }
                            }
                            _ => NativeResponse {
                                success: false,
                                message: Some("Unknown action".to_string()),
                                file_path: None,
                            },
                        };
                        
                        // Send response
                        let response_json = serde_json::to_string(&response).unwrap();
                        writeln!(stdout, "{}", response_json).ok();
                        stdout.flush().ok();
                    }
                    Err(e) => {
                        eprintln!("Failed to parse message: {}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("Error reading stdin: {}", e);
                break;
            }
        }
    }
}

fn main() {
    // Check if running in native mode (headless)
    let args: Vec<String> = env::args().collect();
    
    if args.contains(&"--native".to_string()) {
        // Run in headless mode for native messaging
        handle_native_messaging();
    } else {
        // Run GUI mode
        tauri::Builder::default()
            .invoke_handler(tauri::generate_handler![check_registration, register_host, unregister_host])
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
