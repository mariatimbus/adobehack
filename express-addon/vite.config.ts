import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Panel (iframe UI) build.
export default defineConfig({
  plugins: [react()],
  root: "src/ui",
  base: "./", // relative asset paths — the Adobe CLI serves the panel under a prefix
  publicDir: "../../assets-public",
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/ui/index.html",
    },
  },
  server: {
    port: 5241,
  },
});
