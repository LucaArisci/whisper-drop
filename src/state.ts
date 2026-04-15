import { DEFAULT_LANGUAGE } from "./constants";
import { DEFAULT_WHISPER_CPP_MODEL_ID } from "./lib/whispercpp-models";
import type {
  InstallPromptState,
  ModelInstallState,
  TranscriptResult,
  TranscriptionProgress,
  WhisperCppRuntimeCapabilities
} from "./types";

export interface AppState {
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
  whisperCapabilities: null,
  modelId: DEFAULT_WHISPER_CPP_MODEL_ID,
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
