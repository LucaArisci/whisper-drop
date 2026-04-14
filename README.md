# WhisperDrop PWA

WhisperDrop is a local-first Progressive Web App that keeps transcription on the device after the initial app and model download.

## What is included

- React + Vite + TypeScript frontend
- Installable PWA shell with offline app caching
- Drag/drop and file-picker audio upload
- Browser-side decode + resample to 16 kHz mono
- Dedicated transcription worker boundary
- Browser-cached Whisper models powered by Transformers.js + ONNX Runtime Web
- Transcript preview, copy, and `.txt` export
- Original macOS/Tkinter implementation preserved in `legacy/`

## Important note about the inference runtime

The browser runtime uses `@xenova/transformers` with ONNX Runtime Web in a dedicated worker. Model files are downloaded from Hugging Face the first time you install a model, then cached by the browser so later runs can stay local and work offline.

The app always transcribes from the local browser cache after installation. If you clear site data or browser cache, install the model again before running another transcript.

Audio is decoded on the main thread, resampled to 16 kHz mono, and then transferred to the worker so long files do not incur an extra structured-clone copy before inference starts.

## Development

```bash
npm install
npm run dev
```

The dev server binds to `http://127.0.0.1:5173`.

## Local ONNX assets

The app expects these ONNX Runtime WebAssembly assets to be served from `public/ort/`:

- `ort-wasm.wasm`
- `ort-wasm-threaded.wasm`
- `ort-wasm-simd.wasm`
- `ort-wasm-simd-threaded.wasm`

They are copied from `node_modules/@xenova/transformers/dist/` so the worker can load ONNX Runtime from the same origin instead of falling back to a CDN.

## Legacy desktop app

The previous macOS desktop implementation is preserved in `legacy/` for reference during the migration.
