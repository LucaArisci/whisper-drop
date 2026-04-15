import { env, pipeline } from "@xenova/transformers";
import { buildAudioChunks } from "../../lib/chunking";
import { normalizeOrtRuntimeError } from "../../lib/runtime-support";
import { resolveTranscriptText } from "../../lib/text";
import { getModelDefinition } from "../../lib/storage";
import type { DecodedAudioPayload, LanguageCode, TranscriptionProgress } from "../../types";

type ProgressCallback = (progress: TranscriptionProgress) => void;

export interface EngineTranscribeOptions {
  modelId: string;
  audio: DecodedAudioPayload;
  language: LanguageCode;
  chunkSeconds: number;
  overlapSeconds: number;
  onProgress: ProgressCallback;
  shouldCancel: () => boolean;
}

type ProgressInfo = {
  status?: "initiate" | "download" | "progress" | "done";
  file?: string;
  progress?: number;
};

type ChunkInfo = {
  is_last?: boolean;
};

type TranscriberResultChunk = {
  text?: string;
};

type TranscriberResult = {
  text?: string;
  chunks?: TranscriberResultChunk[];
};

type BrowserTranscriber = ((
  audio: Float32Array,
  options?: Record<string, unknown>
) => Promise<{ text: string }>) & {
  dispose?: () => Promise<void> | void;
};

const LANGUAGE_NAMES: Record<Exclude<LanguageCode, "auto">, string> = {
  it: "italian",
  en: "english",
  fr: "french",
  de: "german",
  es: "spanish",
  pt: "portuguese"
};

const DEFAULT_FETCH = globalThis.fetch.bind(globalThis);
const LOCAL_ORT_WASM_PATH = "/ort/";
const downloadProgressTracker = {
  modelId: null as string | null,
  fileProgress: new Map<string, number>(),
  lastPercent: 0
};

let runtimeConfigured = false;
let activeModelId: string | null = null;
let activeTranscriber: BrowserTranscriber | null = null;
let transcriberPromise: Promise<BrowserTranscriber> | null = null;

function configureRuntime(): void {
  if (runtimeConfigured) {
    return;
  }

  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.useFSCache = false;
  env.useFS = false;
  env.localModelPath = "/__transformers_local__/";

  if (env.backends.onnx?.wasm) {
    // Keep the ONNX runtime assets same-origin so the app can reuse them offline.
    env.backends.onnx.wasm.wasmPaths = LOCAL_ORT_WASM_PATH;
    env.backends.onnx.wasm.numThreads = 1;
  }

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const pathname = new URL(requestUrl, self.location.origin).pathname;

    if (pathname.startsWith(env.localModelPath)) {
      return new Response("", {
        status: 404,
        statusText: "Not Found"
      });
    }

    return DEFAULT_FETCH(input, init);
  };

  runtimeConfigured = true;
}

function relayModelLoadProgress(
  modelId: string,
  info: unknown,
  onProgress: ProgressCallback
): void {
  const model = getModelDefinition(modelId);
  const progressInfo = info as ProgressInfo;
  const fileKey = progressInfo.file ?? `${modelId}:model`;

  if (downloadProgressTracker.modelId !== modelId) {
    downloadProgressTracker.modelId = modelId;
    downloadProgressTracker.fileProgress = new Map();
    downloadProgressTracker.lastPercent = 0;
  }

  const currentFileProgress = downloadProgressTracker.fileProgress.get(fileKey) ?? 0;
  switch (progressInfo.status) {
    case "initiate":
    case "download":
      downloadProgressTracker.fileProgress.set(fileKey, currentFileProgress);
      break;
    case "progress":
      downloadProgressTracker.fileProgress.set(
        fileKey,
        Math.max(currentFileProgress, progressInfo.progress ?? 0)
      );
      break;
    case "done":
      downloadProgressTracker.fileProgress.set(fileKey, 100);
      break;
    default:
      break;
  }

  const trackedValues = [...downloadProgressTracker.fileProgress.values()];
  const totalFiles = Math.max(1, trackedValues.length);
  const completedFiles = trackedValues.filter((value) => value >= 100).length;
  const aggregatePercent =
    trackedValues.length > 0
      ? trackedValues.reduce((sum, value) => sum + value, 0) / trackedValues.length
      : 0;
  const percent = Math.max(downloadProgressTracker.lastPercent, aggregatePercent);
  downloadProgressTracker.lastPercent = percent;

  const fileSummary =
    totalFiles > 1
      ? ` (${completedFiles}/${totalFiles} files ready)`
      : completedFiles > 0
        ? " (files ready)"
        : "";

  switch (progressInfo.status) {
    case "initiate":
      onProgress({
        stage: "download",
        percent,
        message: `Preparing ${model.label}${fileSummary}...`
      });
      break;
    case "download":
      onProgress({
        stage: "download",
        percent,
        message: `Downloading ${model.label}${fileSummary}...`
      });
      break;
    case "progress":
      onProgress({
        stage: "download",
        percent,
        message: `Downloading ${model.label}${fileSummary}...`
      });
      break;
    case "done":
      onProgress({
        stage: "download",
        percent,
        message:
          completedFiles >= totalFiles
            ? `${model.label} is ready for offline use.`
            : `Downloading ${model.label}${fileSummary}...`
      });
      break;
    default:
      break;
  }
}

async function disposeActiveTranscriber(): Promise<void> {
  if (!activeTranscriber) {
    return;
  }

  try {
    await activeTranscriber.dispose?.();
  } catch {
    // no-op
  }

  activeTranscriber = null;
  activeModelId = null;
}

function normalizeLoadError(error: unknown, modelId: string, localOnly: boolean): Error {
  const message = error instanceof Error ? error.message : String(error);
  const model = getModelDefinition(modelId);

  if (
    localOnly &&
    /local_files_only|file was not found locally|attempted to load a remote file/i.test(message)
  ) {
    return new Error(
      `${model.label} is not fully cached locally anymore. Download it again before transcribing.`
    );
  }

  return error instanceof Error ? error : new Error(message);
}

async function getTranscriber(
  modelId: string,
  localOnly: boolean,
  onProgress?: ProgressCallback
): Promise<BrowserTranscriber> {
  configureRuntime();
  env.allowLocalModels = localOnly;

  if (activeModelId === modelId && activeTranscriber) {
    return activeTranscriber;
  }

  if (activeModelId === modelId && transcriberPromise) {
    return transcriberPromise;
  }

  await disposeActiveTranscriber();

  const model = getModelDefinition(modelId);
  onProgress?.({
    stage: "download",
    percent: 0,
    message: localOnly
      ? `Checking ${model.label} in the local browser cache...`
      : `Starting ${model.label} download...`
  });

  transcriberPromise = pipeline("automatic-speech-recognition", model.engineModelId, {
    quantized: model.quantized ?? true,
    local_files_only: localOnly,
    progress_callback: (info: unknown) => {
      if (onProgress) {
        relayModelLoadProgress(modelId, info, onProgress);
      }
    }
  }) as Promise<BrowserTranscriber>;

  try {
    activeTranscriber = await transcriberPromise;
    activeModelId = modelId;
    return activeTranscriber;
  } catch (error) {
    throw normalizeLoadError(error, modelId, localOnly);
  } finally {
    transcriberPromise = null;
  }
}

function resolveLanguage(language: LanguageCode): string | undefined {
  if (language === "auto") {
    return undefined;
  }

  return LANGUAGE_NAMES[language];
}

export async function ensureTransformersModel(
  modelId: string,
  onProgress: ProgressCallback
): Promise<void> {
  await getTranscriber(modelId, false, onProgress);
}

export async function dropLoadedTransformersModel(modelId: string): Promise<void> {
  if (activeModelId !== modelId) {
    return;
  }

  await disposeActiveTranscriber();
}

export async function transcribeWithTransformers(
  options: EngineTranscribeOptions
): Promise<string> {
  const { audio, chunkSeconds, overlapSeconds, onProgress, shouldCancel } = options;
  const estimatedChunkCount = buildAudioChunks(
    audio.samples,
    audio.sampleRate,
    chunkSeconds,
    overlapSeconds
  ).length;
  let completedChunks = 0;

  onProgress({
    stage: "finalize",
    percent: 10,
    message: "Loading the local transcription runtime..."
  });

  const transcriber = await getTranscriber(options.modelId, true, onProgress);
  if (shouldCancel()) {
    throw new Error("Transcription cancelled.");
  }

  const model = getModelDefinition(options.modelId);
  let result: TranscriberResult;

  try {
    result = await transcriber(audio.samples, {
      top_k: 0,
      do_sample: false,
      chunk_length_s: chunkSeconds,
      stride_length_s: overlapSeconds,
      ...(options.language === "auto"
        ? {}
        : {
            language: resolveLanguage(options.language),
            task: "transcribe"
          }),
      force_full_sequences: false,
      chunk_callback: (_chunk: ChunkInfo) => {
        completedChunks = Math.min(estimatedChunkCount, completedChunks + 1);
        onProgress({
          stage: "transcribe",
          percent: (completedChunks / estimatedChunkCount) * 100,
          message: `Transcribing chunk ${completedChunks} of ${estimatedChunkCount}...`,
          chunkIndex: completedChunks,
          chunkCount: estimatedChunkCount
        });
      }
    });
  } catch (error) {
    throw normalizeOrtRuntimeError(error, model);
  }

  if (shouldCancel()) {
    throw new Error("Transcription cancelled.");
  }

  const transcriptText = resolveTranscriptText(result as TranscriberResult);
  if (!transcriptText) {
    throw new Error(
      options.language === "auto"
        ? "Automatic language detection produced an empty transcript. Try selecting the language manually."
        : "The model produced an empty transcript."
    );
  }

  return transcriptText;
}
