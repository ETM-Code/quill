use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use url::form_urlencoded;

#[derive(Default, Debug)]
struct OpenFileState {
    frontend_ready: bool,
    pending_files: Vec<String>,
}

/// Dirty (unsaved changes) flags per window label; consulted on app quit.
#[derive(Default)]
struct DirtyState(Mutex<HashMap<String, bool>>);

/// Recent files reported by the frontend; rendered in File > Open Recent.
#[derive(Default)]
struct RecentFiles(Mutex<Vec<String>>);

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

fn reset_state_for_new_window(state: &Mutex<OpenFileState>, files: &[PathBuf]) {
    let mut guard = state.lock().expect("open-file state mutex poisoned");
    guard.frontend_ready = false;
    guard.pending_files = collect_file_paths(files);
}

#[tauri::command]
fn register_frontend_ready(state: tauri::State<'_, Mutex<OpenFileState>>) -> Vec<String> {
    drain_pending_files(&state)
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))
}

#[tauri::command]
fn set_window_dirty(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DirtyState>,
    dirty: bool,
) {
    let mut guard = state.0.lock().expect("dirty state mutex poisoned");
    guard.insert(window.label().to_string(), dirty);
}

#[tauri::command]
fn update_recent_files(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecentFiles>,
    paths: Vec<String>,
) {
    {
        let mut guard = state.0.lock().expect("recent files mutex poisoned");
        *guard = paths;
    }
    if let Err(e) = install_menu(&app) {
        eprintln!("failed to rebuild menu: {e}");
    }
}

#[tauri::command]
fn new_window(app: tauri::AppHandle) {
    let label = next_window_label();
    create_editor_window(&app, &label, vec![], false);
}

fn build_init_script(files: &[PathBuf]) -> String {
    let files_js = files
        .iter()
        .filter_map(|f| f.to_str())
        .map(|f| {
            let escaped = f.replace('\\', "\\\\").replace('"', "\\\"");
            format!("\"{}\"", escaped)
        })
        .collect::<Vec<_>>()
        .join(",");

    format!("window.openedFiles = [{}];", files_js)
}

fn build_window_url(files: &[PathBuf]) -> WebviewUrl {
    if let Some(path) = files.first().and_then(|f| f.to_str()) {
        let query = form_urlencoded::Serializer::new(String::new())
            .append_pair("open", path)
            .finish();
        return WebviewUrl::App(format!("index.html?{query}").into());
    }

    WebviewUrl::App("index.html".into())
}

fn create_editor_window(app: &tauri::AppHandle, label: &str, files: Vec<PathBuf>, reset_state: bool) {
    if reset_state {
        let state = app.state::<Mutex<OpenFileState>>();
        reset_state_for_new_window(&state, &files);
    }

    let init_script = build_init_script(&files);
    let window_url = build_window_url(&files);
    let window = WebviewWindowBuilder::new(app, label, window_url)
        .initialization_script(&init_script)
        .title("Quill")
        .visible(false)
        .inner_size(900.0, 700.0)
        .min_inner_size(400.0, 300.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .devtools(cfg!(debug_assertions))
        .build()
        .expect("failed to create window");

    #[cfg(debug_assertions)]
    window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = &window;

    // Safety net: if the frontend-driven show() never happens, force-show.
    if label != "keepalive" {
        let app_handle = app.clone();
        let label = label.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if let Some(window) = app_handle.get_webview_window(&label) {
                if let Ok(false) = window.is_visible() {
                    let _ = window.show();
                }
            }
        });
    }
}

fn ensure_keepalive_window(app: &tauri::AppHandle) {
    if app.get_webview_window("keepalive").is_some() {
        return;
    }

    // Loads a no-JS, no-CSS page: the keepalive webview should cost as little
    // memory as possible.
    let _keepalive = WebviewWindowBuilder::new(
        app,
        "keepalive",
        WebviewUrl::App("keepalive.html".into()),
    )
    .visible(false)
    .skip_taskbar(true)
    .focused(false)
    .inner_size(1.0, 1.0)
    .build()
    .expect("failed to create keepalive window");
}

fn next_window_label() -> String {
    let id = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("doc-{id}")
}

fn handle_file_associations(app: &tauri::AppHandle, files: Vec<PathBuf>) {
    if files.is_empty() {
        if app.get_webview_window("main").is_none() {
            create_editor_window(app, "main", vec![], true);
        }
        return;
    }

    if app.get_webview_window("main").is_none() {
        let mut iter = files.into_iter();
        if let Some(first) = iter.next() {
            create_editor_window(app, "main", vec![first], true);
        }

        for file in iter {
            let label = next_window_label();
            create_editor_window(app, &label, vec![file], false);
        }
        return;
    }

    // Main window already exists: open each external file in a new window
    for file in files {
        let label = next_window_label();
        create_editor_window(app, &label, vec![file], false);
    }
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

fn display_name(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

fn install_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let recents = {
        let state = app.state::<RecentFiles>();
        let guard = state.0.lock().expect("recent files mutex poisoned");
        guard.clone()
    };

    // Custom quit item: the predefined one sends terminate: directly, which
    // skips RunEvent::ExitRequested entirely, so the unsaved-changes guard
    // would never run. This routes ⌘Q through our menu handler instead.
    let app_menu = SubmenuBuilder::new(app, "Quill")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(
            &MenuItemBuilder::with_id("quit", "Quit Quill")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?,
        )
        .build()?;

    let mut open_recent = SubmenuBuilder::new(app, "Open Recent");
    if recents.is_empty() {
        let placeholder = MenuItemBuilder::with_id("recent-none", "No Recent Files")
            .enabled(false)
            .build(app)?;
        open_recent = open_recent.item(&placeholder);
    } else {
        for path in &recents {
            let item = MenuItemBuilder::with_id(format!("recent:{path}"), display_name(path))
                .build(app)?;
            open_recent = open_recent.item(&item);
        }
        open_recent = open_recent.separator().text("clear-recents", "Clear Menu");
    }
    let open_recent = open_recent.build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("new-window", "New Window")
                .accelerator("Shift+CmdOrCtrl+N")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(&open_recent)
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("save-as", "Save As…")
                .accelerator("Shift+CmdOrCtrl+S")
                .build(app)?,
        )
        .separator()
        .close_window()
        .build()?;

    // Undo/redo are custom items routed to ProseMirror's history; the
    // predefined ones would drive WebKit's native undo stack instead.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(
            &MenuItemBuilder::with_id("undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("redo", "Redo")
                .accelerator("Shift+CmdOrCtrl+Z")
                .build(app)?,
        )
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(
            &MenuItemBuilder::with_id("find", "Find…")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("find-replace", "Find and Replace…")
                .accelerator("Alt+CmdOrCtrl+F")
                .build(app)?,
        )
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

fn focused_editor_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.label() != "keepalive" && w.is_focused().unwrap_or(false))
        .cloned()
        .or_else(|| {
            windows
                .values()
                .find(|w| w.label() != "keepalive" && w.is_visible().unwrap_or(false))
                .cloned()
        })
}

fn handle_menu_event(app: &tauri::AppHandle, id: &str) {
    match id {
        "new-window" => {
            new_window(app.clone());
        }
        "quit" => {
            if confirm_quit_with_unsaved(app) {
                app.exit(0);
            }
        }
        "clear-recents" => {
            {
                let state = app.state::<RecentFiles>();
                state.0.lock().expect("recent files mutex poisoned").clear();
            }
            let _ = install_menu(app);
            if let Some(window) = focused_editor_window(app) {
                let _ = window.emit("menu", "clear-recents");
            }
        }
        _ => {
            if let Some(path) = id.strip_prefix("recent:") {
                if let Some(window) = focused_editor_window(app) {
                    let _ = window.emit("menu-open-path", path);
                } else {
                    let label = next_window_label();
                    create_editor_window(app, &label, vec![PathBuf::from(path)], false);
                }
                return;
            }

            if let Some(window) = focused_editor_window(app) {
                let _ = window.emit("menu", id);
            } else if matches!(id, "new" | "open") {
                // No editor window: create one (Open will be one ⌘O away).
                handle_file_associations(app, vec![]);
            }
        }
    }
}

/// True if quitting is OK (nothing dirty, or the user confirmed).
fn confirm_quit_with_unsaved(app: &tauri::AppHandle) -> bool {
    let dirty_count = any_window_dirty(app);
    if dirty_count == 0 {
        return true;
    }
    let message = if dirty_count == 1 {
        "A document has unsaved changes. Quit anyway?".to_string()
    } else {
        format!("{dirty_count} documents have unsaved changes. Quit anyway?")
    };
    app.dialog()
        .message(message)
        .title("Unsaved Changes")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".to_string(),
            "Cancel".to_string(),
        ))
        .blocking_show()
}

fn any_window_dirty(app: &tauri::AppHandle) -> usize {
    let state = app.state::<DirtyState>();
    let guard = state.0.lock().expect("dirty state mutex poisoned");
    guard
        .iter()
        .filter(|(label, dirty)| **dirty && app.get_webview_window(label).is_some())
        .count()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(OpenFileState::default()))
        .manage(DirtyState::default())
        .manage(RecentFiles::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            register_frontend_ready,
            read_markdown_file,
            set_window_dirty,
            update_recent_files,
            new_window
        ])
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<DirtyState>();
                let mut guard = state.0.lock().expect("dirty state mutex poisoned");
                guard.remove(window.label());
            }
        })
        .setup(|app| {
            install_menu(app.handle())?;

            // Check command line args for files (works on all platforms)
            let mut files = Vec::new();
            for maybe_file in std::env::args().skip(1) {
                if maybe_file.starts_with('-') {
                    continue;
                }
                let path = PathBuf::from(&maybe_file);
                if path.exists() {
                    files.push(path);
                }
            }

            #[cfg(any(windows, target_os = "linux"))]
            {
                handle_file_associations(app.handle(), files);
            }

            // On macOS, files can also arrive via RunEvent::Opened
            #[cfg(target_os = "macos")]
            {
                ensure_keepalive_window(app.handle());
                if !files.is_empty() {
                    handle_file_associations(app.handle(), files);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    let files = urls
                        .into_iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .collect::<Vec<_>>();

                    handle_file_associations(app, files);
                }
                tauri::RunEvent::Ready => {
                    // On macOS, if no window exists yet (no files opened), create one
                    #[cfg(target_os = "macos")]
                    {
                        let app_handle = app.clone();
                        std::thread::spawn(move || {
                            // Small delay to let Opened fire first if there is one
                            std::thread::sleep(std::time::Duration::from_millis(100));
                            if app_handle.get_webview_window("main").is_none() {
                                handle_file_associations(&app_handle, vec![]);
                            }
                        });
                    }
                }
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen {
                    has_visible_windows,
                    ..
                } => {
                    if !has_visible_windows {
                        // Reuse a hidden editor window if one exists, else create one
                        let existing = app
                            .webview_windows()
                            .values()
                            .find(|w| w.label() != "keepalive")
                            .cloned();
                        if let Some(window) = existing {
                            let _ = window.show();
                            let _ = window.set_focus();
                        } else {
                            let label = if app.get_webview_window("main").is_none() {
                                "main".to_string()
                            } else {
                                next_window_label()
                            };
                            create_editor_window(app, &label, vec![], label == "main");
                        }
                    }
                }
                tauri::RunEvent::ExitRequested { code, api, .. } => {
                    // Non-menu exit paths (e.g. dock quit) still get the guard.
                    if code.is_none() && !confirm_quit_with_unsaved(app) {
                        api.prevent_exit();
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
    fn collects_only_valid_utf8_file_paths() {
        let files = vec![PathBuf::from("/tmp/one.md"), PathBuf::from("/tmp/two.md")];
        assert_eq!(
            collect_file_paths(&files),
            vec!["/tmp/one.md".to_string(), "/tmp/two.md".to_string()]
        );
    }

    #[test]
    fn next_window_label_generates_expected_prefix() {
        let label = next_window_label();
        assert!(label.starts_with("doc-"));
    }

    #[test]
    fn read_markdown_file_returns_contents() {
        let path = "/tmp/quill-read-markdown-test.md";
        std::fs::write(path, "# ok\nbody").expect("write temp file");
        let content = read_markdown_file(path.to_string()).expect("read file");
        assert_eq!(content, "# ok\nbody");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn display_name_extracts_basename() {
        assert_eq!(display_name("/Users/x/notes/today.md"), "today.md");
        assert_eq!(display_name("plain.md"), "plain.md");
    }
}
