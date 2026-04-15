import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS } from "./constants";
import { decodeAndResampleAudio } from "./lib/audio";
import { downloadTextFile } from "./lib/download-file";
import { isSupportedAudioFile } from "./lib/file";
import { formatBytes, formatSeconds, humanProgress } from "./lib/format";
import { useInstallPrompt } from "./lib/install";
import { getWhisperCppBackendWarning } from "./lib/runtime-capabilities";
import {
  getAutoLanguageWarning,
  getModelRuntimeWarning,
  getReportedDeviceMemory
} from "./lib/runtime-support";
import { getMeta, persistLastSelections } from "./lib/storage";
import {
  DEFAULT_WHISPER_CPP_MODEL_ID,
  getWhisperCppModelDefinition,
  whisperCppModelDownloadUrl,
  WHISPER_CPP_MODELS
} from "./lib/whispercpp-models";
import { getRecommendedWhisperCppThreads } from "./lib/whispercpp-threads";
import { WhisperCppWorkerClient } from "./lib/whispercpp-worker-client";
import { initialAppState } from "./state";
import type { TranscriptResult, WorkerListeners } from "./types";

const MODEL_CATALOG = WHISPER_CPP_MODELS;

const MOBILE_BREAKPOINT = "(max-width: 767px)";

type MobileSection = "upload" | "model" | "run" | "output";

const MOBILE_SECTION_ORDER: MobileSection[] = ["upload", "model", "run", "output"];

const MOBILE_SECTION_LABELS: Record<MobileSection, string> = {
  upload: "Audio",
  model: "Modello",
  run: "Esecuzione",
  output: "Trascrizione"
};

const MOBILE_FLOW_HINTS: Record<MobileSection, string> = {
  upload:
    "Carica un file, poi passa a Modello per scegliere la lingua e installare il modello (se serve).",
  model:
    "Qui installi o cambi modello. Quando è pronto, vai a Esecuzione per avviare la trascrizione.",
  run: "Avvia la trascrizione qui. A fine lavoro apri Trascrizione per leggere ed esportare il testo.",
  output: "Qui compare il testo quando la trascrizione è finita. Puoi tornare indietro con il menu Vista."
};

function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_BREAKPOINT).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return narrow;
}

function transcriptFileName(source: File | null): string {
  const base = source?.name.replace(/\.[^/.]+$/, "") ?? "transcript";
  return `${base}.txt`;
}

function applyLanguageToOutputName(outputName: string, language: string): string {
  if (language === "auto") {
    return outputName;
  }

  return `${outputName.replace(/\.txt$/i, "")}.${language}.txt`;
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

  return "Ready when you are.";
}

export default function App() {
  const installState = useInstallPrompt();
  const workerRef = useRef<WhisperCppWorkerClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState(initialAppState);
  const [dragging, setDragging] = useState(false);
  const narrow = useNarrowLayout();
  const [mobileSection, setMobileSection] = useState<MobileSection>("upload");

  const mobileStepIndex = useMemo(
    () => Math.max(0, MOBILE_SECTION_ORDER.indexOf(mobileSection)),
    [mobileSection]
  );
  const mobileNextSection =
    mobileStepIndex < MOBILE_SECTION_ORDER.length - 1 ? MOBILE_SECTION_ORDER[mobileStepIndex + 1]! : null;

  const workerListeners: WorkerListeners = {
    onReady: (available, capabilities) => {
      setState((current) => ({
        ...current,
        workerReady: true,
        localRuntime: available,
        whisperCapabilities: capabilities ?? current.whisperCapabilities
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
        transcript: {
          ...result,
          outputName: applyLanguageToOutputName(result.outputName, current.language)
        },
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

  function bootWorker(): WhisperCppWorkerClient {
    workerRef.current?.terminate();
    const worker = new WhisperCppWorkerClient(workerListeners);
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
        meta.lastModelId && MODEL_CATALOG.some((model) => model.id === meta.lastModelId)
          ? meta.lastModelId
          : DEFAULT_WHISPER_CPP_MODEL_ID;

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
    () => MODEL_CATALOG.find((model) => model.id === state.modelId) ?? MODEL_CATALOG[0],
    [state.modelId]
  );
  const reportedDeviceMemory = useMemo(() => getReportedDeviceMemory(), []);
  const activeModelState = state.models[state.modelId];
  const installedModelCount = MODEL_CATALOG.filter((model) => state.models[model.id]?.installed).length;
  const whisperCppWarning = getWhisperCppBackendWarning(state.whisperCapabilities);
  const selectedLanguage =
    LANGUAGE_OPTIONS.find((option) => option.value === state.language) ?? LANGUAGE_OPTIONS[0];
  const transcriptWordCount = state.transcript?.text.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const selectedModelRuntimeWarning = getModelRuntimeWarning(selectedModel, reportedDeviceMemory);
  const autoLanguageWarning = getAutoLanguageWarning(
    selectedLanguage.value,
    state.selectedDuration
  );
  const canStart = Boolean(
    state.selectedFile &&
      activeModelState?.installed &&
      !state.busy &&
      !autoLanguageWarning &&
      !whisperCppWarning
  );
  const canInstallSelectedModel = Boolean(
    !state.busy && !activeModelState?.installed && !whisperCppWarning
  );
  const progressValue = state.progress?.percent ?? 0;
  const progressDetails = state.progress?.chunkCount
    ? `Chunk ${state.progress.chunkIndex} of ${state.progress.chunkCount}`
    : state.transcript
      ? `${transcriptWordCount} words`
      : "Models stay in this browser.";
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
    const model = MODEL_CATALOG.find((entry) => entry.id === modelId) ?? MODEL_CATALOG[0];
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
    const cppModel = getWhisperCppModelDefinition(model.id);
    workerRef.current?.post({
      type: "ensureModel",
      modelId: model.id,
      downloadUrl: whisperCppModelDownloadUrl(cppModel),
      sizeBytes: cppModel.sizeBytes
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
            language: selectedLanguage.value,
            modelId: state.modelId,
            threads: getRecommendedWhisperCppThreads(navigator.hardwareConcurrency),
            translate: false
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

  const engineReady = state.workerReady && state.localRuntime;

  return (
    <div className={`app-shell${narrow ? " app-shell--narrow" : ""}`}>
      <main className="app-frame">
        <header className="app-header">
          <div className="brand-column">
            <p className="brand-tag">WhisperDrop</p>
            <h1>Transcribe audio on this device</h1>
            {!narrow ? (
              <p className="brand-copy">
                Local whisper.cpp in the browser — your audio never leaves this machine.
              </p>
            ) : null}
          </div>

          <div className="header-status">
            {narrow ? (
              <div className="status-chip">
                <span className={`status-dot ${engineReady ? "status-dot-green" : ""}`} />
                <span>
                  {state.workerReady ? "Worker ready" : "Worker…"}
                  {" · "}
                  {state.localRuntime ? "Runtime ready" : "Runtime…"}
                </span>
              </div>
            ) : (
              <>
                <div className="status-chip">
                  <span className={`status-dot ${state.workerReady ? "status-dot-green" : ""}`} />
                  <span>{state.workerReady ? "Worker online" : "Worker starting"}</span>
                </div>
                <div className="status-chip">
                  <span className={`status-dot ${state.localRuntime ? "status-dot-green" : ""}`} />
                  <span>{state.localRuntime ? "Runtime ready" : "Runtime loading"}</span>
                </div>
              </>
            )}
            <div className="status-chip">
              <span className="status-dot status-dot-green" />
              <span>
                Models {installedModelCount}/{MODEL_CATALOG.length}
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

        {narrow ? (
          <div className="mobile-nav-sticky">
            <div className="mobile-section-bar">
              <label className="mobile-section-label" htmlFor="mobile-section">
                Vista (passo {mobileStepIndex + 1} di {MOBILE_SECTION_ORDER.length})
              </label>
              <select
                id="mobile-section"
                className="mobile-section-select"
                value={mobileSection}
                onChange={(event) => setMobileSection(event.target.value as MobileSection)}
              >
                <option value="upload">1 — Audio</option>
                <option value="model">2 — Modello</option>
                <option value="run">3 — Esecuzione</option>
                <option value="output">4 — Trascrizione</option>
              </select>
            </div>
            <div className="mobile-flow" aria-live="polite">
              <div className="mobile-flow-steps" aria-hidden="true">
                {MOBILE_SECTION_ORDER.map((id, index) => (
                  <span
                    key={id}
                    className={`mobile-flow-dot ${index <= mobileStepIndex ? "mobile-flow-dot--done" : ""} ${
                      index === mobileStepIndex ? "mobile-flow-dot--current" : ""
                    }`}
                  />
                ))}
              </div>
              <p className="mobile-flow-hint">{MOBILE_FLOW_HINTS[mobileSection]}</p>
              {mobileNextSection ? (
                <button
                  type="button"
                  className="secondary-button mobile-flow-next"
                  onClick={() => setMobileSection(mobileNextSection)}
                >
                  Continua → {MOBILE_SECTION_LABELS[mobileNextSection]}
                </button>
              ) : (
                <p className="mobile-flow-end">Hai completato i passi: puoi usare il menu per rivedere una sezione.</p>
              )}
            </div>
          </div>
        ) : null}

        <section
          className={narrow ? "workspace-single" : "workspace-grid"}
          aria-label={narrow ? "Active workspace section" : "Workspace"}
        >
          {(narrow ? mobileSection === "upload" : true) ? (
          <section className="panel panel-upload">
            <div className="panel-heading">
              <span className="panel-step">01</span>
              <div>
                <p className="panel-label">Input</p>
                <h2>Audio</h2>
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
                  ? "Decoded locally before transcription."
                  : "WAV, MP3, M4A, AAC, OGG."}
              </p>
              <span className="dropzone-file">{state.selectedFile?.name ?? "No file selected"}</span>
            </label>

            <dl className="detail-list detail-list--compact">
              <div className="detail-item">
                <dt>Size</dt>
                <dd>{state.selectedFile ? formatBytes(state.selectedFile.size) : "—"}</dd>
              </div>
              <div className="detail-item">
                <dt>Duration</dt>
                <dd>{formatSeconds(state.selectedDuration)}</dd>
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
          ) : null}

          {(narrow ? mobileSection === "model" : true) ? (
          <section className="panel panel-controls">
            <div className="panel-heading">
              <span className="panel-step">02</span>
              <div>
                <p className="panel-label">Model</p>
                <h2>Model &amp; language</h2>
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

              {whisperCppWarning ? (
                <p className="inline-error control-grid-full">{whisperCppWarning}</p>
              ) : null}

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
                  {MODEL_CATALOG.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="control-hint">
              Current: <strong>{selectedModel.label}</strong>
              {activeModelState?.installed ? " — installed" : activeModelState?.pending ? " — downloading" : " — not installed"}
              {selectedModelRuntimeWarning ? (
                <span className="inline-error"> {selectedModelRuntimeWarning}</span>
              ) : null}
            </p>

            <div className="model-list" role="list" aria-label="Available transcription models">
              {MODEL_CATALOG.map((model) => {
                const install = state.models[model.id];
                const installed = Boolean(install?.installed);
                const pending = Boolean(install?.pending);
                const selected = state.modelId === model.id;
                const runtimeWarning = getModelRuntimeWarning(model, reportedDeviceMemory);

                return (
                  <article
                    key={model.id}
                    className={`model-row model-row--compact ${selected ? "model-row-selected" : ""}`}
                    role="listitem"
                    title={model.recommendedFor}
                  >
                    <div className="model-row-copy">
                      <div className="model-row-title">
                        <h3>{model.label}</h3>
                        <span className="mono-pill mono-pill-neutral">
                          {formatBytes(model.sizeBytes)}
                        </span>
                      </div>
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
                          disabled={state.busy || pending}
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
          ) : null}

          {(narrow ? mobileSection === "run" : true) ? (
          <section className="panel panel-run" aria-live="polite">
            <div className="panel-heading">
              <span className="panel-step">03</span>
              <div>
                <p className="panel-label">Run</p>
                <h2>Progress</h2>
              </div>
            </div>

            <article className={`run-card ${runToneClass}`}>
              <div className="run-card-top">
                <strong>{statusSummary}</strong>
                <span className="run-percent">
                  {state.progress ? humanProgress(progressValue) : "Idle"}
                </span>
              </div>
              <div
                className={`progress-track${
                  state.progress?.stage === "transcribe" ? " progress-track--busy" : ""
                }`}
                aria-hidden="true"
              >
                <div className="progress-fill" style={{ width: `${progressValue}%` }} />
              </div>
              <p className="run-copy">{progressDetails}</p>
            </article>

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
          ) : null}

          {(narrow ? mobileSection === "output" : true) ? (
          <section className="panel panel-output">
            <div className="panel-heading">
              <span className="panel-step">04</span>
              <div>
                <p className="panel-label">Output</p>
                <h2>Transcript</h2>
              </div>
            </div>

            <div className="output-toolbar">
              <span className="mono-pill mono-pill-neutral">
                {state.transcript ? formatSeconds(state.transcript.durationSeconds) : "—"}
              </span>
              <span className="mono-pill mono-pill-neutral">{transcriptWordCount} words</span>
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
          ) : null}
        </section>
      </main>
    </div>
  );
}
