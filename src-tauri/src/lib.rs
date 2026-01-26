use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

// Store initial file path (thread-safe for updates from events)
struct InitialFile(Mutex<Option<String>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(InitialFile(Mutex::new(None)))
        .setup(|app| {
            // Check for file arguments passed on startup (Linux/Windows style)
            let args: Vec<String> = std::env::args().collect();
            println!("DEBUG: Command line args = {:?}", args);
            if args.len() > 1 {
                let file_path = &args[1];
                println!("DEBUG: Checking file path from args: {}", file_path);
                if std::path::Path::new(file_path).exists() {
                    println!("DEBUG: File exists, storing as initial file");
                    let state = app.state::<InitialFile>();
                    *state.0.lock().unwrap() = Some(file_path.clone());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_initial_file])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Handle RunEvent::Opened for macOS file associations
            if let tauri::RunEvent::Opened { urls } = event {
                println!("DEBUG: RunEvent::Opened received with {} URLs", urls.len());
                for url in urls {
                    println!("DEBUG: URL = {:?}", url);
                    if let Ok(path) = url.to_file_path() {
                        if let Some(path_str) = path.to_str() {
                            let path_string = path_str.to_string();
                            println!("DEBUG: File path = {}", path_string);

                            // Store for frontend to query (this always works)
                            let state = app.state::<InitialFile>();
                            *state.0.lock().unwrap() = Some(path_string.clone());

                            // Also try to emit event with retries (for when app is already running)
                            let app_handle = app.clone();
                            let path_for_emit = path_string.clone();
                            std::thread::spawn(move || {
                                // Retry a few times with delays to give frontend time to initialize
                                for i in 0..5 {
                                    std::thread::sleep(Duration::from_millis(100 * (i + 1)));
                                    if let Some(window) = app_handle.get_webview_window("main") {
                                        println!("DEBUG: Attempt {} - Emitting open-file event", i + 1);
                                        if window.emit("open-file", path_for_emit.clone()).is_ok() {
                                            println!("DEBUG: Event emitted successfully");
                                            break;
                                        }
                                    }
                                }
                            });
                        }
                    }
                }
            }
        });
}

// Command to get and clear the initial file path
#[tauri::command]
fn get_initial_file(state: tauri::State<InitialFile>) -> Option<String> {
    let mut guard = state.0.lock().unwrap();
    let result = guard.take();
    println!("DEBUG: get_initial_file called, returning: {:?}", result);
    result
}
