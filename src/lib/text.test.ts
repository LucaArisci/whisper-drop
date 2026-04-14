import { describe, expect, it } from "vitest";
import { mergeChunkTranscripts, resolveTranscriptText } from "./text";

describe("mergeChunkTranscripts", () => {
  it("removes exact overlap at chunk boundaries", () => {
    expect(mergeChunkTranscripts(["hello world", "world again"])).toBe("hello world again");
  });

  it("preserves both chunks when overlap is not exact", () => {
    expect(mergeChunkTranscripts(["hello world", "worlds apart"])).toBe(
      "hello world\nworlds apart"
    );
  });
});

describe("resolveTranscriptText", () => {
  it("prefers direct transcript text when available", () => {
    expect(
      resolveTranscriptText({
        text: "ciao mondo",
        chunks: [{ text: "ignored" }]
      })
    ).toBe("ciao mondo");
  });

  it("falls back to chunk text when direct text is empty", () => {
    expect(
      resolveTranscriptText({
        text: "",
        chunks: [{ text: "ciao mondo" }, { text: "mondo ancora" }]
      })
    ).toBe("ciao mondo ancora");
  });
});
