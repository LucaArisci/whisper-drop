import type {
  ModelInstallState,
  TranscriptResult,
  TranscriptionProgress,
  WhisperCppRuntimeCapabilities,
  WorkerEventMessage,
  WorkerRequestMessage
} from "../types";

export interface WorkerListeners {
  onReady?: (available: boolean, capabilities?: WhisperCppRuntimeCapabilities) => void;
  onModelState?: (state: ModelInstallState) => void;
  onProgress?: (progress: TranscriptionProgress) => void;
  onResult?: (result: TranscriptResult) => void;
  onError?: (message: string) => void;
}

function formatWorkerError(prefix: string, event: ErrorEvent): string {
  const parts = [prefix, event.message].filter(Boolean);
  if (event.filename) {
    parts.push(`${event.filename}:${event.lineno}:${event.colno}`);
  }
  return parts.join(" ");
}

export class TranscriptionWorkerClient {
  private readonly worker: Worker;

  constructor(listeners: WorkerListeners) {
    this.worker = new Worker(new URL("../workers/transcriber.worker.ts", import.meta.url), {
      type: "module"
    });

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
      listeners.onError?.(formatWorkerError("Transcription worker crashed.", event));
    });

    this.worker.addEventListener("messageerror", () => {
      listeners.onError?.("Transcription worker sent an unreadable message.");
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
