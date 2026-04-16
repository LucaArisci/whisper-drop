# WhisperDrop PWA

WhisperDrop is a local-first Progressive Web App that keeps transcription on the device after the initial app and model download.

## What is included

- React + Vite + TypeScript frontend
- Installable PWA shell with offline app caching
- Drag/drop and file-picker audio upload
- Browser-side decode + resample to 16 kHz mono
- **whisper.cpp** in a dedicated Web Worker (WASM + pthreads when cross-origin isolated)
- GGML models downloaded from Hugging Face (`ggerganov/whisper.cpp`) into IndexedDB in the worker
- Transcript preview, copy, and ` .txt` export
- Original macOS/Tkinter implementation preserved in `legacy/`

## Inference runtime

The app uses the official whisper.cpp browser build served from `public/whispercpp/` (`bootstrap-worker.js` + `main.js` + WASM). Models are cached in the worker’s IndexedDB store. After installation, transcription stays local (offline-capable for cached assets).

Audio is decoded on the main thread, resampled to 16 kHz mono, and then transferred to the worker so long files avoid an extra structured-clone copy before inference.

## Development

```bash
npm install
npm run dev
```

### Test audio

A short MP3 for manual checks lives at `public/fixtures/sample.mp3` (drag it into WhisperDrop or pick it from disk).

To verify Hugging Face can stream a whisper.cpp model: `npm run verify:whisper-hf`.

To smoke-test whisper.cpp in headless Chrome: start the dev server, then `npm run verify:whispercpp-smoke` (set `WHISPER_APP_URL` / `WHISPER_TEST_AUDIO` if needed).

The dev server uses **port 24680** with `strictPort: true` (see `vite.config.ts`). If it is already in use, stop the other process or run `npm run dev -- --port 3000` and open that URL in the browser. Use either `http://127.0.0.1:24680/` or `http://localhost:24680/` — the server listens on all local interfaces. Preview uses port **27272** the same way.

### Refresh whisper.cpp glue from upstream

```bash
node scripts/fetch-whispercpp-assets.mjs
```

## Legacy desktop app

The previous macOS desktop implementation is preserved in `legacy/` for reference during the migration.
