import { describe, expect, it } from "vitest";
import {
  getRecommendedWhisperCppThreads,
  getWhisperCppThreadOverride
} from "./whispercpp-threads";

describe("getWhisperCppThreadOverride", () => {
  it("reads a positive override from the URL query string", () => {
    expect(getWhisperCppThreadOverride("?whispercppThreads=12")).toBe(12);
  });

  it("ignores missing or invalid override values", () => {
    expect(getWhisperCppThreadOverride("")).toBeNull();
    expect(getWhisperCppThreadOverride("?whispercppThreads=0")).toBeNull();
    expect(getWhisperCppThreadOverride("?whispercppThreads=abc")).toBeNull();
  });
});

describe("getRecommendedWhisperCppThreads", () => {
  it("defaults to 4 threads when the browser does not report concurrency", () => {
    expect(getRecommendedWhisperCppThreads(undefined)).toBe(4);
  });

  it("keeps low thread counts intact", () => {
    expect(getRecommendedWhisperCppThreads(1)).toBe(1);
    expect(getRecommendedWhisperCppThreads(2)).toBe(2);
    expect(getRecommendedWhisperCppThreads(4)).toBe(4);
  });

  it("rounds down to the nearest power of two like upstream whisper.wasm", () => {
    expect(getRecommendedWhisperCppThreads(6)).toBe(4);
    expect(getRecommendedWhisperCppThreads(12)).toBe(8);
  });

  it("caps at 8 threads for browser WASM", () => {
    expect(getRecommendedWhisperCppThreads(8)).toBe(8);
    expect(getRecommendedWhisperCppThreads(12)).toBe(8);
    expect(getRecommendedWhisperCppThreads(16)).toBe(8);
    expect(getRecommendedWhisperCppThreads(24)).toBe(8);
  });

  it("uses an explicit URL override when present", () => {
    expect(getRecommendedWhisperCppThreads(24, "?whispercppThreads=6")).toBe(6);
  });
});
