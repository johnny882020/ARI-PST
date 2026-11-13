import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@ari/design-system": resolve(__dirname, "../src/index.ts") } },
  build: { outDir: resolve(__dirname, "dist"), emptyOutDir: true },
});
