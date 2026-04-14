import { describe, expect, it } from "vitest";
import { fileExtension, isSupportedAudioFile } from "./file";

describe("file helpers", () => {
  it("extracts lowercase extensions", () => {
    expect(fileExtension("VOICE.MP3")).toBe(".mp3");
  });

  it("accepts supported audio uploads", () => {
    const file = new File(["data"], "voice.m4a", { type: "audio/mp4" });
    expect(isSupportedAudioFile(file)).toBe(true);
  });
});
