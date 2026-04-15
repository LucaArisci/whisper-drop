# Whisper.cpp Experimental Implementation Plan

## Objective

Implement an experimental browser-only `whisper.cpp` runtime in this repository while **keeping the current WhisperDrop UI**. The result should live behind a dedicated experimental branch and start as a **parallel backend**, with the option to make it the default later if benchmarks and stability are good enough.

This plan intentionally mirrors the spirit of the official browser demo at [ggml.ai/whisper.cpp](https://ggml.ai/whisper.cpp/), but adapts it to the current application structure instead of copying the demo UI.

## Scope

### In scope

- Browser-side `whisper.cpp` runtime using WebAssembly.
- Dedicated worker-based transcription flow.
- Reuse of the current app UI in `src/App.tsx`.
- Install/download/remove model flow inside the app.
- Experimental support for `tiny` and `base`.
- Optional experimental support for `small` only after validation.
- Deployment updates needed for browser threading/isolation.

### Out of scope for the first iteration

- `medium`, `large`, or other heavy models as supported defaults.
- Mobile-first support.
- Replacing the current backend immediately.
- Server-side inference.
- Polished migration of existing browser-cached ONNX models into `whisper.cpp` models.

## Working assumptions

- The current UI stays mostly intact.
- The current audio decode/resample flow can be reused.
- `whisper.cpp` browser runtime is feasible on modern desktop browsers, especially Chrome/Edge.
- Cross-origin isolation is likely required for the best threading/runtime behavior.
- The project should remain local-first.

## Product decision

Treat `whisper.cpp` as a **new experimental runtime backend** first, not a full replacement on day one.

Recommended rollout:

1. Add `whisper.cpp` as an experimental backend.
2. Keep the current backend available during development.
3. Benchmark and compare both.
4. Decide later whether to switch the default runtime.

This keeps risk low and allows direct comparison inside the same application shell.

## Browser support policy

### Target for first implementation

- Chrome desktop
- Edge desktop

### Experimental

- Firefox desktop
- Safari desktop
- `small` model

### Not a target initially

- Mobile browsers
- `medium` and larger models

## Model policy

### Initial models to expose

- `tiny`
- `base`

### Possible later addition

- `small` as clearly marked experimental

### Do not expose initially

- `medium`
- `large`

Reason: browser memory and runtime behavior become much less reliable above `base`, and the official browser example is also conservative.

## Desired architecture

Current architecture:

`React UI -> worker client -> Transformers.js worker -> ONNX Runtime Web`

Target architecture:

`React UI -> backend-aware worker client -> whisper.cpp worker -> whisper.cpp WASM runtime`

The UI should remain largely unchanged. The implementation work should happen in the runtime layer, storage layer, and worker layer.

## High-level implementation strategy

### Strategy

Build a `whisper.cpp` backend adapter that looks as similar as possible to the current worker contract:

- `init`
- `ensureModel`
- `deleteModel`
- `transcribe`
- `cancel`

Worker events should remain similar:

- `ready`
- `modelState`
- `progress`
- `result`
- `error`

This minimizes churn in `src/App.tsx`.

## Proposed file structure

### New files

- `src/lib/transcription-backend.ts`
  - backend selection, shared backend types, runtime flags
- `src/lib/whispercpp-models.ts`
  - registry of supported `whisper.cpp` models, URLs, sizes, labels, warnings
- `src/lib/whispercpp-storage.ts`
  - installation metadata and low-level persistence helpers
- `src/lib/runtime-capabilities.ts`
  - browser capability detection: `crossOriginIsolated`, `SharedArrayBuffer`, threads, SIMD hints
- `src/lib/whispercpp-worker-client.ts`
  - wrapper around the new `whisper.cpp` worker
- `src/workers/whispercpp.worker.ts`
  - message router for the experimental backend
- `src/workers/engine/whispercppRuntime.ts`
  - low-level bridge to `whisper.cpp` browser artifacts
- `src/workers/engine/whispercppEngine.ts`
  - higher-level engine: model load, transcription, progress, cleanup

### Existing files to update

- `src/App.tsx`
- `src/constants.ts`
- `src/types.ts`
- `src/state.ts`
- `src/lib/storage.ts` or adjacent storage split if needed
- `vite.config.ts`
- `vercel.json`

### Static/runtime assets

- `public/whispercpp/`
  - `libmain.js`
  - worker/runtime assets from the browser build of `whisper.cpp`
  - related `.wasm` files

## Runtime artifact strategy

### Phase 1 recommendation

Do **not** compile `whisper.cpp` from source immediately.

Instead:

- start with the official browser artifacts or a pinned known-good browser build
- vendor them into `public/whispercpp/`
- verify correctness first

### Phase 2 recommendation

Once the spike is stable:

- add a reproducible fetch/build/update script
- pin the exact upstream commit or release
- document the artifact refresh process

This avoids spending time on Emscripten build complexity before validating product fit.

## Model distribution strategy

Do not commit model binaries to the repository.

### Recommended approach

- store model metadata in code
- download quantized model files on demand
- persist installation state in IndexedDB
- store model binary payloads in Cache Storage or OPFS

### Model metadata should include

- `id`
- `label`
- `sizeBytes`
- `downloadUrl`
- `recommendedFor`
- `experimental`
- `minimumDeviceMemoryGb`
- `supportedBrowsers`

## Deployment and browser isolation requirements

`whisper.cpp` browser support becomes much more reliable when the app is cross-origin isolated.

### Required headers to add

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

### Files to update

- `vercel.json`
- dev server headers in `vite.config.ts`

### Validation after adding headers

- `self.crossOriginIsolated === true`
- worker scripts load successfully
- WASM assets load successfully
- no resources are blocked by COEP
- PWA/service worker still functions as expected

## UI integration plan

The existing UI is already structured in a way that supports backend replacement.

### Keep unchanged as much as possible

- upload/dropzone
- selected file details
- transcript output panel
- copy/export actions
- progress card layout

### Update model/runtime section

- show `whisper.cpp` model list instead of current ONNX model list when experimental runtime is active
- expose clear labels such as:
  - `Tiny`
  - `Base`
  - `Small (experimental)`
- optionally add advanced settings:
  - `Threads`
  - `Translate`
  - runtime compatibility notes

### Keep current UX expectations

- install/download model
- start transcription
- cancel transcription
- remove model
- progress updates

## Audio pipeline plan

Reuse the existing browser audio preparation flow where possible:

- decode uploaded file
- downmix to mono
- resample to 16 kHz
- transfer prepared audio to worker

This should remain consistent with the current local-first architecture and reduce UI churn.

Before implementation, verify the exact JS-facing input expected by the chosen `whisper.cpp` browser binding.

## Worker contract design

### Main thread -> worker

- `init`
  - initialize runtime and emit capabilities
- `ensureModel`
  - install/download a model if missing
- `deleteModel`
  - remove local model cache
- `transcribe`
  - run transcription with language/task/options
- `cancel`
  - abort active work if possible, otherwise reset worker

### Worker -> main thread

- `ready`
  - runtime available, capability info included
- `modelState`
  - installed/pending/error state
- `progress`
  - staged progress updates
- `result`
  - transcript result and metadata
- `error`
  - normalized user-facing error

## Progress model

Recommended progress stages for `whisper.cpp`:

- `bootstrap`
  - loading wasm/runtime
- `download`
  - model being fetched
- `prepare`
  - model being opened/initialized
- `decode`
  - audio being prepared
- `transcribe`
  - inference running
- `finalize`
  - transcript packaging/output

This can either extend or map onto the current progress type.

## Error handling policy

The runtime must never surface low-level C++/WASM errors directly without normalization.

Normalize errors into actionable UI messages, for example:

- browser does not support required capabilities
- model too large for this runtime/browser
- transcription cancelled
- model download failed
- runtime initialization failed
- worker lost due to memory pressure

## Detailed implementation phases

### Phase 1: Technical spike

Goal:

- Prove that `whisper.cpp` can transcribe a short file in this repo using a worker.

Tasks:

- add browser runtime assets to `public/whispercpp/`
- create a temporary worker and engine bridge
- load `tiny`
- transcribe a short file
- verify transcript returns to UI

Exit criteria:

- stable local run on Chrome desktop
- no major runtime blockers

### Phase 2: Worker abstraction

Goal:

- make the experimental backend align with the current app contract.

Tasks:

- define backend-neutral or backend-aware message types
- add `whispercpp.worker.ts`
- add worker client wrapper
- normalize progress/result/error payloads

Exit criteria:

- existing UI can trigger `whisper.cpp` without ad hoc special cases everywhere

### Phase 3: Model install/remove flow

Goal:

- replicate the "download once, run later" experience from the current app.

Tasks:

- create model registry
- implement download with progress
- persist install metadata
- implement remove model
- reload installed model state on startup

Exit criteria:

- refresh after model installation keeps model usable

### Phase 4: Cross-origin isolation and deploy readiness

Goal:

- enable reliable threaded/browser runtime conditions.

Tasks:

- update `vercel.json`
- update Vite dev headers
- verify `crossOriginIsolated`
- verify assets under COEP/COOP

Exit criteria:

- preview/prod builds still load correctly

### Phase 5: UI integration

Goal:

- run the experimental runtime inside the current WhisperDrop interface.

Tasks:

- wire runtime selection
- populate model controls from `whisper.cpp` metadata
- show runtime capability warnings
- support install/start/cancel/remove in current panels

Exit criteria:

- user can complete end-to-end flow using existing UI

### Phase 6: Performance and stability pass

Goal:

- determine whether this backend is worth keeping.

Tasks:

- benchmark `tiny` and `base`
- compare against current backend
- measure startup, runtime, memory, and perceived accuracy

Exit criteria:

- documented recommendation: keep experimental only, promote to default, or abandon

## Acceptance criteria for the experimental version

The experimental version is successful if all of the following are true:

- app runs `whisper.cpp` entirely in browser
- current WhisperDrop UI remains the main interface
- `tiny` and `base` install and transcribe successfully
- worker-based cancellation/reset works
- refresh preserves model installation state
- deployment works with required browser headers
- error handling is understandable to end users

## Benchmark plan

### Compare these scenarios

- current backend `tiny`
- `whisper.cpp` `tiny`
- current backend `base`
- `whisper.cpp` `base`

### Metrics

- model download size
- runtime bootstrap time
- time to first transcription
- total transcription time
- stability across repeated runs
- memory pressure symptoms
- quality on Italian and English input

### Decision rule

Promote `whisper.cpp` only if it shows a meaningful practical advantage in at least some combination of:

- stability
- startup speed
- transcript quality
- model portability
- browser runtime simplicity

## Risks

### Technical risks

- COEP/COOP blocking assets or third-party resources
- worker/WASM integration complexity
- asset version drift from upstream `whisper.cpp`
- browser-specific crashes or hangs
- limited debuggability of WASM runtime errors

### Product risks

- `whisper.cpp` may still only be truly usable for `tiny/base`
- deployment complexity may outweigh the benefit over the current backend
- user expectations for large-model support may be impossible to satisfy in-browser

## Recommended first milestone

Implement this first:

1. Add runtime assets.
2. Build a temporary `whisper.cpp` worker.
3. Support only `tiny`.
4. Use current file upload and output UI.
5. Validate on Chrome desktop.

If this first milestone is unstable, stop and reassess before deeper integration.

## Final recommendation

Proceed with a **parallel experimental implementation** on this branch using:

- only `whisper.cpp`
- only `tiny` and `base`
- current WhisperDrop UI
- same local-first user experience
- strict browser/runtime guardrails

Do not commit to full backend replacement until benchmark and deploy validation are complete.
