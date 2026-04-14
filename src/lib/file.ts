import { SUPPORTED_AUDIO_TYPES } from "../constants";

export function fileExtension(name: string): string {
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 ? name.slice(lastDot).toLowerCase() : "";
}

export function isSupportedAudioFile(file: File): boolean {
  return SUPPORTED_AUDIO_TYPES.has(fileExtension(file.name));
}
