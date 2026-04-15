import type { TranscriptionBackendId } from "../types";

export const TRANSCRIPTION_BACKENDS: Array<{
  id: TranscriptionBackendId;
  label: string;
  description: string;
}> = [
  {
    id: "transformers",
    label: "Transformers.js + ONNX",
    description: "Default engine using Hugging Face models in the browser cache."
  },
  {
    id: "whispercpp",
    label: "whisper.cpp (experimental)",
    description: "Official ggml whisper.cpp WASM build (tiny/base Q5_1). Needs a cross-origin isolated context for threads."
  }
];

export const DEFAULT_TRANSCRIPTION_BACKEND: TranscriptionBackendId = "transformers";
