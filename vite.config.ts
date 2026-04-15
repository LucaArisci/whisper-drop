import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    // Listen on all local addresses so both http://127.0.0.1 and http://localhost work
    // (some tools open one or the other; 127.0.0.1-only can leave "localhost" with a blank page).
    host: true,
    port: 24680,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless"
    }
  },
  preview: {
    host: true,
    port: 27272,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless"
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "WhisperDrop",
        short_name: "WhisperDrop",
        description: "Local-first Whisper transcription in your browser.",
        theme_color: "#07140c",
        background_color: "#07140c",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "document",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-cache"
            }
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/whispercpp/"),
            handler: "CacheFirst",
            options: {
              cacheName: "whispercpp-static",
              expiration: {
                maxEntries: 8
              }
            }
          }
        ]
      }
    })
  ],
  worker: {
    format: "es"
  },
  build: {
    target: "es2022"
  }
});
