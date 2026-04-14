import type {
  ModelInstallState,
  TranscriptResult,
  TranscriptionProgress,
  WorkerEventMessage,
  WorkerRequestMessage
} from "../types";

export interface WorkerListeners {
  onReady?: (available: boolean) => void;
  onModelState?: (state: ModelInstallState) => void;
  onProgress?: (progress: TranscriptionProgress) => void;
  onResult?: (result: TranscriptResult) => void;
  onError?: (message: string) => void;
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
          listeners.onReady?.(message.available);
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
