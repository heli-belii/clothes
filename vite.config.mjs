import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { wardrobeImportApi } from "./scripts/import-job-api.mjs";
import { wardrobeOutfitApi } from "./scripts/outfit-api.mjs";
import { wardrobeTasteApi } from "./scripts/taste-api.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "127.0.0.1",
      allowedHosts: ["localhost"],
      fs: {
        deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/data/**", "**/AGENTS.local.md", "**/.aws/**", "**/.codex/**"],
      },
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      allowedHosts: ["localhost"],
    },
    plugins: [react(), wardrobeImportApi({ env }), wardrobeOutfitApi({ env }), wardrobeTasteApi({ env })],
  };
});
