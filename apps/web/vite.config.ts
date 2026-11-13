import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:3000", changeOrigin: false } },
  },
  preview: { port: 4173, proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:3000" } } },
  build: {
    outDir: "dist",
    target: ["es2022", "chrome109", "firefox115", "safari16.4"],
    sourcemap: "hidden",
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          router: ["react-router-dom"],
          intl: ["react-intl"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
