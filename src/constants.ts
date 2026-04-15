import type { LanguageCode } from "./types";

export const SUPPORTED_AUDIO_TYPES = new Set([
  ".wav",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg"
]);

export const LANGUAGE_OPTIONS: Array<{ label: string; value: LanguageCode }> = [
  { label: "Auto detect (short clips)", value: "auto" },
  { label: "Italian", value: "it" },
  { label: "English", value: "en" },
  { label: "French", value: "fr" },
  { label: "German", value: "de" },
  { label: "Spanish", value: "es" },
  { label: "Portuguese", value: "pt" }
];

export const DEFAULT_LANGUAGE = LANGUAGE_OPTIONS[0].value;
export const AUTO_LANGUAGE_MAX_RELIABLE_SECONDS = 120;
