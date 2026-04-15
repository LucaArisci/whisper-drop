import { describe, expect, it } from "vitest";
import { MODELS } from "../constants";
import {
  getAutoLanguageWarning,
  getModelRuntimeWarning,
  normalizeOrtRuntimeError
} from "./runtime-support";

describe("getModelRuntimeWarning", () => {
  it("warns when the browser reports too little memory for the model", () => {
    expect(getModelRuntimeWarning(MODELS[3], 8)).toContain("browser reports 8 GB");
  });

  it("does not warn when the browser reports enough memory", () => {
    expect(getModelRuntimeWarning(MODELS[3], 16)).toBeNull();
  });
});

describe("normalizeOrtRuntimeError", () => {
  it("turns OrtRun code 6 into a model-specific memory message", () => {
    expect(
      normalizeOrtRuntimeError(
        new Error("failed to call OrtRun(). error code = 6."),
        MODELS[3]
      ).message
    ).toContain("ran out of browser memory");
  });
});

describe("getAutoLanguageWarning", () => {
  it("warns when auto language is used on a long recording", () => {
    expect(getAutoLanguageWarning("auto", 121)).toContain("Choose the spoken language manually");
  });

  it("does not warn when a language is explicitly selected", () => {
    expect(getAutoLanguageWarning("it", 3600)).toBeNull();
  });
});
