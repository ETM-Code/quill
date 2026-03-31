use std::path::PathBuf;
use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use url::form_urlencoded;

macro_rules! debug_log {
    ($($arg:tt)*) => {
        #[cfg(debug_assertions)]
        println!($($arg)*);
    };
}

#[derive(Default, Debug)]
struct OpenFileState {
    frontend_ready: bool,
    pending_files: Vec<String>,
}

#[derive(Default, Debug)]
struct RecentFilesState {
    files: Vec<String>,
}

#[derive(Default, Debug)]
struct ModifiedWindowsState {
    labels: HashSet<String>,
}

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);
const MAX_RECENT_FILES: usize = 10;
const RECENT_FILE_STORAGE_NAME: &str = "recent-files.json";
const MENU_FILE_NEW_ID: &str = "file_new";
const MENU_FILE_OPEN_ID: &str = "file_open";
const MENU_FILE_SAVE_ID: &str = "file_save";
const MENU_FILE_PRINT_ID: &str = "file_print";
const MENU_FILE_CLOSE_ID: &str = "file_close";
const MENU_EDIT_FIND_ID: &str = "edit_find";
const MENU_FILE_OPEN_RECENT_PREFIX: &str = "file_open_recent_";
const MENU_FILE_CLEAR_RECENT_ID: &str = "file_clear_recent";
const MENU_EVENT_NEW: &str = "quill://menu-new";
const MENU_EVENT_OPEN: &str = "quill://menu-open";
const MENU_EVENT_SAVE: &str = "quill://menu-save";
const MENU_EVENT_PRINT: &str = "quill://menu-print";
const MENU_EVENT_OPEN_PATH: &str = "quill://menu-open-path";

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

fn normalize_recent_paths(paths: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for path in paths.iter().map(|p| p.trim()).filter(|p| !p.is_empty()) {
        if normalized.iter().any(|existing| existing == path) {
            continue;
        }
        normalized.push(path.to_string());
        if normalized.len() >= MAX_RECENT_FILES {
            break;
        }
    }
    normalized
}

fn recent_files_storage_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(RECENT_FILE_STORAGE_NAME))
}

fn load_recent_files<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<String> {
    let Some(path) = recent_files_storage_path(app) else {
        return vec![];
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return vec![];
    };
    let Ok(parsed) = serde_json::from_str::<Vec<String>>(&raw) else {
        return vec![];
    };
    normalize_recent_paths(&parsed)
}

fn persist_recent_files<R: tauri::Runtime>(app: &tauri::AppHandle<R>, files: &[String]) {
    let Some(path) = recent_files_storage_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(files) {
        let _ = std::fs::write(path, json);
    }
}

fn add_recent_file(state: &Mutex<RecentFilesState>, path: &str) -> Vec<String> {
    let mut guard = state.lock().expect("recent-files state mutex poisoned");
    guard.files.retain(|existing| existing != path);
    guard.files.insert(0, path.to_string());
    guard.files.truncate(MAX_RECENT_FILES);
    guard.files.clone()
}

fn clear_recent_files(state: &Mutex<RecentFilesState>) -> Vec<String> {
    let mut guard = state.lock().expect("recent-files state mutex poisoned");
    guard.files.clear();
    guard.files.clone()
}

fn format_recent_label(path: &str) -> String {
    let candidate = PathBuf::from(path);
    let filename = candidate
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path);
    let parent = candidate
        .parent()
        .and_then(|p| p.to_str())
        .filter(|p| !p.is_empty());
    match parent {
        Some(parent_path) => format!("{filename}  ({parent_path})"),
        None => filename.to_string(),
    }
}

fn build_app_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    recent_files: &[String],
) -> tauri::Result<Menu<R>> {
    let new_item = MenuItem::with_id(app, MENU_FILE_NEW_ID, "New", true, Some("CmdOrCtrl+N"))?;
    let open_item = MenuItem::with_id(app, MENU_FILE_OPEN_ID, "Open...", true, Some("CmdOrCtrl+O"))?;
    let save_item = MenuItem::with_id(app, MENU_FILE_SAVE_ID, "Save", true, Some("CmdOrCtrl+S"))?;
    let print_item = MenuItem::with_id(app, MENU_FILE_PRINT_ID, "Print...", true, Some("CmdOrCtrl+P"))?;
    let close_window = MenuItem::with_id(app, MENU_FILE_CLOSE_ID, "Close Window", true, Some("CmdOrCtrl+W"))?;
    let find_item = MenuItem::with_id(app, MENU_EDIT_FIND_ID, "Find", true, Some("CmdOrCtrl+F"))?;

    let mut recent_items: Vec<MenuItem<R>> = Vec::new();
    for (index, path) in recent_files.iter().enumerate() {
        recent_items.push(MenuItem::with_id(
            app,
            format!("{MENU_FILE_OPEN_RECENT_PREFIX}{index}"),
            format_recent_label(path),
            true,
            None::<&str>,
        )?);
    }

    let empty_recent_item = MenuItem::with_id(
        app,
        "file_open_recent_empty",
        "No Recent Files",
        false,
        None::<&str>,
    )?;
    let clear_recent_item = MenuItem::with_id(
        app,
        MENU_FILE_CLEAR_RECENT_ID,
        "Clear Menu",
        !recent_files.is_empty(),
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;

    let mut open_recent_refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = Vec::new();
    if recent_items.is_empty() {
        open_recent_refs.push(&empty_recent_item);
    } else {
        for item in &recent_items {
            open_recent_refs.push(item as &dyn tauri::menu::IsMenuItem<R>);
        }
    }
    open_recent_refs.push(&separator);
    open_recent_refs.push(&clear_recent_item);
    let open_recent_submenu = Submenu::with_items(app, "Open Recent", true, &open_recent_refs)?;

    let file_submenu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_item,
            &open_item,
            &open_recent_submenu,
            &save_item,
            &print_item,
            &close_window,
        ],
    )?;

    let edit_submenu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &find_item,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let app_submenu = Submenu::with_items(
        app,
        app.package_info().name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let view_submenu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window_submenu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let help_submenu = {
        let empty: [&dyn tauri::menu::IsMenuItem<R>; 0] = [];
        Submenu::with_items(app, "Help", true, &empty)?
    };

    #[cfg(not(target_os = "macos"))]
    let help_submenu = Submenu::with_items(
        app,
        "Help",
        true,
        &[&PredefinedMenuItem::about(app, None, None)?],
    )?;

    let mut top_level_menus: Vec<&dyn tauri::menu::IsMenuItem<R>> = Vec::new();
    #[cfg(target_os = "macos")]
    top_level_menus.push(&app_submenu);
    top_level_menus.push(&file_submenu);
    top_level_menus.push(&edit_submenu);
    #[cfg(target_os = "macos")]
    top_level_menus.push(&view_submenu);
    top_level_menus.push(&window_submenu);
    top_level_menus.push(&help_submenu);

    Menu::with_items(app, &top_level_menus)
}

fn install_app_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    recent_files: &[String],
) -> tauri::Result<()> {
    let menu = build_app_menu(app, recent_files)?;
    app.set_menu(menu)?;
    Ok(())
}

fn emit_open_path_event_to_active_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
) -> tauri::Result<()> {
    if let Some(window) = app
        .webview_windows()
        .into_iter()
        .find_map(|(_, window)| {
            if window.is_focused().unwrap_or(false) {
                Some(window)
            } else {
                None
            }
        })
    {
        return window.emit(MENU_EVENT_OPEN_PATH, path.to_string());
    }
    app.emit(MENU_EVENT_OPEN_PATH, path.to_string())
}

fn dispatch_dom_event_to_window<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event_name: &str,
) -> tauri::Result<()> {
    let Ok(event_json) = serde_json::to_string(event_name) else {
        return Ok(());
    };

    if let Some(webview) = window
        .webviews()
        .into_iter()
        .next()
    {
        return webview.eval(format!(
            "window.dispatchEvent(new CustomEvent({event_json}));"
        ));
    }

    Ok(())
}

fn handle_window_menu_event<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event: tauri::menu::MenuEvent,
) {
    let id = event.id().as_ref().to_string();

    if id == MENU_FILE_NEW_ID {
        let _ = window.emit(MENU_EVENT_NEW, ());
        return;
    }
    if id == MENU_FILE_OPEN_ID {
        let _ = window.emit(MENU_EVENT_OPEN, ());
        return;
    }
    if id == MENU_FILE_SAVE_ID {
        let _ = window.emit(MENU_EVENT_SAVE, ());
        return;
    }
    if id == MENU_FILE_PRINT_ID {
        let _ = window.emit(MENU_EVENT_PRINT, ());
        return;
    }
    if id == MENU_FILE_CLOSE_ID {
        let _ = window.close();
        return;
    }
    if id == MENU_EDIT_FIND_ID {
        let _ = dispatch_dom_event_to_window(window, "quill:menu-find");
    }
}

fn bind_window_close_guard<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let window_for_close = window.clone();

    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            let should_prompt = {
                let modified_state = app.state::<Mutex<ModifiedWindowsState>>();
                let guard = modified_state
                    .lock()
                    .expect("modified-windows state mutex poisoned");
                guard.labels.contains(&label)
            };

            if !should_prompt {
                return;
            }

            api.prevent_close();

            let app_handle = app.clone();
            let window_handle = window_for_close.clone();
            let label_for_remove = label.clone();
            app.dialog()
                .message("You have unsaved changes. Discard them?")
                .title("Unsaved Changes")
                .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Discard".to_string(),
                    "Cancel".to_string(),
                ))
                .show(move |confirmed| {
                    if !confirmed {
                        return;
                    }

                    {
                        let modified_state = app_handle.state::<Mutex<ModifiedWindowsState>>();
                        let mut guard = modified_state
                            .lock()
                            .expect("modified-windows state mutex poisoned");
                        guard.labels.remove(&label_for_remove);
                    }

                    let _ = window_handle.destroy();
                });
        }
    });
}

fn handle_menu_event(
    app: &tauri::AppHandle,
    event: tauri::menu::MenuEvent,
) {
    let id = event.id().as_ref().to_string();

    if id == MENU_FILE_CLEAR_RECENT_ID {
        let recent_state = app.state::<Mutex<RecentFilesState>>();
        let updated = clear_recent_files(&recent_state);
        persist_recent_files(app, &updated);
        let _ = install_app_menu(app, &updated);
        return;
    }
    if let Some(index_str) = id.strip_prefix(MENU_FILE_OPEN_RECENT_PREFIX) {
        if let Ok(index) = index_str.parse::<usize>() {
            let recent_state = app.state::<Mutex<RecentFilesState>>();
            let path = {
                let guard = recent_state
                    .lock()
                    .expect("recent-files state mutex poisoned");
                guard.files.get(index).cloned()
            };
            if let Some(path) = path {
                let _ = emit_open_path_event_to_active_window(app, &path);
            }
        }
    }
}

#[tauri::command]
fn register_frontend_ready(
    state: tauri::State<'_, Mutex<OpenFileState>>,
) -> Vec<String> {
    drain_pending_files(&state)
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))
}

#[tauri::command]
fn write_markdown_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("failed to write {path}: {e}"))
}

#[tauri::command]
fn track_recent_file(
    app: tauri::AppHandle,
    recent_state: tauri::State<'_, Mutex<RecentFilesState>>,
    path: String,
) {
    if path.trim().is_empty() {
        return;
    }
    let updated = add_recent_file(&recent_state, path.trim());
    persist_recent_files(&app, &updated);
    let _ = install_app_menu(&app, &updated);
}

#[tauri::command]
fn destroy_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let Some(window) = app.get_webview_window(label.trim()) else {
        return Err("window not found".to_string());
    };

    window.destroy().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_modified(
    modified_state: tauri::State<'_, Mutex<ModifiedWindowsState>>,
    label: String,
    modified: bool,
) {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return;
    }

    let mut guard = modified_state
        .lock()
        .expect("modified-windows state mutex poisoned");
    if modified {
        guard.labels.insert(trimmed.to_string());
    } else {
        guard.labels.remove(trimmed);
    }
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
        "window.openedFiles = [];".to_string()
    } else {
        format!(
            "window.openedFiles = [{}]; document.title = 'LOADING: ' + window.openedFiles[0];",
            files_js
        )
    }
}

fn build_window_url(files: &[PathBuf]) -> WebviewUrl {
    let mut query = form_urlencoded::Serializer::new(String::new());
    query.append_pair("platform", runtime_platform_name());

    if let Some(path) = files.first().and_then(|f| f.to_str()) {
        query.append_pair("open", path);
    }

    WebviewUrl::App(format!("index.html?{}", query.finish()).into())
}

fn runtime_platform_name() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(windows)]
    {
        "windows"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        "unknown"
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
    let window_url = build_window_url(&files);
    let builder = WebviewWindowBuilder::new(app, label, window_url)
        .initialization_script(&init_script)
        .title("Quill")
        .visible(true)
        .inner_size(900.0, 700.0)
        .min_inner_size(400.0, 300.0)
        .devtools(cfg!(debug_assertions));

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    let _window = builder
        .build()
        .expect("failed to create window");

    _window.on_menu_event(handle_window_menu_event);
    bind_window_close_guard(&_window);

    // Open devtools automatically for debugging
    #[cfg(debug_assertions)]
    _window.open_devtools();
}

fn ensure_keepalive_window(app: &tauri::AppHandle) {
    if app.get_webview_window("keepalive").is_some() {
        return;
    }

    let _keepalive = WebviewWindowBuilder::new(
        app,
        "keepalive",
        WebviewUrl::App("index.html?keepalive=1".into()),
    )
    .visible(false)
    .skip_taskbar(true)
    .focused(false)
    .build()
    .expect("failed to create keepalive window");
}

fn next_window_label() -> String {
    let id = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("doc-{id}")
}

fn handle_file_associations(app: &tauri::AppHandle, files: Vec<PathBuf>) {
    debug_log!("DEBUG: handle_file_associations called with {} files", files.len());

    if files.is_empty() {
        if app.get_webview_window("main").is_none() {
            debug_log!("DEBUG: Creating empty main window");
            create_editor_window(app, "main", vec![], true);
        }
        return;
    }

    if app.get_webview_window("main").is_none() {
        debug_log!("DEBUG: No main window, creating main window with first file");
        let mut iter = files.into_iter();
        if let Some(first) = iter.next() {
            create_editor_window(app, "main", vec![first], true);
        }

        for file in iter {
            let label = next_window_label();
            debug_log!("DEBUG: Creating additional window {label} for file");
            create_editor_window(app, &label, vec![file], false);
        }
        return;
    }

    // Main window already exists: open each external file in a new window
    for file in files {
        let label = next_window_label();
        debug_log!("DEBUG: Main exists, opening file in new window {label}");
        create_editor_window(app, &label, vec![file], false);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(OpenFileState::default()))
        .manage(Mutex::new(RecentFilesState::default()))
        .manage(Mutex::new(ModifiedWindowsState::default()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            register_frontend_ready,
            read_markdown_file,
            write_markdown_file,
            track_recent_file,
            destroy_window,
            set_window_modified
        ])
        .on_menu_event(handle_menu_event)
        .setup(|app| {
            let recent_files = load_recent_files(app.handle());
            {
                let recent_state = app.state::<Mutex<RecentFilesState>>();
                let mut guard = recent_state
                    .lock()
                    .expect("recent-files state mutex poisoned");
                guard.files = recent_files.clone();
            }
            install_app_menu(app.handle(), &recent_files)?;

            // Check command line args for files (works on all platforms)
            let mut files = Vec::new();
            for maybe_file in std::env::args().skip(1) {
                if maybe_file.starts_with('-') {
                    continue;
                }
                let path = PathBuf::from(&maybe_file);
                if path.exists() {
                    debug_log!("DEBUG: Found file in args: {:?}", path);
                    files.push(path);
                }
            }

            debug_log!("DEBUG: setup - found {} files in args", files.len());

            // On Windows/Linux, create window immediately with files
            #[cfg(any(windows, target_os = "linux"))]
            {
                handle_file_associations(app.handle(), files);
            }

            // On macOS, if we have files from args, create window with them
            // Otherwise wait for RunEvent::Opened or Ready
            #[cfg(target_os = "macos")]
            {
                ensure_keepalive_window(app.handle());
                if !files.is_empty() {
                    debug_log!("DEBUG: macOS - creating window with files from args");
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
                    debug_log!("DEBUG: RunEvent::Opened with {} URLs", urls.len());
                    let files = urls
                        .into_iter()
                        .filter_map(|url| {
                            debug_log!("DEBUG: URL = {:?}", url);
                            url.to_file_path().ok()
                        })
                        .collect::<Vec<_>>();

                    handle_file_associations(app, files);
                }
                tauri::RunEvent::Ready => {
                    debug_log!("DEBUG: RunEvent::Ready");
                    // On macOS, if no window exists yet (no files opened), create one
                    #[cfg(target_os = "macos")]
                    {
                        let app_handle = app.clone();
                        std::thread::spawn(move || {
                            // Small delay to let Opened event fire first if there is one
                            std::thread::sleep(std::time::Duration::from_millis(100));
                            if app_handle.get_webview_window("main").is_none() {
                                debug_log!("DEBUG: No window after Ready, creating empty one");
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
                    if !has_visible_windows && app.get_webview_window("main").is_none() {
                        debug_log!("DEBUG: Reopen with no visible windows, creating main window");
                        handle_file_associations(app, vec![]);
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

    #[test]
    fn read_markdown_file_returns_contents() {
        let path = "/tmp/quill-read-markdown-test.md";
        std::fs::write(path, "# ok\nbody").expect("write temp file");
        let content = read_markdown_file(path.to_string()).expect("read file");
        assert_eq!(content, "# ok\nbody");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn write_markdown_file_persists_contents() {
        let path = "/tmp/quill-write-markdown-test.md";
        write_markdown_file(path.to_string(), "# saved\nbody".to_string()).expect("write file");
        let content = std::fs::read_to_string(path).expect("read temp file");
        assert_eq!(content, "# saved\nbody");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn normalize_recent_paths_deduplicates_and_trims() {
        let input = vec![
            " /tmp/one.md ".to_string(),
            "".to_string(),
            "/tmp/two.md".to_string(),
            "/tmp/one.md".to_string(),
        ];
        assert_eq!(
            normalize_recent_paths(&input),
            vec!["/tmp/one.md".to_string(), "/tmp/two.md".to_string()]
        );
    }

    #[test]
    fn add_recent_file_moves_existing_to_front() {
        let state = Mutex::new(RecentFilesState {
            files: vec!["/tmp/a.md".to_string(), "/tmp/b.md".to_string()],
        });
        let updated = add_recent_file(&state, "/tmp/b.md");
        assert_eq!(
            updated,
            vec!["/tmp/b.md".to_string(), "/tmp/a.md".to_string()]
        );
    }

    #[test]
    fn build_window_url_includes_platform_query_for_empty_window() {
        let url = build_window_url(&vec![]);
        assert_eq!(
            url.to_string(),
            format!("index.html?platform={}", runtime_platform_name())
        );
    }

    #[test]
    fn build_window_url_includes_platform_and_open_path() {
        let files = vec![PathBuf::from("/tmp/hello world.md")];
        let url = build_window_url(&files);
        assert_eq!(
            url.to_string(),
            format!(
                "index.html?platform={}&open=%2Ftmp%2Fhello+world.md",
                runtime_platform_name()
            )
        );
    }
}
