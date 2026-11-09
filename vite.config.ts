import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";

// markdown-it's named-entity decoder pulls in the `entities` package (~21 KB
// gzip). In the production bundle, decode through the browser instead.
// harness/fidelity-gate.ts checks the shim against `entities` in WebKit.
function markdownItEntitiesShim(): Plugin {
  const shim = fileURLToPath(new URL("./src/markdown/entities-shim.ts", import.meta.url));
  return {
    name: "quill-markdown-it-entities",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "entities" && importer && /[\\/]markdown-it[\\/]/.test(importer)) return shim;
      return null;
    },
  };
}

// KaTeX is imported statically by @tiptap/extension-mathematics, which would
// put the whole engine in the main chunk. Re-route that one import to
// src/katex-lazy.ts so KaTeX (JS + CSS) loads only when a math node renders.
function katexLazy(): Plugin {
  const stub = fileURLToPath(new URL("./src/katex-lazy.ts", import.meta.url));
  return {
    name: "quill-katex-lazy",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "katex" && importer && /[\\/]@tiptap[\\/]extension-mathematics[\\/]/.test(importer)) return stub;
      return null;
    },
  };
}

// The webviews Quill runs in (WKWebView, Safari 13+) only ever load woff2.
// katex.min.css lists woff2, woff and ttf for every face and Vite would emit
// and embed all three (~590 KB brotli). Keep the woff2 source only.
function katexWoff2Only(): Plugin {
  return {
    name: "quill-katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/katex(\.min)?\.css(\?|$)/.test(id)) return null;
      const out = code.replace(/,url\([^)]*\.(?:woff|ttf)\) format\("[^"]*"\)/g, "");
      return out === code ? null : { code: out, map: null };
    },
  };
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    rollupOptions: {
      // keepalive.html is the no-JS page for the hidden keepalive window
      input: ["index.html", "keepalive.html"],
    },
  },
  plugins: [markdownItEntitiesShim(), katexLazy(), katexWoff2Only()],
  // Served as-is in dev so katexLazy() sees its `katex` import (a prebundle would inline the real one).
  optimizeDeps: { exclude: ["@tiptap/extension-mathematics"] },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
