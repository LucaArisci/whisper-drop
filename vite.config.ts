import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    // Not 5173/5713: prefer this port; if busy Vite picks the next free one (strictPort: false).
    port: 24680,
    strictPort: false,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      // credentialless keeps cross-origin fetch usable without CORP on CDNs while enabling isolation features.
      "Cross-Origin-Embedder-Policy": "credentialless"
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 27272,
    strictPort: false,
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
            urlPattern: ({ url }) => url.pathname.startsWith("/ort/"),
            handler: "CacheFirst",
            options: {
              cacheName: "ort-cache",
              expiration: {
                maxEntries: 4
              }
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
  optimizeDeps: {
    include: ["@xenova/transformers"]
  },
  build: {
    target: "es2022"
  }
});
