/// <reference lib="webworker" />
import { MODELS } from "../constants";
import {
  clearModelCache,
  getModelDefinition,
  listInstalledModels,
  markModelInstalled,
  markModelRemoved
} from "../lib/storage";
import {
  dropLoadedTransformersModel,
  ensureTransformersModel,
  transcribeWithTransformers
} from "./engine/transformersEngine";
import type {
  TranscriptResult,
  TranscriptionRequest,
  TranscriptionProgress,
  WorkerEventMessage,
  WorkerRequestMessage
} from "../types";

declare const self: DedicatedWorkerGlobalScope;

let cancelRequested = false;

function post(message: WorkerEventMessage): void {
  self.postMessage(message);
}

function progress(progressUpdate: TranscriptionProgress): void {
  post({
    type: "progress",
    progress: progressUpdate
  });
}

async function emitModelStates(): Promise<void> {
  const states = await listInstalledModels();
  states.forEach((state) => {
    post({
      type: "modelState",
      state
    });
  });
}

async function ensureModel(modelId: string): Promise<void> {
  try {
    post({
      type: "modelState",
      state: {
        modelId,
        installed: false,
        pending: true,
        sizeBytes: getModelDefinition(modelId).sizeBytes
      }
    });

    progress({
      stage: "download",
      percent: 0,
      message: `Preparing ${getModelDefinition(modelId).label} for local use...`
    });

    await ensureTransformersModel(modelId, (progressUpdate) => {
      progress(progressUpdate);
    });
    await markModelInstalled(modelId);

    post({
      type: "modelState",
      state: {
        modelId,
        installed: true,
        pending: false,
        sizeBytes: getModelDefinition(modelId).sizeBytes,
        updatedAt: Date.now()
      }
    });
  } catch (error) {
    post({
      type: "modelState",
      state: {
        modelId,
        installed: false,
        pending: false,
        sizeBytes: getModelDefinition(modelId).sizeBytes,
        error: error instanceof Error ? error.message : "Model download failed."
      }
    });
    throw error;
  }
}

function outputFileName(request: TranscriptionRequest, fallback: string): string {
  if (request.language === "auto") {
    return fallback;
  }

  return `${fallback.replace(/\.txt$/i, "")}.${request.language}.txt`;
}

async function transcribe(
  request: TranscriptionRequest,
  audio: { sampleRate: number; samples: Float32Array; durationSeconds: number },
  outputName: string
): Promise<void> {
  cancelRequested = false;
  const startedAt = performance.now();

  progress({
    stage: "finalize",
    percent: 0,
    message: "Preparing the local transcription runtime..."
  });

  const text = await transcribeWithTransformers({
    modelId: request.modelId,
    audio,
    language: request.language,
    chunkSeconds: request.chunkSeconds,
    overlapSeconds: request.overlapSeconds,
    onProgress: progress,
    shouldCancel: () => cancelRequested
  });

  if (cancelRequested) {
    throw new Error("Transcription cancelled.");
  }

  progress({
    stage: "finalize",
    percent: 100,
    message: "Transcript ready."
  });

  const result: TranscriptResult = {
    text,
    durationSeconds: audio.durationSeconds,
    elapsedMs: performance.now() - startedAt,
    outputName: outputFileName(request, outputName)
  };

  post({
    type: "result",
    result
  });
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequestMessage>) => {
  try {
    switch (event.data.type) {
      case "init":
        post({
          type: "ready",
          available: true
        });
        await emitModelStates();
        break;
      case "ensureModel":
        await ensureModel(event.data.modelId);
        break;
      case "deleteModel":
        await dropLoadedTransformersModel(event.data.modelId);
        await clearModelCache(event.data.modelId);
        await markModelRemoved(event.data.modelId);
        post({
          type: "modelState",
          state: {
            modelId: event.data.modelId,
            installed: false,
            pending: false,
            sizeBytes: getModelDefinition(event.data.modelId).sizeBytes
          }
        });
        break;
      case "cancel":
        cancelRequested = true;
        break;
      case "transcribe":
        await transcribe(event.data.request, event.data.audio, event.data.outputName);
        break;
      default:
        break;
    }
  } catch (error) {
    post({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "The worker failed before transcription could finish."
    });
  }
});

