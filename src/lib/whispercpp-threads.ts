const THREAD_OVERRIDE_PARAM = "whispercppThreads";
const MAX_WASM_THREADS = 8;

function parsePositiveInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export function getWhisperCppThreadOverride(search: string | null | undefined): number | null {
  if (!search) {
    return null;
  }

  const params = new URLSearchParams(search);
  return parsePositiveInteger(params.get(THREAD_OVERRIDE_PARAM));
}

export function getRecommendedWhisperCppThreads(
  hardwareConcurrency: number | null | undefined,
  search: string | null | undefined = globalThis.location?.search
): number {
  const override = getWhisperCppThreadOverride(search);
  if (override !== null) {
    return override;
  }

  const reported =
    typeof hardwareConcurrency === "number" && Number.isFinite(hardwareConcurrency)
      ? Math.floor(hardwareConcurrency)
      : 4;

  const bounded = Math.min(MAX_WASM_THREADS, Math.max(1, reported));
  const powerOfTwo = 2 ** Math.floor(Math.log2(bounded));
  return Math.max(1, powerOfTwo);
}
