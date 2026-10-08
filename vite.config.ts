import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor libraries so the app shell loads and caches faster.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          data: ["@tanstack/react-query", "axios", "date-fns", "zod", "react-hook-form"],
          motion: ["framer-motion"]
        }
      }
    }
  },
  server: {
    port: 5173,
    // Localhost only by default: in single-user mode the API has no login, so it
    // must not be reachable from other devices on the network. Opt in with VITE_HOST=0.0.0.0.
    host: process.env.VITE_HOST || "127.0.0.1",
    watch: {
      // Never watch runtime data. On Windows a recording MP4 is locked while
      // FFmpeg writes it, and watching it crashed Vite with EBUSY mid-meeting.
      ignored: [
        "**/recordings/**",
        "**/transcripts/**",
        "**/meeting-notes/**",
        "**/browser-profile/**",
        "**/logs/**",
        "**/.secrets/**",
        "**/chroma-data/**",
        "**/server/**"
      ]
    },
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:5000",
        changeOrigin: true
      }
    }
  }
});
