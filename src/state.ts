import { DEFAULT_LANGUAGE, DEFAULT_MODEL_ID } from "./constants";
import { DEFAULT_TRANSCRIPTION_BACKEND } from "./lib/transcription-backend";
import type {
  InstallPromptState,
  ModelInstallState,
  TranscriptionBackendId,
  TranscriptResult,
  TranscriptionProgress,
  WhisperCppRuntimeCapabilities
} from "./types";

export interface AppState {
  transcriptionBackend: TranscriptionBackendId;
  whisperCapabilities: WhisperCppRuntimeCapabilities | null;
  modelId: string;
  language: string;
  installState: InstallPromptState;
  selectedFile: File | null;
  selectedDuration: number | null;
  transcript: TranscriptResult | null;
  progress: TranscriptionProgress | null;
  busy: boolean;
  error: string | null;
  workerReady: boolean;
  localRuntime: boolean;
  models: Record<string, ModelInstallState>;
}

export const initialAppState: AppState = {
  transcriptionBackend: DEFAULT_TRANSCRIPTION_BACKEND,
  whisperCapabilities: null,
  modelId: DEFAULT_MODEL_ID,
  language: DEFAULT_LANGUAGE,
  installState: {
    canInstall: false,
    prompt: null
  },
  selectedFile: null,
  selectedDuration: null,
  transcript: null,
  progress: null,
  busy: false,
  error: null,
  workerReady: false,
  localRuntime: false,
  models: {}
};
