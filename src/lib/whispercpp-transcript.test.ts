import { describe, expect, it } from "vitest";
import { parseWhisperCppConsoleLines } from "./whispercpp-transcript";

describe("parseWhisperCppConsoleLines", () => {
  it("extracts segment text from whisper.cpp realtime lines", () => {
    const lines = [
      "system_info: n_threads = 4",
      "[00:00.000 --> 00:02.500]  Hello world",
      "[00:02.500 --> 00:05.000]  from whisper"
    ];
    expect(parseWhisperCppConsoleLines(lines)).toBe("Hello world from whisper");
  });

  it("returns empty string when there are no segments", () => {
    expect(parseWhisperCppConsoleLines(["no timestamps here"])).toBe("");
  });
});
