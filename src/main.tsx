import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";

const DEV_BROWSER_RESET_KEY = "__whisperdrop_dev_browser_reset__";

async function clearDevServiceWorkers(): Promise<void> {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return;
  }

  if (!("serviceWorker" in navigator) || !("sessionStorage" in window)) {
    return;
  }

  if (sessionStorage.getItem(DEV_BROWSER_RESET_KEY) === "done") {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  if (registrations.length === 0) {
    sessionStorage.setItem(DEV_BROWSER_RESET_KEY, "done");
    return;
  }

  await Promise.all(registrations.map((registration) => registration.unregister()));

  if ("caches" in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
  }

  sessionStorage.setItem(DEV_BROWSER_RESET_KEY, "done");
  window.location.reload();
}

if (import.meta.env.PROD) {
  registerSW({
    immediate: true
  });
} else {
  void clearDevServiceWorkers();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
