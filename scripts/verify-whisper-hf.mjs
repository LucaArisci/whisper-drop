/**
 * Smoke-check: Hugging Face serves the tiny Q5 model and streaming yields bytes.
 * Run: node scripts/verify-whisper-hf.mjs
 */
const url =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin";

const res = await fetch(url, { redirect: "follow" });
if (!res.ok) {
  console.error("HTTP", res.status);
  process.exit(1);
}
const cl = res.headers.get("content-length");
console.log("status", res.status, "content-length", cl ?? "(missing)");
const reader = res.body?.getReader();
if (!reader) {
  console.error("No body reader");
  process.exit(1);
}
let n = 0;
while (true) {
  const { done, value } = await reader.read();
  if (done) {
    break;
  }
  n += value.byteLength;
  if (n > 512 * 1024) {
    break;
  }
}
console.log("read first bytes OK, bytes:", n);
process.exit(0);
