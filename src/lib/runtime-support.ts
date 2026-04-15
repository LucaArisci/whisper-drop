import type { ModelDefinition } from "../types";

type NavigatorWithDeviceMemory = Navigator & {
  deviceMemory?: number;
};

export function getReportedDeviceMemory(): number | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  const deviceMemory = (navigator as NavigatorWithDeviceMemory).deviceMemory;
  return typeof deviceMemory === "number" && Number.isFinite(deviceMemory) ? deviceMemory : null;
}

export function getModelRuntimeWarning(
  model: ModelDefinition,
  deviceMemory: number | null
): string | null {
  if (!model.minimumDeviceMemoryGb || deviceMemory === null) {
    return null;
  }

  if (deviceMemory >= model.minimumDeviceMemoryGb) {
    return null;
  }

  return `${model.label} usually needs a browser reporting at least ${model.minimumDeviceMemoryGb} GB of device memory. This browser reports ${deviceMemory} GB, so transcription may fail.`;
}

export function normalizeOrtRuntimeError(error: unknown, model: ModelDefinition): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (/failed to call OrtRun\(\)\. error code = 6/i.test(message)) {
    if (model.id === "medium") {
      return new Error(
        `${model.label} ran out of browser memory during transcription. This model is often too large for ONNX Runtime Web. Try Small, Base, or Tiny instead.`
      );
    }

    return new Error(
      `${model.label} hit a browser runtime memory limit during transcription. Try a smaller model or a shorter audio clip.`
    );
  }

  return error instanceof Error ? error : new Error(message);
}
