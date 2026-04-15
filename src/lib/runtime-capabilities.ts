import type { WhisperCppRuntimeCapabilities } from "../types";

export type { WhisperCppRuntimeCapabilities };

export function readMainThreadCapabilities(): WhisperCppRuntimeCapabilities {
  const crossOriginIsolated =
    typeof self !== "undefined" && "crossOriginIsolated" in self
      ? Boolean(self.crossOriginIsolated)
      : false;

  const pthreads = typeof SharedArrayBuffer !== "undefined";

  let simd = false;
  try {
    // Minimal SIMD opcode probe (v128.const) — same idea as upstream whisper.cpp demo.
    simd = WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
      ])
    );
  } catch {
    simd = false;
  }

  return { crossOriginIsolated, simd, pthreads };
}

export function getWhisperCppBackendWarning(
  caps: WhisperCppRuntimeCapabilities | null
): string | null {
  if (!caps) {
    return null;
  }

  if (!caps.crossOriginIsolated) {
    return "whisper.cpp in this browser is not running in a cross-origin isolated context. Pthreads and SIMD may be disabled and transcription can fail. Use Chrome/Edge over HTTPS (or local dev with COOP/COEP headers).";
  }

  if (!caps.pthreads) {
    return "SharedArrayBuffer is unavailable, so whisper.cpp cannot use pthread workers. Try a recent Chromium browser with cross-origin isolation enabled.";
  }

  if (!caps.simd) {
    return "WebAssembly SIMD is not available. The whisper.cpp build used here expects SIMD support.";
  }

  return null;
}
