import type { LanguageCode, ModelDefinition } from "./types";

export const SUPPORTED_AUDIO_TYPES = new Set([
  ".wav",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg"
]);

export const LANGUAGE_OPTIONS: Array<{ label: string; value: LanguageCode }> = [
  { label: "Auto detect", value: "auto" },
  { label: "Italian", value: "it" },
  { label: "English", value: "en" },
  { label: "French", value: "fr" },
  { label: "German", value: "de" },
  { label: "Spanish", value: "es" },
  { label: "Portuguese", value: "pt" }
];

export const MODELS: ModelDefinition[] = [
  {
    id: "tiny",
    label: "Tiny",
    engineModelId: "Xenova/whisper-tiny",
    quantized: true,
    sizeBytes: 88 * 1024 * 1024,
    recommendedFor: "Best default for mobile and first runs. Fast to install and gentle on memory."
  },
  {
    id: "base",
    label: "Base",
    engineModelId: "Xenova/whisper-base",
    quantized: true,
    sizeBytes: 162 * 1024 * 1024,
    recommendedFor: "Balanced quality for everyday desktop use with a moderate download size."
  },
  {
    id: "small",
    label: "Small",
    engineModelId: "Xenova/whisper-small",
    quantized: true,
    sizeBytes: 249105759,
    recommendedFor: "Noticeably stronger than Base, but heavier to download and slower on low-end devices."
  },
  {
    id: "medium",
    label: "Medium",
    engineModelId: "Xenova/whisper-medium",
    quantized: true,
    sizeBytes: 776129634,
    recommendedFor: "Highest accuracy in this app. Best reserved for strong desktop hardware and long waits."
  }
];

export const DEFAULT_MODEL_ID = MODELS[0].id;
export const DEFAULT_LANGUAGE = LANGUAGE_OPTIONS[0].value;
export const DEFAULT_CHUNK_SECONDS = 30;
export const DEFAULT_OVERLAP_SECONDS = 2;
