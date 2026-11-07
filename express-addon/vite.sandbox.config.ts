import { defineConfig } from "vite";

// Document sandbox build: the Adobe sandbox runtime resolves these module
// specifiers itself, so they stay external in the bundle.
export default defineConfig({
  build: {
    outDir: "dist/sandbox",
    emptyOutDir: true,
    lib: {
      entry: "src/sandbox/code.ts",
      formats: ["es"],
      fileName: () => "code.js",
    },
    rollupOptions: {
      external: ["express-document-sdk", "add-on-sdk-document-sandbox"],
    },
  },
});
