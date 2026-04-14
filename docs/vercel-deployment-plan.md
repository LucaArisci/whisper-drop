# WhisperDrop On Vercel

## Goal

Deploy `WhisperDrop` to Vercel as a static frontend and keep all transcription work on the visitor device.

That means:

- Vercel serves the app shell, static assets, service worker, and local ONNX Runtime WASM files.
- The browser downloads Whisper model files directly from Hugging Face.
- Audio decoding, model loading, and inference run in the browser worker on the user's device.
- No Vercel Function, API route, or server-side model execution is part of this architecture.

## Architecture Boundary

The intended production flow is:

1. User opens the site hosted on Vercel.
2. Browser downloads HTML, CSS, JS, PWA assets, and `/ort/*` from Vercel.
3. Browser downloads model weights from Hugging Face when the user installs a model.
4. Browser caches model files locally using the browser cache and IndexedDB metadata.
5. Browser decodes the audio file and sends samples to the web worker.
6. Browser worker runs `@xenova/transformers` + ONNX Runtime Web locally.
7. Transcript is rendered and exported in the browser.

Vercel should never receive the audio file for transcription and should never execute Whisper itself.

## Repo Changes Implemented

This repository has been prepared for Vercel with:

- `vercel.json`
  - Adds a SPA rewrite so future client-side routes resolve to `index.html`.
  - Adds `X-Content-Type-Options: nosniff`.
  - Adds long-lived caching for `/ort/*`.
  - Forces revalidation for `sw.js` and `manifest.webmanifest`.
- `package.json`
  - Pins the runtime expectation with `engines.node >= 20`.
- `README.md`
  - Documents the Vercel deployment model and the local-only inference boundary.

## Vercel Dashboard Setup

When you connect the repo in Vercel, configure it like this:

1. Import the Git repository into Vercel.
2. Confirm the framework is detected as `Vite`.
3. Use `npm install` or `npm ci` as the install command.
4. Use `npm run build` as the build command.
5. Use `dist` as the output directory if Vercel does not detect it automatically.
6. Keep the Node version aligned with `package.json` (`>=20`).
7. Do not add API routes or serverless functions for transcription.
8. Do not add environment variables for inference unless you later introduce unrelated features.

## Why This Still Counts As Local-Only

Hosting on Vercel does not make inference server-side by itself.

Inference remains local because:

- the app uses a browser worker, not a backend route
- the runtime is `@xenova/transformers` running in the browser
- ONNX Runtime Web loads from `/ort/`
- model weights are fetched by the browser and cached in the browser
- transcription starts only after the user provides a local file in the client

The main thing to avoid is adding a backend endpoint that accepts uploaded audio for transcription. That would change the architecture and break the local-first guarantee.

## Post-Deploy Verification Checklist

After the first Vercel deployment, verify this in the browser:

1. Open the deployed site and confirm the app renders without console crashes.
2. Confirm the worker reaches the ready state.
3. Open DevTools network and verify `/ort/*` loads from the Vercel domain.
4. Install `Tiny` and confirm model downloads come from Hugging Face in the browser, not from a Vercel Function.
5. Upload a short audio file and run a transcript.
6. Confirm the transcript appears in the UI and `.txt` export works.
7. Reload the page and confirm installed models stay available from browser cache.
8. In the Vercel deployment details, confirm there are no serverless functions involved in the app.

## Things To Avoid

- Do not proxy model downloads through Vercel unless you intentionally want Vercel bandwidth costs and a different privacy model.
- Do not add an `/api/transcribe` endpoint for Whisper inference.
- Do not move audio preprocessing to the server.
- Do not enable threaded ONNX Runtime casually. The current setup uses one thread and avoids cross-origin isolation requirements.

## Future Notes

If you later add:

- client-side routing: keep the SPA rewrite in `vercel.json`
- multi-threaded ONNX Runtime: you will need to revisit cross-origin isolation headers
- stricter CSP: test worker loading, WASM execution, and Hugging Face fetches carefully

## Safe Mental Model

Use Vercel as a CDN and static host for the app.

Do not use Vercel as the transcription runtime.
