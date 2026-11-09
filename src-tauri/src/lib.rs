use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use url::form_urlencoded;

/// Dirty (unsaved changes) flags per window label; consulted on app quit.
#[derive(Default)]
struct DirtyState(Mutex<HashMap<String, bool>>);

/// Recent files reported by the frontend; rendered in File > Open Recent.
#[derive(Default)]
struct RecentFiles(Mutex<Vec<String>>);

/// Document path shown in each window (by label), so following a link to a
/// file that is already open focuses that window instead of opening a twin.
#[derive(Default)]
struct WindowPaths(Mutex<HashMap<String, String>>);

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);

/// When the process started; a file opened this soon after launch replaces the
/// blank startup window instead of sitting beside it.
static STARTED: OnceLock<Instant> = OnceLock::new();

/// Label of the blank window created at startup when no file had arrived yet.
#[cfg(target_os = "macos")]
static STARTUP_BLANK: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
fn read_markdown_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))
}

/// Write image bytes to `path`, creating parent directories (e.g. `assets/`)
/// as needed. Used when pasting/dropping images next to the document.
#[tauri::command]
fn write_image_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    std::fs::write(&target, &contents).map_err(|e| format!("failed to write {path}: {e}"))
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

fn new_window(app: tauri::AppHandle) {
    let label = next_window_label();
    create_editor_window(&app, &label, vec![], None);
}

#[tauri::command]
fn set_window_path(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WindowPaths>,
    path: Option<String>,
) {
    let mut guard = state.0.lock().expect("window paths mutex poisoned");
    match path {
        Some(p) => guard.insert(window.label().to_string(), canonical_string(&p)),
        None => guard.remove(window.label()),
    };
}

fn canonical_string(path: &str) -> String {
    std::fs::canonicalize(path)
        .ok()
        .and_then(|p| p.to_str().map(ToString::to_string))
        .unwrap_or_else(|| path.to_string())
}

/// Open a markdown file from a link or drop: focus the window that already
/// shows it, else open a new window. `anchor` (a heading slug) is scrolled to.
#[tauri::command]
fn open_markdown_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, WindowPaths>,
    path: String,
    anchor: Option<String>,
) -> Result<(), String> {
    if !std::path::Path::new(&path).is_file() {
        return Err(format!("File not found: {path}"));
    }
    let wanted = canonical_string(&path);
    let existing = {
        let guard = state.0.lock().expect("window paths mutex poisoned");
        guard
            .iter()
            .find(|(_, p)| **p == wanted)
            .map(|(label, _)| label.clone())
    };
    if let Some(window) = existing.and_then(|label| app.get_webview_window(&label)) {
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(anchor) = anchor {
            let _ = window.emit("scroll-to-anchor", anchor);
        }
        return Ok(());
    }
    let label = next_window_label();
    create_editor_window(&app, &label, vec![PathBuf::from(path)], anchor.as_deref());
    Ok(())
}

/// Extensions that run code when "opened"; links to these need confirmation.
fn is_executable_like(path: &std::path::Path) -> bool {
    const RISKY: &[&str] = &[
        "app", "command", "tool", "sh", "bash", "zsh", "csh", "py", "rb", "pl", "terminal",
        "pkg", "mpkg", "dmg", "jar", "scpt", "applescript", "workflow", "action", "exe", "bat",
        "cmd", "ps1", "webloc", "inetloc", "fileloc",
    ];
    let ext_risky = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| RISKY.contains(&e.to_ascii_lowercase().as_str()));
    #[cfg(unix)]
    let exec_bit = {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    };
    #[cfg(not(unix))]
    let exec_bit = false;
    ext_risky || exec_bit
}

/// Open a local file or folder with its default app (folders open in
/// Finder). Programs and scripts are refused unless `confirmed` (the
/// frontend asks the user first).
#[tauri::command]
fn open_local_path(app: tauri::AppHandle, path: String, confirmed: bool) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let target = std::path::Path::new(&path);
    if !target.exists() {
        return Err(format!("File not found: {path}"));
    }
    if !confirmed && is_executable_like(target) {
        return Err("needs-confirmation".to_string());
    }
    app.opener()
        .open_path(path.clone(), None::<&str>)
        .map_err(|e| format!("failed to open {path}: {e}"))
}

/// Show a file selected in Finder.
#[tauri::command]
fn reveal_local_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("failed to reveal {path}: {e}"))
}

/// Copy a dropped file into `<doc_dir>/assets/`, keeping its name. Reuses an
/// identical existing copy; otherwise picks `name-1.ext`, `name-2.ext`, ...
/// Returns the markdown-relative path (`assets/<name>`).
#[tauri::command]
fn import_asset(source: String, doc_dir: String) -> Result<String, String> {
    let src = PathBuf::from(&source);
    let bytes = std::fs::read(&src).map_err(|e| format!("failed to read {source}: {e}"))?;
    let assets = PathBuf::from(&doc_dir).join("assets");
    std::fs::create_dir_all(&assets)
        .map_err(|e| format!("failed to create {}: {e}", assets.display()))?;
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();
    let ext = src.extension().and_then(|s| s.to_str()).map(ToString::to_string);
    for n in 0..1000 {
        let name = match (&ext, n) {
            (Some(ext), 0) => format!("{stem}.{ext}"),
            (Some(ext), n) => format!("{stem}-{n}.{ext}"),
            (None, 0) => stem.clone(),
            (None, n) => format!("{stem}-{n}"),
        };
        let candidate = assets.join(&name);
        match std::fs::read(&candidate) {
            Ok(existing) if existing == bytes => return Ok(format!("assets/{name}")),
            Ok(_) => {}
            Err(_) => {
                std::fs::write(&candidate, &bytes)
                    .map_err(|e| format!("failed to write {}: {e}", candidate.display()))?;
                return Ok(format!("assets/{name}"));
            }
        }
    }
    Err("too many files with the same name in assets/".to_string())
}

/// Native print dialog for the calling window (Save as PDF lives there).
#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| format!("print failed: {e}"))
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

fn build_window_url(files: &[PathBuf], anchor: Option<&str>) -> WebviewUrl {
    if let Some(path) = files.first().and_then(|f| f.to_str()) {
        let mut query = form_urlencoded::Serializer::new(String::new());
        query.append_pair("open", path);
        if let Some(anchor) = anchor {
            query.append_pair("anchor", anchor);
        }
        let query = query.finish();
        return WebviewUrl::App(format!("index.html?{query}").into());
    }

    WebviewUrl::App("index.html".into())
}

fn create_editor_window(app: &tauri::AppHandle, label: &str, files: Vec<PathBuf>, anchor: Option<&str>) {
    let init_script = build_init_script(&files);
    let window_url = build_window_url(&files, anchor);
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
            std::thread::sleep(Duration::from_secs(2));
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
            create_editor_window(app, "main", vec![], None);
        }
        return;
    }

    if app.get_webview_window("main").is_none() {
        let mut iter = files.into_iter();
        if let Some(first) = iter.next() {
            create_editor_window(app, "main", vec![first], None);
        }

        for file in iter {
            let label = next_window_label();
            create_editor_window(app, &label, vec![file], None);
        }
        return;
    }

    // Main window already exists: open each external file in a new window
    for file in files {
        let label = next_window_label();
        create_editor_window(app, &label, vec![file], None);
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
        .item(
            &MenuItemBuilder::with_id("print", "Print / Export PDF…")
                .accelerator("CmdOrCtrl+P")
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
        .item(
            &MenuItemBuilder::with_id("copy-plain", "Copy as Plain Text")
                .accelerator("Alt+Shift+CmdOrCtrl+C")
                .build(app)?,
        )
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

    // Format and View menus mostly mirror editor keymaps: the web view sees
    // key events first, so a shortcut the editor handles never reaches the
    // menu. The items make the shortcuts discoverable and clickable.
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, label);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };
    let heading_menu = SubmenuBuilder::new(app, "Heading")
        .item(&item("format-paragraph", "Paragraph", Some("CmdOrCtrl+0"))?)
        .separator()
        .item(&item("format-h1", "Heading 1", Some("CmdOrCtrl+1"))?)
        .item(&item("format-h2", "Heading 2", Some("CmdOrCtrl+2"))?)
        .item(&item("format-h3", "Heading 3", Some("CmdOrCtrl+3"))?)
        .item(&item("format-h4", "Heading 4", Some("CmdOrCtrl+4"))?)
        .item(&item("format-h5", "Heading 5", Some("CmdOrCtrl+5"))?)
        .item(&item("format-h6", "Heading 6", Some("CmdOrCtrl+6"))?)
        .build()?;
    let insert_menu = SubmenuBuilder::new(app, "Insert")
        .item(&item("insert-table", "Table", Some("Alt+CmdOrCtrl+T"))?)
        .item(&item("insert-image", "Image…", None)?)
        .item(&item("insert-rule", "Divider", None)?)
        .item(&item("insert-math", "Math Block", None)?)
        .item(&item("insert-mermaid", "Mermaid Diagram", None)?)
        .build()?;
    let format_menu = SubmenuBuilder::new(app, "Format")
        .item(&item("format-bold", "Bold", Some("CmdOrCtrl+B"))?)
        .item(&item("format-italic", "Italic", Some("CmdOrCtrl+I"))?)
        .item(&item("format-underline", "Underline", Some("CmdOrCtrl+U"))?)
        .item(&item("format-strike", "Strikethrough", Some("Shift+CmdOrCtrl+X"))?)
        .item(&item("format-highlight", "Highlight", Some("Shift+CmdOrCtrl+H"))?)
        .item(&item("format-code", "Inline Code", Some("CmdOrCtrl+E"))?)
        .item(&item("format-math", "Inline Math", Some("Shift+CmdOrCtrl+M"))?)
        .item(&item("format-link", "Link…", Some("CmdOrCtrl+K"))?)
        .item(&item("format-clear", "Clear Formatting", Some("CmdOrCtrl+\\"))?)
        .separator()
        .item(&heading_menu)
        .item(&item("format-bullet", "Bulleted List", Some("Shift+CmdOrCtrl+8"))?)
        .item(&item("format-ordered", "Numbered List", Some("Shift+CmdOrCtrl+7"))?)
        .item(&item("format-task", "Task List", Some("Shift+CmdOrCtrl+9"))?)
        .item(&item("format-quote", "Quote", Some("Shift+CmdOrCtrl+B"))?)
        .item(&item("format-codeblock", "Code Block", Some("Alt+CmdOrCtrl+C"))?)
        .separator()
        .item(&insert_menu)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&item("toggle-source", "Markdown Source", Some("CmdOrCtrl+/"))?)
        .item(&item("toggle-outline", "Outline", Some("Shift+CmdOrCtrl+O"))?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &format_menu,
            &view_menu,
            &window_menu,
        ])
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
                    create_editor_window(app, &label, vec![PathBuf::from(path)], None);
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
    STARTED.get_or_init(Instant::now);
    tauri::Builder::default()
        .manage(DirtyState::default())
        .manage(RecentFiles::default())
        .manage(WindowPaths::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_markdown_file,
            write_image_file,
            set_window_dirty,
            update_recent_files,
            set_window_path,
            open_markdown_window,
            open_local_path,
            reveal_local_path,
            import_asset,
            print_window
        ])
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<DirtyState>();
                let mut guard = state.0.lock().expect("dirty state mutex poisoned");
                guard.remove(window.label());
                let paths = window.app_handle().state::<WindowPaths>();
                paths
                    .0
                    .lock()
                    .expect("window paths mutex poisoned")
                    .remove(window.label());
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
                    let opened_any = !files.is_empty();

                    handle_file_associations(app, files);

                    // A file that arrives just after launch (Finder double-click on a
                    // cold start) replaces the blank window Ready already made.
                    let blank = STARTUP_BLANK.lock().ok().and_then(|mut b| b.take());
                    let early = STARTED
                        .get()
                        .is_some_and(|t| t.elapsed() < Duration::from_secs(3));
                    if let (true, true, Some(label)) = (opened_any, early, blank) {
                        if let Some(window) = app.get_webview_window(&label) {
                            let _ = window.destroy();
                        }
                    }
                }
                tauri::RunEvent::Ready => {
                    // On macOS, if no window exists yet (no file arrived), create one.
                    #[cfg(target_os = "macos")]
                    {
                        if app.webview_windows().keys().all(|l| l == "keepalive") {
                            handle_file_associations(app, vec![]);
                            if let Ok(mut blank) = STARTUP_BLANK.lock() {
                                *blank = Some("main".to_string());
                            }
                        }
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
                            create_editor_window(app, &label, vec![], None);
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

    #[test]
    fn write_image_file_creates_parent_dirs_and_writes_bytes() {
        let dir = std::env::temp_dir().join("quill-img-test");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("assets").join("img-deadbeef.png");
        let bytes = vec![0x89u8, 0x50, 0x4e, 0x47];
        write_image_file(path.to_string_lossy().to_string(), bytes.clone()).expect("write image");
        assert_eq!(std::fs::read(&path).expect("read back"), bytes);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
