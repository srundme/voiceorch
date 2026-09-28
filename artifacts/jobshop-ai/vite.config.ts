import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dialPlugin } from "./dial";

export default defineConfig(({ mode }) => ({
  plugins: [react(), dialPlugin(mode)],
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
}));
