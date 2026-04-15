import type { ModelDefinition } from "../types";

/** whisper.cpp ggml models (quantized) — same URLs as the upstream browser demo. */
export const WHISPER_CPP_MODELS: ModelDefinition[] = [
  {
    id: "wc-tiny-q5",
    label: "Tiny (Q5_1)",
    engineModelId: "ggml-tiny-q5_1.bin",
    sizeBytes: 31 * 1024 * 1024,
    recommendedFor: "Smallest whisper.cpp build. Good for a first test of the WASM runtime.",
    quantized: true
  },
  {
    id: "wc-base-q5",
    label: "Base (Q5_1)",
    engineModelId: "ggml-base-q5_1.bin",
    sizeBytes: 57 * 1024 * 1024,
    recommendedFor: "Better accuracy than Tiny with a larger download.",
    quantized: true
  },
  {
    id: "wc-small-q5",
    label: "Small (Q5_1)",
    engineModelId: "ggml-small-q5_1.bin",
    sizeBytes: 190_085_487,
    recommendedFor: "Stronger than Base with a larger download. Best on desktop Chrome/Edge.",
    quantized: true,
    minimumDeviceMemoryGb: 8
  }
];

export const DEFAULT_WHISPER_CPP_MODEL_ID = WHISPER_CPP_MODELS[0]!.id;

const DOWNLOAD_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

export function whisperCppModelDownloadUrl(model: ModelDefinition): string {
  return `${DOWNLOAD_BASE}${model.engineModelId}`;
}

export function getWhisperCppModelDefinition(modelId: string): ModelDefinition {
  const model = WHISPER_CPP_MODELS.find((entry) => entry.id === modelId);
  if (!model) {
    throw new Error(`Unknown whisper.cpp model: ${modelId}`);
  }
  return model;
}
