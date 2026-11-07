import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Panel (iframe UI) build.
export default defineConfig({
  plugins: [react()],
  root: "src/ui",
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
