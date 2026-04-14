export type LanguageCode = "auto" | "it" | "en" | "fr" | "de" | "es" | "pt";

export interface ModelDefinition {
  id: string;
  label: string;
  engineModelId: string;
  quantized?: boolean;
  sizeBytes: number;
  recommendedFor: string;
}

export interface TranscriptionRequest {
  language: LanguageCode;
  modelId: string;
  chunkSeconds: number;
  overlapSeconds: number;
}

export interface DecodedAudioPayload {
  sampleRate: number;
  samples: Float32Array;
  durationSeconds: number;
}

export type ProgressStage = "download" | "decode" | "transcribe" | "finalize";

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
  | { type: "ensureModel"; modelId: string }
  | { type: "deleteModel"; modelId: string }
  | {
      type: "transcribe";
      request: TranscriptionRequest;
      audio: DecodedAudioPayload;
      outputName: string;
    }
  | { type: "cancel" };

export type WorkerEventMessage =
  | { type: "ready"; available: boolean }
  | { type: "modelState"; state: ModelInstallState }
  | { type: "progress"; progress: TranscriptionProgress }
  | { type: "result"; result: TranscriptResult }
  | { type: "error"; message: string };

export interface InstallPromptState {
  canInstall: boolean;
  prompt: (() => Promise<void>) | null;
}
