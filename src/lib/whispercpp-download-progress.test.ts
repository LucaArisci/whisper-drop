import { describe, expect, it } from "vitest";
import { whisperCppStreamDownloadRatio } from "./whispercpp-download-progress";

describe("whisperCppStreamDownloadRatio", () => {
  it("uses Content-Length when the CDN sends it", () => {
    expect(whisperCppStreamDownloadRatio(50, 100, 999)).toBe(0.5);
  });

  it("falls back to catalog size when Content-Length is missing (HF LFS)", () => {
    expect(whisperCppStreamDownloadRatio(10_000_000, 0, 20_000_000)).toBe(0.5);
  });

  it("returns a small non-zero hint when no size is known but bytes arrived", () => {
    expect(whisperCppStreamDownloadRatio(1024, 0, 0)).toBe(0.05);
  });
});
