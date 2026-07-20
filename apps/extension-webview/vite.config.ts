import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * The webview is bundled into the extension's dist/webview folder so it ships
 * inside the .vsix. Output is a single index.js + index.css (no hashing) so the
 * ChatViewProvider can reference stable paths.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "../extension/dist/webview"),
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: {
      input: resolve(__dirname, "src/main.tsx"),
      output: {
        entryFileNames: "index.js",
        assetFileNames: "index.[ext]",
        chunkFileNames: "[name].js",
      },
    },
  },
});
