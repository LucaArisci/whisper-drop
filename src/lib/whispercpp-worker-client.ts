import type { WorkerEventMessage, WorkerListeners, WorkerRequestMessage } from "../types";

function whisperCppBootstrapWorkerUrl(): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}whispercpp/bootstrap-worker.js`;
}

function formatWorkerError(prefix: string, event: ErrorEvent): string {
  const parts = [prefix, event.message].filter(Boolean);
  if (event.filename) {
    parts.push(`${event.filename}:${event.lineno}:${event.colno}`);
  }
  return parts.join(" ");
}

/**
 * Dedicated classic worker for whisper.cpp (see `public/whispercpp/bootstrap-worker.js`).
 * This keeps the heavy WASM transcription off the UI thread.
 */
export class WhisperCppWorkerClient {
  private readonly worker: Worker;

  constructor(listeners: WorkerListeners) {
    this.worker = new Worker(whisperCppBootstrapWorkerUrl());

    this.worker.addEventListener("message", (event: MessageEvent<WorkerEventMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "ready":
          listeners.onReady?.(message.available, message.capabilities);
          break;
        case "modelState":
          listeners.onModelState?.(message.state);
          break;
        case "progress":
          listeners.onProgress?.(message.progress);
          break;
        case "result":
          listeners.onResult?.(message.result);
          break;
        case "error":
          listeners.onError?.(message.message);
          break;
        default:
          break;
      }
    });

    this.worker.addEventListener("error", (event) => {
      listeners.onError?.(formatWorkerError("whisper.cpp worker crashed.", event));
    });

    this.worker.addEventListener("messageerror", () => {
      listeners.onError?.("whisper.cpp worker sent an unreadable message.");
    });
  }

  post(message: WorkerRequestMessage, transfer?: Transferable[]): void {
    if (transfer && transfer.length > 0) {
      this.worker.postMessage(message, transfer);
      return;
    }

    this.worker.postMessage(message);
  }

  terminate(): void {
    this.worker.terminate();
  }
}
