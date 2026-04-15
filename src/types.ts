export type TranscriptionBackendId = "transformers" | "whispercpp";

export interface WhisperCppRuntimeCapabilities {
  crossOriginIsolated: boolean;
  simd: boolean;
  pthreads: boolean;
}

export type LanguageCode = "auto" | "it" | "en" | "fr" | "de" | "es" | "pt";

export interface ModelDefinition {
  id: string;
  label: string;
  engineModelId: string;
  quantized?: boolean;
  sizeBytes: number;
  recommendedFor: string;
  minimumDeviceMemoryGb?: number;
}

export interface TranscriptionRequest {
  language: LanguageCode;
  modelId: string;
  chunkSeconds: number;
  overlapSeconds: number;
  /** whisper.cpp only — thread count passed to WASM binding */
  threads?: number;
  /** whisper.cpp only — translate to English */
  translate?: boolean;
}

export interface DecodedAudioPayload {
  sampleRate: number;
  samples: Float32Array;
  durationSeconds: number;
}

export type ProgressStage =
  | "bootstrap"
  | "download"
  | "decode"
  | "prepare"
  | "transcribe"
  | "finalize";

export interface TranscriptionProgress {
  stage: ProgressStage;
  percent: number;
  message: string;
  chunkIndex?: number;
  chunkCount?: number;
}

export interface ModelInstallState {
  modelId: string;
  installed: boolean;
  pending: boolean;
  sizeBytes: number;
  updatedAt?: number;
  error?: string;
}

export interface TranscriptResult {
  text: string;
  durationSeconds: number;
  elapsedMs: number;
  outputName: string;
}

export type WorkerRequestMessage =
  | { type: "init" }
  | { type: "ensureModel"; modelId: string; downloadUrl?: string; sizeBytes?: number }
  | { type: "deleteModel"; modelId: string }
  | {
      type: "transcribe";
      request: TranscriptionRequest;
      audio: DecodedAudioPayload;
      outputName: string;
    }
  | { type: "cancel" };

export type WorkerEventMessage =
  | {
      type: "ready";
      available: boolean;
      capabilities?: WhisperCppRuntimeCapabilities;
    }
  | { type: "modelState"; state: ModelInstallState }
  | { type: "progress"; progress: TranscriptionProgress }
  | { type: "result"; result: TranscriptResult }
  | { type: "error"; message: string };

export interface InstallPromptState {
  canInstall: boolean;
  prompt: (() => Promise<void>) | null;
}
