// Print / Save as PDF. The native print dialog (macOS: PDF menu) comes from the
// Rust `print_window` command; the print stylesheet lives in views.css.
import './views.css'
import { whenMathReady } from '../math-render'

export async function printDocument(): Promise<void> {
  // Equations still showing LaTeX source (KaTeX loading) must be typeset before the page prints.
  await whenMathReady()
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('print_window')
  } catch {
    // Browser/harness or older shell: let the webview handle it.
    window.print()
  }
}
