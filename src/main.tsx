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

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element");
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boot-shell" style={{ textAlign: "left", maxWidth: 640, margin: "0 auto" }}>
          <p>
            <strong>WhisperDrop crashed while starting.</strong>
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 13,
              color: "rgba(255,255,255,0.85)"
            }}
          >
            {this.state.error.message}
          </pre>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.72)" }}>
            Open the browser developer console for the full stack trace, then reload after fixing the
            error.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
