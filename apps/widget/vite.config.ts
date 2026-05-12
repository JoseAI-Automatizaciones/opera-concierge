import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import path from "node:path";

/**
 * Vite config for the Opera Concierge embeddable widget.
 *
 * Library mode produces a single self-contained IIFE bundle that the
 * dashboard serves at /widget.js. Output goes directly into the dashboard's
 * public/ folder so a single Vercel deploy can serve both the dashboard UI
 * and the widget script.
 *
 * For development (vite dev), Vite serves `index.html` as a playground that
 * simulates being embedded on a customer site.
 */
export default defineConfig({
  plugins: [preact()],

  build: {
    outDir: path.resolve(__dirname, "../dashboard/public"),
    emptyOutDir: false, // dashboard/public also contains logo.png, favicon.png
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "src/main.tsx"),
      formats: ["iife"],
      name: "OperaConcierge",
      fileName: () => "widget.js",
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },

  server: {
    port: 5174,
  },
});
