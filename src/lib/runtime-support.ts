import { AUTO_LANGUAGE_MAX_RELIABLE_SECONDS } from "../constants";
import type { LanguageCode, ModelDefinition } from "../types";

type NavigatorWithDeviceMemory = Navigator & {
  deviceMemory?: number;
};

export function getReportedDeviceMemory(): number | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  const deviceMemory = (navigator as NavigatorWithDeviceMemory).deviceMemory;
  return typeof deviceMemory === "number" && Number.isFinite(deviceMemory) ? deviceMemory : null;
}

export function getModelRuntimeWarning(
  model: ModelDefinition,
  deviceMemory: number | null
): string | null {
  if (!model.minimumDeviceMemoryGb || deviceMemory === null) {
    return null;
  }

  if (deviceMemory >= model.minimumDeviceMemoryGb) {
    return null;
  }

  return `${model.label} usually needs a browser reporting at least ${model.minimumDeviceMemoryGb} GB of device memory. This browser reports ${deviceMemory} GB, so transcription may fail.`;
}

export function getAutoLanguageWarning(
  language: LanguageCode,
  durationSeconds: number | null
): string | null {
  if (language !== "auto" || durationSeconds === null) {
    return null;
  }

  if (durationSeconds <= AUTO_LANGUAGE_MAX_RELIABLE_SECONDS) {
    return null;
  }

  return "Auto detect can truncate longer recordings in browser Whisper. Choose the spoken language manually before starting transcription.";
}
