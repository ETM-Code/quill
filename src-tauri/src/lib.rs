use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default, Debug)]
struct OpenFileState {
    frontend_ready: bool,
    pending_files: Vec<String>,
}

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);

fn collect_file_paths(files: &[PathBuf]) -> Vec<String> {
    files
        .iter()
        .filter_map(|f| f.to_str().map(std::string::ToString::to_string))
        .collect()
}

fn drain_pending_files(state: &Mutex<OpenFileState>) -> Vec<String> {
    let mut guard = state.lock().expect("open-file state mutex poisoned");
    guard.frontend_ready = true;
    std::mem::take(&mut guard.pending_files)
}

fn reset_state_for_new_window(
    state: &Mutex<OpenFileState>,
    files: &[PathBuf],
) {
    let mut guard = state.lock().expect("open-file state mutex poisoned");
    guard.frontend_ready = false;
    guard.pending_files = collect_file_paths(files);
}

#[tauri::command]
fn register_frontend_ready(
    state: tauri::State<'_, Mutex<OpenFileState>>,
) -> Vec<String> {
    drain_pending_files(&state)
}

fn build_init_script(files: &[PathBuf]) -> String {
    // Convert files to JS array string
    let files_js = files
        .iter()
        .filter_map(|f| f.to_str())
        .map(|f| {
            let escaped = f.replace('\\', "\\\\").replace('"', "\\\"");
            format!("\"{}\"", escaped)
        })
        .collect::<Vec<_>>()
        .join(",");

    if files.is_empty() {
        "window.openedFiles = []; console.log('INIT SCRIPT: No files');".to_string()
    } else {
        format!("window.openedFiles = [{}]; console.log('INIT SCRIPT: Files =', window.openedFiles); document.title = 'LOADING: ' + window.openedFiles[0];", files_js)
    }
}

fn create_editor_window(
    app: &tauri::AppHandle,
    label: &str,
    files: Vec<PathBuf>,
    reset_state: bool,
) {
    if reset_state {
        let state = app.state::<Mutex<OpenFileState>>();
        reset_state_for_new_window(&state, &files);
    }

    let init_script = build_init_script(&files);
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .initialization_script(&init_script)
        .title("Quill")
        .inner_size(900.0, 700.0)
        .min_inner_size(400.0, 300.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .devtools(true)
        .build()
        .expect("failed to create window");

    // Open devtools automatically for debugging
    #[cfg(debug_assertions)]
    window.open_devtools();
}

fn next_window_label() -> String {
    let id = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("doc-{id}")
}

fn handle_file_associations(app: &tauri::AppHandle, files: Vec<PathBuf>) {
    println!("DEBUG: handle_file_associations called with {} files", files.len());

    if files.is_empty() {
        if app.get_webview_window("main").is_none() {
            println!("DEBUG: Creating empty main window");
            create_editor_window(app, "main", vec![], true);
        }
        return;
    }

    if app.get_webview_window("main").is_none() {
        println!("DEBUG: No main window, creating main window with first file");
        let mut iter = files.into_iter();
        if let Some(first) = iter.next() {
            create_editor_window(app, "main", vec![first], true);
        }

        for file in iter {
            let label = next_window_label();
            println!("DEBUG: Creating additional window {label} for file");
            create_editor_window(app, &label, vec![file], false);
        }
        return;
    }

    // Main window already exists: open each external file in a new window
    for file in files {
        let label = next_window_label();
        println!("DEBUG: Main exists, opening file in new window {label}");
        create_editor_window(app, &label, vec![file], false);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(OpenFileState::default()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![register_frontend_ready])
        .setup(|app| {
            // Check command line args for files (works on all platforms)
            let mut files = Vec::new();
            for maybe_file in std::env::args().skip(1) {
                if maybe_file.starts_with('-') {
                    continue;
                }
                let path = PathBuf::from(&maybe_file);
                if path.exists() {
                    println!("DEBUG: Found file in args: {:?}", path);
                    files.push(path);
                }
            }

            println!("DEBUG: setup - found {} files in args", files.len());

            // On Windows/Linux, create window immediately with files
            #[cfg(any(windows, target_os = "linux"))]
            {
                handle_file_associations(app.handle(), files);
            }

            // On macOS, if we have files from args, create window with them
            // Otherwise wait for RunEvent::Opened or Ready
            #[cfg(target_os = "macos")]
            {
                if !files.is_empty() {
                    println!("DEBUG: macOS - creating window with files from args");
                    handle_file_associations(app.handle(), files);
                }
                // If no files, window will be created in RunEvent::Ready or Opened
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    println!("DEBUG: RunEvent::Opened with {} URLs", urls.len());
                    let files = urls
                        .into_iter()
                        .filter_map(|url| {
                            println!("DEBUG: URL = {:?}", url);
                            url.to_file_path().ok()
                        })
                        .collect::<Vec<_>>();

                    handle_file_associations(app, files);
                }
                tauri::RunEvent::Ready => {
                    println!("DEBUG: RunEvent::Ready");
                    // On macOS, if no window exists yet (no files opened), create one
                    #[cfg(target_os = "macos")]
                    {
                        let app_handle = app.clone();
                        std::thread::spawn(move || {
                            // Small delay to let Opened event fire first if there is one
                            std::thread::sleep(std::time::Duration::from_millis(100));
                            if app_handle.get_webview_window("main").is_none() {
                                println!("DEBUG: No window after Ready, creating empty one");
                                handle_file_associations(&app_handle, vec![]);
                            }
                        });
                    }
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queues_files_when_frontend_not_ready() {
        let state = Mutex::new(OpenFileState::default());
        reset_state_for_new_window(
            &state,
            &vec![PathBuf::from("/tmp/a.md"), PathBuf::from("/tmp/b.md")],
        );
        let guard = state.lock().expect("state lock");
        assert_eq!(
            guard.pending_files,
            vec!["/tmp/a.md".to_string(), "/tmp/b.md".to_string()]
        );
        assert!(!guard.frontend_ready);
    }

    #[test]
    fn drains_pending_files_and_marks_frontend_ready() {
        let state = Mutex::new(OpenFileState {
            frontend_ready: false,
            pending_files: vec!["/tmp/queued.md".to_string()],
        });

        let drained = drain_pending_files(&state);
        assert_eq!(drained, vec!["/tmp/queued.md".to_string()]);

        let guard = state.lock().expect("state lock");
        assert!(guard.frontend_ready);
        assert!(guard.pending_files.is_empty());
    }

    #[test]
    fn dispatches_immediately_after_frontend_ready() {
        let state = Mutex::new(OpenFileState {
            frontend_ready: true,
            pending_files: vec!["/tmp/old.md".to_string()],
        });

        let drained = drain_pending_files(&state);
        assert_eq!(drained, vec!["/tmp/old.md".to_string()]);

        let guard = state.lock().expect("state lock");
        assert!(guard.pending_files.is_empty());
        assert!(guard.frontend_ready);
    }

    #[test]
    fn collects_only_valid_utf8_file_paths() {
        let files = vec![PathBuf::from("/tmp/one.md"), PathBuf::from("/tmp/two.md")];
        assert_eq!(
            collect_file_paths(&files),
            vec!["/tmp/one.md".to_string(), "/tmp/two.md".to_string()]
        );
    }

    #[test]
    fn reset_state_for_new_window_marks_not_ready_and_queues_files() {
        let state = Mutex::new(OpenFileState {
            frontend_ready: true,
            pending_files: vec!["/tmp/old.md".to_string()],
        });
        let files = vec![PathBuf::from("/tmp/new-a.md"), PathBuf::from("/tmp/new-b.md")];

        reset_state_for_new_window(&state, &files);

        let guard = state.lock().expect("state lock");
        assert!(!guard.frontend_ready);
        assert_eq!(
            guard.pending_files,
            vec!["/tmp/new-a.md".to_string(), "/tmp/new-b.md".to_string()]
        );
    }

    #[test]
    fn next_window_label_generates_expected_prefix() {
        let label = next_window_label();
        assert!(label.starts_with("doc-"));
    }
}
