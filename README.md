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

## Deploying to Vercel

WhisperDrop is intended to deploy to Vercel as a static frontend, not as a server-side transcription service.

In production:

- Vercel serves the app shell, worker bundle, PWA files, and `/ort/*` WASM assets.
- The visitor browser downloads Whisper model files directly from Hugging Face.
- The visitor browser runs decoding and inference locally in the worker.
- Audio files should never be uploaded to a Vercel Function for transcription.

The repository now includes `vercel.json` for Vercel-native headers and SPA rewrites. A detailed deployment checklist lives in `docs/vercel-deployment-plan.md`.

### Vercel project settings

Use these settings when you create the project in Vercel:

- Framework preset: `Vite`
- Install command: `npm install` or `npm ci`
- Build command: `npm run build`
- Output directory: `dist`
- Node version: `20+`

### Vercel verification checklist

After the first deployment:

1. Open the deployed site and confirm the worker becomes ready.
2. Verify `/ort/*` is served from your Vercel domain.
3. Install a model and confirm the download happens in the browser from Hugging Face.
4. Upload a short audio file and run a transcript.
5. Confirm the transcript renders and `.txt` export works.
6. Confirm the deployment contains no serverless functions for inference.

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
