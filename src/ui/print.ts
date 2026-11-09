// Print / Save as PDF. The native print dialog (macOS: PDF menu) comes from the
// Rust `print_window` command; the print stylesheet lives in views.css.
import './views.css'

export async function printDocument(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('print_window')
  } catch {
    // Browser/harness or older shell: let the webview handle it.
    window.print()
  }
}
