import { DEFAULT_LANGUAGE, DEFAULT_MODEL_ID } from "./constants";
import type {
  InstallPromptState,
  ModelInstallState,
  TranscriptResult,
  TranscriptionProgress
} from "./types";

export interface AppState {
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
