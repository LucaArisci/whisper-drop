import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import {
  DEFAULT_CHUNK_SECONDS,
  DEFAULT_LANGUAGE,
  DEFAULT_MODEL_ID,
  DEFAULT_OVERLAP_SECONDS,
  LANGUAGE_OPTIONS,
  MODELS
} from "./constants";
import { decodeAndResampleAudio } from "./lib/audio";
import { downloadTextFile } from "./lib/download-file";
import { isSupportedAudioFile } from "./lib/file";
import { formatBytes, formatSeconds, humanProgress } from "./lib/format";
import { useInstallPrompt } from "./lib/install";
import {
  getAutoLanguageWarning,
  getModelRuntimeWarning,
  getReportedDeviceMemory
} from "./lib/runtime-support";
import { getMeta, persistLastSelections } from "./lib/storage";
import { TranscriptionWorkerClient, type WorkerListeners } from "./lib/worker-client";
import { initialAppState } from "./state";
import type { TranscriptResult } from "./types";

function transcriptFileName(source: File | null): string {
  const base = source?.name.replace(/\.[^/.]+$/, "") ?? "transcript";
  return `${base}.txt`;
}

function describeProgress(
  transcript: TranscriptResult | null,
  progressMessage: string | null,
  error: string | null
): string {
  if (error) {
    return error;
  }

  if (progressMessage) {
    return progressMessage;
  }

  if (transcript) {
    return "Transcript ready to export.";
  }

  return "Everything runs locally in the browser after the model download finishes.";
}

export default function App() {
  const installState = useInstallPrompt();
  const workerRef = useRef<TranscriptionWorkerClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState(initialAppState);
  const [dragging, setDragging] = useState(false);

  const workerListeners: WorkerListeners = {
    onReady: (available) => {
      setState((current) => ({
        ...current,
        workerReady: true,
        localRuntime: available
      }));
    },
    onModelState: (modelState) => {
      setState((current) => {
        const completedModelDownload =
          current.progress?.stage === "download" && !modelState.pending && !modelState.error;

        return {
          ...current,
          busy: completedModelDownload ? false : current.busy,
          progress: completedModelDownload
            ? {
                stage: "finalize",
                percent: 100,
                message: modelState.installed
                  ? "Model ready. You can start transcription."
                  : "Model removed from local cache."
              }
            : current.progress,
          models: {
            ...current.models,
            [modelState.modelId]: modelState
          }
        };
      });
    },
    onProgress: (progress) => {
      setState((current) => ({
        ...current,
        progress,
        busy: progress.stage !== "finalize" || progress.percent < 100,
        error: null
      }));
    },
    onResult: (result) => {
      setState((current) => ({
        ...current,
        transcript: result,
        busy: false,
        error: null,
        progress: {
          stage: "finalize",
          percent: 100,
          message: "Transcript ready."
        }
      }));
    },
    onError: (message) => {
      setState((current) => ({
        ...current,
        busy: false,
        error: message,
        progress: null
      }));
    }
  };

  function bootWorker(): TranscriptionWorkerClient {
    const worker = new TranscriptionWorkerClient(workerListeners);
    workerRef.current = worker;
    worker.post({ type: "init" });
    return worker;
  }

  function resetWorker(): void {
    workerRef.current?.terminate();
    bootWorker();
  }

  useEffect(() => {
    setState((current) => ({
      ...current,
      installState
    }));
  }, [installState]);

  useEffect(() => {
    let active = true;
    void getMeta().then((meta) => {
      if (!active) {
        return;
      }

      const modelId =
        meta.lastModelId && MODELS.some((model) => model.id === meta.lastModelId)
          ? meta.lastModelId
          : DEFAULT_MODEL_ID;

      setState((current) => ({
        ...current,
        modelId,
        language: meta.lastLanguage ?? DEFAULT_LANGUAGE
      }));
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const worker = bootWorker();

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const selectedModel = useMemo(
    () => MODELS.find((model) => model.id === state.modelId) ?? MODELS[0],
    [state.modelId]
  );
  const reportedDeviceMemory = useMemo(() => getReportedDeviceMemory(), []);
  const activeModelState = state.models[state.modelId];
  const installedModelCount = MODELS.filter((model) => state.models[model.id]?.installed).length;
  const selectedLanguage =
    LANGUAGE_OPTIONS.find((option) => option.value === state.language) ?? LANGUAGE_OPTIONS[0];
  const transcriptWordCount = state.transcript?.text.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const transcriptCharacterCount = state.transcript?.text.length ?? 0;
  const selectedModelRuntimeWarning = getModelRuntimeWarning(selectedModel, reportedDeviceMemory);
  const autoLanguageWarning = getAutoLanguageWarning(
    state.language as (typeof LANGUAGE_OPTIONS)[number]["value"],
    state.selectedDuration
  );
  const canStart = Boolean(
    state.selectedFile &&
      activeModelState?.installed &&
      !state.busy &&
      !selectedModelRuntimeWarning &&
      !autoLanguageWarning
  );
  const canInstallSelectedModel = Boolean(
    !state.busy && !activeModelState?.installed && !selectedModelRuntimeWarning
  );
  const progressValue = state.progress?.percent ?? 0;
  const progressDetails = state.progress?.chunkCount
    ? `Chunk ${state.progress.chunkIndex} of ${state.progress.chunkCount}`
    : state.transcript
      ? `${transcriptWordCount} words ready`
      : "Downloaded models stay in browser cache for later offline use.";
  const statusSummary = describeProgress(
    state.transcript,
    state.progress?.message ?? null,
    state.error
  );
  const runToneClass = state.error
    ? "run-card-error"
    : state.transcript
      ? "run-card-success"
      : state.busy
        ? "run-card-active"
        : "";

  const setSelectedFile = async (file: File) => {
    if (!isSupportedAudioFile(file)) {
      setState((current) => ({
        ...current,
        error: "Unsupported file format. Use .wav, .mp3, .m4a, .aac, or .ogg."
      }));
      return;
    }

    setState((current) => ({
      ...current,
      selectedFile: file,
      selectedDuration: null,
      transcript: null,
      error: null
    }));

    try {
      const decoded = await decodeAndResampleAudio(file);
      setState((current) => ({
        ...current,
        selectedDuration: decoded.durationSeconds
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error:
          error instanceof Error
            ? error.message
            : "This browser could not decode the selected audio file."
      }));
    }
  };

  const clearSelectedFile = () => {
    setState((current) => ({
      ...current,
      selectedFile: null,
      selectedDuration: null,
      transcript: null,
      error: null
    }));
  };

  const onFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await setSelectedFile(file);
    }
    event.target.value = "";
  };

  const onDropZoneKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const ensureModel = (modelId: string) => {
    const model = MODELS.find((entry) => entry.id === modelId) ?? MODELS[0];
    const runtimeWarning = getModelRuntimeWarning(model, reportedDeviceMemory);
    if (runtimeWarning) {
      setState((current) => ({
        ...current,
        modelId,
        error: runtimeWarning
      }));
      return;
    }

    setState((current) => ({
      ...current,
      modelId,
      error: null,
      progress: {
        stage: "download",
        percent: 0,
        message: "Preparing model download..."
      }
    }));
    workerRef.current?.post({
      type: "ensureModel",
      modelId
    });
  };

  const startTranscription = async () => {
    if (autoLanguageWarning) {
      setState((current) => ({
        ...current,
        error: autoLanguageWarning
      }));
      return;
    }

    if (selectedModelRuntimeWarning) {
      setState((current) => ({
        ...current,
        error: selectedModelRuntimeWarning
      }));
      return;
    }

    if (!state.selectedFile) {
      setState((current) => ({
        ...current,
        error: "Pick an audio file first."
      }));
      return;
    }

    if (!activeModelState?.installed) {
      setState((current) => ({
        ...current,
        error: "Install the selected model before starting transcription."
      }));
      return;
    }

    setState((current) => ({
      ...current,
      busy: true,
      transcript: null,
      error: null,
      progress: {
        stage: "decode",
        percent: 0,
        message: "Preparing audio..."
      }
    }));

    try {
      const decoded = await decodeAndResampleAudio(state.selectedFile, (percent, message) => {
        setState((current) => ({
          ...current,
          progress: {
            stage: "decode",
            percent,
            message
          }
        }));
      });

      await persistLastSelections(state.modelId, state.language);
      workerRef.current?.post(
        {
          type: "transcribe",
          request: {
            language: state.language as typeof DEFAULT_LANGUAGE,
            modelId: state.modelId,
            chunkSeconds: DEFAULT_CHUNK_SECONDS,
            overlapSeconds: DEFAULT_OVERLAP_SECONDS
          },
          audio: decoded,
          outputName: transcriptFileName(state.selectedFile)
        },
        [decoded.samples.buffer as ArrayBuffer]
      );
    } catch (error) {
      setState((current) => ({
        ...current,
        busy: false,
        error:
          error instanceof Error
            ? error.message
            : "This file could not be prepared for transcription.",
        progress: null
      }));
    }
  };

  const cancelRun = () => {
    resetWorker();
    setState((current) => ({
      ...current,
      busy: false,
      workerReady: false,
      localRuntime: false,
      progress: null,
      error: "Transcription cancelled."
    }));
  };

  const removeModel = (modelId: string) => {
    workerRef.current?.post({ type: "deleteModel", modelId });
  };

  const copyTranscript = async (result: TranscriptResult | null) => {
    if (!result) {
      return;
    }

    try {
      await navigator.clipboard.writeText(result.text);
    } catch {
      setState((current) => ({
        ...current,
        error: "Clipboard access was blocked by this browser."
      }));
    }
  };

  return (
    <div className="app-shell">
      <main className="app-frame">
        <header className="app-header">
          <div className="brand-column">
            <p className="brand-tag">WhisperDrop</p>
            <h1>Local transcription in your browser.</h1>
            <p className="brand-copy">
              Upload audio, install a model once, and transcribe on the same device without
              routing recordings through a server.
            </p>
          </div>

          <div className="header-status">
            <div className="status-chip">
              <span className={`status-dot ${state.workerReady ? "status-dot-green" : ""}`} />
              <span>{state.workerReady ? "Worker online" : "Worker starting"}</span>
            </div>
            <div className="status-chip">
              <span className={`status-dot ${state.localRuntime ? "status-dot-green" : ""}`} />
              <span>{state.localRuntime ? "Runtime ready" : "Runtime loading"}</span>
            </div>
            <div className="status-chip">
              <span className="status-dot status-dot-green" />
              <span>
                {installedModelCount}/{MODELS.length} models installed
              </span>
            </div>
            {state.installState.canInstall ? (
              <button
                className="ghost-button"
                type="button"
                onClick={() => void state.installState.prompt?.()}
              >
                Install app
              </button>
            ) : null}
          </div>
        </header>

        <section className="workspace-grid">
          <section className="panel panel-upload">
            <div className="panel-heading">
              <span className="panel-step">01</span>
              <div>
                <p className="panel-label">Input</p>
                <h2>Load audio</h2>
              </div>
            </div>

            <label
              className={`dropzone ${dragging ? "dropzone-active" : ""}`}
              onDragEnter={() => setDragging(true)}
              onDragLeave={() => setDragging(false)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) {
                  void setSelectedFile(file);
                }
              }}
              onKeyDown={onDropZoneKeyDown}
              tabIndex={0}
            >
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept=".wav,.mp3,.m4a,.aac,.ogg,audio/*"
                onChange={onFileInput}
              />
              <span className="dropzone-icon" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
              </span>
              <span className="dropzone-eyebrow">Tap to browse or drag audio here</span>
              <strong className="dropzone-title">
                {state.selectedFile ? "Audio locked in" : "Choose a recording"}
              </strong>
              <p className="dropzone-copy">
                {state.selectedFile
                  ? "The file remains on this device. Decoding happens locally before inference."
                  : "Supported formats: WAV, MP3, M4A, AAC, and OGG."}
              </p>
              <span className="dropzone-file">{state.selectedFile?.name ?? "No file selected"}</span>
            </label>

            <dl className="detail-list">
              <div className="detail-item">
                <dt>File</dt>
                <dd>{state.selectedFile?.name ?? "Waiting for audio"}</dd>
              </div>
              <div className="detail-item">
                <dt>Size</dt>
                <dd>{state.selectedFile ? formatBytes(state.selectedFile.size) : "0 B"}</dd>
              </div>
              <div className="detail-item">
                <dt>Duration</dt>
                <dd>{formatSeconds(state.selectedDuration)}</dd>
              </div>
              <div className="detail-item">
                <dt>Mode</dt>
                <dd>Fully local</dd>
              </div>
            </dl>

            <div className="button-row">
              <button
                className="primary-button"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                {state.selectedFile ? "Replace audio" : "Choose audio"}
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={clearSelectedFile}
                disabled={!state.selectedFile || state.busy}
              >
                Clear
              </button>
            </div>
          </section>

          <section className="panel panel-controls">
            <div className="panel-heading">
              <span className="panel-step">02</span>
              <div>
                <p className="panel-label">Model</p>
                <h2>Choose the runtime</h2>
              </div>
            </div>

            <div className="control-grid">
              <label className="control-field" htmlFor="language">
                <span>Language</span>
                <select
                  id="language"
                  value={state.language}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      language: event.target.value,
                      error: null
                    }))
                  }
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {autoLanguageWarning ? <p className="inline-error">{autoLanguageWarning}</p> : null}
              </label>

              <label className="control-field" htmlFor="model">
                <span>Selected model</span>
                <select
                  id="model"
                  value={state.modelId}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      modelId: event.target.value
                    }))
                  }
                >
                  {MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <article className="selected-model">
              <div className="selected-model-copy">
                <p className="panel-label">Current pick</p>
                <h3>{selectedModel.label}</h3>
                <p>{selectedModel.recommendedFor}</p>
                {selectedModelRuntimeWarning ? (
                  <p className="inline-error">{selectedModelRuntimeWarning}</p>
                ) : null}
              </div>
              <div className="selected-model-meta">
                <span className="mono-pill">{formatBytes(selectedModel.sizeBytes)}</span>
                {reportedDeviceMemory !== null ? (
                  <span className="mono-pill mono-pill-neutral">
                    Browser memory: {reportedDeviceMemory} GB
                  </span>
                ) : null}
                <span
                  className={`mono-pill ${
                    activeModelState?.installed ? "mono-pill-green" : "mono-pill-neutral"
                  }`}
                >
                  {activeModelState?.pending
                    ? "Downloading"
                    : activeModelState?.installed
                      ? "Installed"
                      : "Not installed"}
                </span>
              </div>
            </article>

            <div className="model-list" role="list" aria-label="Available transcription models">
              {MODELS.map((model) => {
                const install = state.models[model.id];
                const installed = Boolean(install?.installed);
                const pending = Boolean(install?.pending);
                const selected = state.modelId === model.id;
                const runtimeWarning = getModelRuntimeWarning(model, reportedDeviceMemory);

                return (
                  <article
                    key={model.id}
                    className={`model-row ${selected ? "model-row-selected" : ""}`}
                    role="listitem"
                  >
                    <div className="model-row-copy">
                      <div className="model-row-title">
                        <h3>{model.label}</h3>
                        <span className="mono-pill mono-pill-neutral">
                          {formatBytes(model.sizeBytes)}
                        </span>
                      </div>
                      <p>{model.recommendedFor}</p>
                      {runtimeWarning ? <p className="inline-error">{runtimeWarning}</p> : null}
                      {install?.error ? <p className="inline-error">{install.error}</p> : null}
                    </div>

                    <div className="model-row-actions">
                      <button
                        className={selected ? "secondary-button" : "ghost-button"}
                        type="button"
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            modelId: model.id
                          }))
                        }
                      >
                        {selected ? "Selected" : "Use model"}
                      </button>

                      {installed ? (
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => removeModel(model.id)}
                          disabled={state.busy}
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => ensureModel(model.id)}
                          disabled={state.busy || pending || Boolean(runtimeWarning)}
                        >
                          {pending ? "Downloading..." : "Download"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel panel-run" aria-live="polite">
            <div className="panel-heading">
              <span className="panel-step">03</span>
              <div>
                <p className="panel-label">Run</p>
                <h2>Watch the pipeline</h2>
              </div>
            </div>

            <article className={`run-card ${runToneClass}`}>
              <div className="run-card-top">
                <strong>{statusSummary}</strong>
                <span className="run-percent">
                  {state.progress ? humanProgress(progressValue) : "Idle"}
                </span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${progressValue}%` }} />
              </div>
              <p className="run-copy">{progressDetails}</p>
            </article>

            <div className="signal-grid">
              <article className="signal-card">
                <span className="panel-label">Language</span>
                <strong>{selectedLanguage.label}</strong>
                <p>{state.language === "auto" ? "Detected on the fly." : "Locked before decoding."}</p>
              </article>
              <article className="signal-card">
                <span className="panel-label">Runtime</span>
                <strong>{state.localRuntime ? "Browser ready" : "Preparing"}</strong>
                <p>{state.workerReady ? "Worker is online." : "Worker boot is still in progress."}</p>
              </article>
            </div>

            {state.error ? (
              <div className="error-box" role="alert">
                <strong>Attention required</strong>
                <p>{state.error}</p>
              </div>
            ) : null}

            <div className="button-row">
              <button
                className="primary-button"
                type="button"
                onClick={() => void startTranscription()}
                disabled={!canStart}
              >
                Start transcription
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => ensureModel(state.modelId)}
                disabled={!canInstallSelectedModel}
              >
                Install selected model
              </button>
              {state.busy ? (
                <button className="danger-button" type="button" onClick={cancelRun}>
                  Cancel
                </button>
              ) : null}
            </div>
          </section>

          <section className="panel panel-output">
            <div className="panel-heading">
              <span className="panel-step">04</span>
              <div>
                <p className="panel-label">Output</p>
                <h2>Review the transcript</h2>
              </div>
            </div>

            <div className="output-toolbar">
              <span className="mono-pill mono-pill-neutral">
                {state.transcript ? formatSeconds(state.transcript.durationSeconds) : "No transcript"}
              </span>
              <span className="mono-pill mono-pill-neutral">{transcriptWordCount} words</span>
              <span className="mono-pill mono-pill-neutral">{transcriptCharacterCount} chars</span>
              <span className="mono-pill mono-pill-green">{selectedModel.label}</span>
            </div>

            <textarea
              className="transcript-box"
              readOnly
              value={state.transcript?.text ?? ""}
              placeholder="The transcript will appear here when the local run finishes."
            />

            <div className="button-row">
              <button
                className="primary-button"
                type="button"
                disabled={!state.transcript}
                onClick={() =>
                  state.transcript &&
                  downloadTextFile(state.transcript.outputName, state.transcript.text)
                }
              >
                Download .txt
              </button>
              <button
                className="ghost-button"
                type="button"
                disabled={!state.transcript}
                onClick={() => void copyTranscript(state.transcript)}
              >
                Copy text
              </button>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
