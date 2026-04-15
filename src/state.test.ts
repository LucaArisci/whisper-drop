import { describe, expect, it } from "vitest";
import { initialAppState } from "./state";

describe("initialAppState", () => {
  it("starts idle with no file and no transcript", () => {
    expect(initialAppState.selectedFile).toBeNull();
    expect(initialAppState.transcript).toBeNull();
    expect(initialAppState.busy).toBe(false);
  });
});
