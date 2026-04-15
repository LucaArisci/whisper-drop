/**
 * Downloads pinned whisper.cpp browser runtime (Emscripten bundle) from the official demo.
 * Run after clone or when refreshing upstream: `node scripts/fetch-whispercpp-assets.mjs`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const destDir = path.join(root, "public", "whispercpp");
const destFile = path.join(destDir, "main.js");
const url = "https://ggml.ai/whisper.cpp/main.js";

await fs.promises.mkdir(destDir, { recursive: true });
const res = await fetch(url);
if (!res.ok) {
  throw new Error(`Failed to download ${url}: ${res.status}`);
}
const buf = Buffer.from(await res.arrayBuffer());
await fs.promises.writeFile(destFile, buf);
console.log(`Wrote ${destFile} (${buf.length} bytes)`);
