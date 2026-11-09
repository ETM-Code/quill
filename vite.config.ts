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

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  plugins: [markdownItEntitiesShim()],
  build: {
    rollupOptions: {
      // keepalive.html is the no-JS page for the hidden keepalive window
      input: ["index.html", "keepalive.html"],
    },
  },
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
