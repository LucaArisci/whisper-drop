import { describe, expect, it } from "vitest";
import { buildAudioChunks } from "./chunking";

describe("buildAudioChunks", () => {
  it("creates overlapped windows without skipping the tail", () => {
    const samples = new Float32Array(16000 * 65);
    const chunks = buildAudioChunks(samples, 16000, 30, 2);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].startSeconds).toBe(0);
    expect(chunks[1].startSeconds).toBe(28);
    expect(chunks[2].endSeconds).toBe(65);
  });
});
