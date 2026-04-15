import { describe, expect, it } from "vitest";
import { WHISPER_CPP_MODELS } from "./whispercpp-models";
import { getAutoLanguageWarning, getModelRuntimeWarning } from "./runtime-support";

const smallModel = WHISPER_CPP_MODELS.find((m) => m.id === "wc-small-q5")!;

describe("getModelRuntimeWarning", () => {
  it("warns when the browser reports too little memory for the model", () => {
    expect(getModelRuntimeWarning(smallModel, 4)).toContain("browser reports 4 GB");
  });

  it("does not warn when the browser reports enough memory", () => {
    expect(getModelRuntimeWarning(smallModel, 8)).toBeNull();
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
