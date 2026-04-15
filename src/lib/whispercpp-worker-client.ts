import { readMainThreadCapabilities } from "./runtime-capabilities";
import { whisperCppStreamDownloadRatio } from "./whispercpp-download-progress";
import {
  getWhisperCppModelDefinition,
  whisperCppModelDownloadUrl,
  WHISPER_CPP_MODELS
} from "./whispercpp-models";
import { parseWhisperCppConsoleLines } from "./whispercpp-transcript";
import type {
  DecodedAudioPayload,
  ModelInstallState,
  TranscriptionProgress,
  WorkerRequestMessage
} from "../types";
import type { WorkerListeners } from "./worker-client";

type RuntimeModule = {
  init: (modelPath: string) => number;
  free?: (instance: number) => void;
  full_default: (
    instance: number,
    audio: Float32Array,
    language: string,
    nthreads: number,
    translate: boolean
  ) => number;
  FS_unlink: (path: string) => void;
  FS_createDataFile: (
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean
  ) => void;
  onRuntimeInitialized?: () => void;
  print?: (...args: unknown[]) => void;
  printErr?: (...args: unknown[]) => void;
  setStatus?: (text: string) => void;
  monitorRunDependencies?: (left: number) => void;
};

type RuntimeState = {
  runtimeReady: boolean;
  runtimePromise: Promise<RuntimeModule> | null;
  instance: number | null;
  loadedModelId: string | null;
  printBuffer: string[];
  cancelRequested: boolean;
  activeProgressEmitter: ((progress: TranscriptionProgress) => void) | null;
};

type GlobalWithWhisperRuntime = typeof globalThis & {
  Module?: RuntimeModule;
  __whisperCppRuntimeState?: RuntimeState;
};

const globalWithWhisper = globalThis as GlobalWithWhisperRuntime;

const DB_NAME = "whispercpp-worker-cache";
const DB_VERSION = 1;
const STORE = "models";

const runtimeState: RuntimeState =
  globalWithWhisper.__whisperCppRuntimeState ??
  (globalWithWhisper.__whisperCppRuntimeState = {
    runtimeReady: false,
    runtimePromise: null,
    instance: null,
    loadedModelId: null,
    printBuffer: [],
    cancelRequested: false,
    activeProgressEmitter: null
  });

function mainJsUrl(): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}whispercpp/main.js`;
}

function joinConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => (typeof arg === "string" ? arg : String(arg)))
    .join(" ")
    .trim();
}

function handleRuntimePrint(...args: unknown[]): void {
  const line = joinConsoleArgs(args);
  if (!line) {
    return;
  }

  runtimeState.printBuffer.push(line);
  if (runtimeState.printBuffer.length > 600) {
    runtimeState.printBuffer = runtimeState.printBuffer.slice(-400);
  }

  if (runtimeState.activeProgressEmitter && runtimeState.printBuffer.length % 10 === 0) {
    runtimeState.activeProgressEmitter({
      stage: "transcribe",
      percent: Math.min(95, 15 + runtimeState.printBuffer.length),
      message: "Transcribing with whisper.cpp..."
    });
  }
}

async function loadMainThreadRuntime(): Promise<RuntimeModule> {
  if (runtimeState.runtimeReady && globalWithWhisper.Module) {
    return globalWithWhisper.Module;
  }

  if (runtimeState.runtimePromise) {
    return runtimeState.runtimePromise;
  }

  runtimeState.runtimePromise = new Promise<RuntimeModule>((resolve, reject) => {
    const module = (globalWithWhisper.Module ??= {} as RuntimeModule);
    module.print = (...args: unknown[]) => handleRuntimePrint(...args);
    module.printErr = (...args: unknown[]) => handleRuntimePrint(...args);
    module.setStatus = () => {};
    module.monitorRunDependencies = () => {};
    module.onRuntimeInitialized = () => {
      runtimeState.runtimeReady = true;
      resolve(module);
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-whispercpp-main="true"]'
    );
    if (existing) {
      return;
    }

    const script = document.createElement("script");
    script.src = mainJsUrl();
    script.async = true;
    script.dataset.whispercppMain = "true";
    script.onerror = () => reject(new Error("Failed to load /whispercpp/main.js"));
    document.head.appendChild(script);
  });

  try {
    return await runtimeState.runtimePromise;
  } finally {
    if (!runtimeState.runtimeReady) {
      runtimeState.runtimePromise = null;
    }
  }
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(modelId: string): Promise<Uint8Array | undefined> {
  const db = await openDb();
  const result = await new Promise<Uint8Array | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const os = tx.objectStore(STORE);
    const request = os.get(modelId);
    request.onsuccess = () => resolve(request.result as Uint8Array | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function idbPut(modelId: string, buf: Uint8Array): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(buf, modelId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbDelete(modelId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(modelId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function storeFs(module: RuntimeModule, filename: string, buf: Uint8Array): void {
  try {
    module.FS_unlink(filename);
  } catch {
    // no-op
  }
  module.FS_createDataFile("/", filename, buf, true, true);
}

async function fetchWithProgress(
  url: string,
  expectedBytes: number,
  onProgress: (percent: number) => void
): Promise<Uint8Array> {
  onProgress(0);
  const response = await fetch(url, {
    mode: "cors",
    credentials: "omit",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}).`);
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (!response.body) {
    const ab = await response.arrayBuffer();
    onProgress(100);
    return new Uint8Array(ab);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(
      Math.round(
        whisperCppStreamDownloadRatio(loaded, contentLength, expectedBytes) * 100
      )
    );
  }

  onProgress(100);
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function waitForTranscriptionEnd(timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (runtimeState.cancelRequested) {
        reject(new Error("Transcription cancelled."));
        return;
      }

      const consoleText = runtimeState.printBuffer.join("\n");
      if (consoleText.includes("total time =") && consoleText.includes("encode time =")) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("whisper.cpp transcription timed out before producing text."));
        return;
      }

      window.setTimeout(check, 100);
    };

    check();
  });
}

function emitInstalledStates(listeners: WorkerListeners, active: () => boolean): void {
  void Promise.all(
    WHISPER_CPP_MODELS.map(async (model) => {
      const installed = Boolean(await idbGet(model.id));
      if (!active()) {
        return;
      }
      listeners.onModelState?.({
        modelId: model.id,
        installed,
        pending: false,
        sizeBytes: model.sizeBytes
      });
    })
  ).catch((error) => {
    if (active()) {
      listeners.onError?.(
        error instanceof Error ? error.message : "Failed to read whisper.cpp model cache."
      );
    }
  });
}

export class WhisperCppWorkerClient {
  private terminated = false;
  private readonly listeners: WorkerListeners;

  constructor(listeners: WorkerListeners) {
    this.listeners = listeners;
  }

  private isActive(): boolean {
    return !this.terminated;
  }

  private progress(progress: TranscriptionProgress): void {
    if (this.isActive()) {
      this.listeners.onProgress?.(progress);
    }
  }

  post(message: WorkerRequestMessage): void {
    if (!this.isActive()) {
      return;
    }

    void this.handleMessage(message).catch((error) => {
      if (!this.isActive()) {
        return;
      }
      this.listeners.onError?.(
        error instanceof Error ? error.message : "whisper.cpp runtime failed."
      );
    });
  }

  private async handleMessage(message: WorkerRequestMessage): Promise<void> {
    switch (message.type) {
      case "init": {
        await loadMainThreadRuntime();
        if (!this.isActive()) {
          return;
        }
        this.listeners.onReady?.(true, readMainThreadCapabilities());
        emitInstalledStates(this.listeners, () => this.isActive());
        return;
      }
      case "ensureModel": {
        const model = getWhisperCppModelDefinition(message.modelId);
        this.listeners.onModelState?.({
          modelId: model.id,
          installed: false,
          pending: true,
          sizeBytes: model.sizeBytes
        });
        const url = message.downloadUrl ?? whisperCppModelDownloadUrl(model);
        const buf = await fetchWithProgress(url, model.sizeBytes, (percent) => {
          this.progress({
            stage: "download",
            percent,
            message: `Downloading ${model.label}...`
          });
        });
        await idbPut(model.id, buf);
        if (!this.isActive()) {
          return;
        }
        this.listeners.onModelState?.({
          modelId: model.id,
          installed: true,
          pending: false,
          sizeBytes: model.sizeBytes,
          updatedAt: Date.now()
        });
        return;
      }
      case "deleteModel": {
        await idbDelete(message.modelId);
        if (runtimeState.loadedModelId === message.modelId && runtimeState.instance && globalWithWhisper.Module) {
          try {
            globalWithWhisper.Module.free?.(runtimeState.instance);
          } catch {
            // no-op
          }
          runtimeState.instance = null;
          runtimeState.loadedModelId = null;
        }
        const model = getWhisperCppModelDefinition(message.modelId);
        if (this.isActive()) {
          this.listeners.onModelState?.({
            modelId: model.id,
            installed: false,
            pending: false,
            sizeBytes: model.sizeBytes
          });
        }
        return;
      }
      case "cancel":
        runtimeState.cancelRequested = true;
        return;
      case "transcribe": {
        const model = getWhisperCppModelDefinition(message.request.modelId);
        const module = await loadMainThreadRuntime();
        const modelBuf = await idbGet(model.id);
        if (!modelBuf) {
          throw new Error("Model is not installed. Download it before transcribing.");
        }

        this.progress({
          stage: "prepare",
          percent: 5,
          message: "Loading whisper.cpp model into memory..."
        });

        storeFs(module, "whisper.bin", modelBuf);
        if (runtimeState.loadedModelId !== model.id && runtimeState.instance) {
          module.free?.(runtimeState.instance);
          runtimeState.instance = null;
          runtimeState.loadedModelId = null;
        }
        if (!runtimeState.instance) {
          runtimeState.instance = module.init("whisper.bin");
          runtimeState.loadedModelId = model.id;
        }
        if (!runtimeState.instance) {
          throw new Error("whisper.cpp could not initialize the selected model.");
        }

        runtimeState.cancelRequested = false;
        runtimeState.printBuffer = [];
        runtimeState.activeProgressEmitter = (progress) => this.progress(progress);

        const startedAt = performance.now();
        const audio = message.audio as DecodedAudioPayload;
        const language = message.request.language === "auto" ? "auto" : message.request.language;
        const threads = Math.max(1, message.request.threads ?? 4);
        const translate = Boolean(message.request.translate);

        this.progress({
          stage: "transcribe",
          percent: 10,
          message: `Running ${model.label}...`
        });

        const ret = module.full_default(
          runtimeState.instance,
          audio.samples,
          language,
          threads,
          translate
        );
        if (ret !== 0) {
          runtimeState.activeProgressEmitter = null;
          throw new Error(`whisper.cpp returned error code ${ret}.`);
        }

        await waitForTranscriptionEnd(35 * 60 * 1000);
        runtimeState.activeProgressEmitter = null;

        const text = parseWhisperCppConsoleLines(runtimeState.printBuffer);
        if (!text) {
          throw new Error("whisper.cpp finished but returned an empty transcript.");
        }

        if (!this.isActive()) {
          return;
        }

        this.listeners.onResult?.({
          text,
          durationSeconds: audio.durationSeconds,
          elapsedMs: Math.round(performance.now() - startedAt),
          outputName: message.outputName
        });
        this.progress({
          stage: "finalize",
          percent: 100,
          message: "Transcript ready."
        });
      }
    }
  }

  terminate(): void {
    this.terminated = true;
    runtimeState.cancelRequested = true;
    if (runtimeState.activeProgressEmitter) {
      runtimeState.activeProgressEmitter = null;
    }
  }
}
