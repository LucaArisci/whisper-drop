export interface AudioChunk {
  index: number;
  startSample: number;
  endSample: number;
  startSeconds: number;
  endSeconds: number;
  samples: Float32Array;
}

export function buildAudioChunks(
  samples: Float32Array,
  sampleRate: number,
  chunkSeconds: number,
  overlapSeconds: number
): AudioChunk[] {
  const chunkSize = Math.max(1, Math.floor(sampleRate * chunkSeconds));
  const overlapSize = Math.max(0, Math.floor(sampleRate * overlapSeconds));
  const step = Math.max(1, chunkSize - overlapSize);
  const chunks: AudioChunk[] = [];

  for (let start = 0, index = 0; start < samples.length; start += step, index += 1) {
    const end = Math.min(samples.length, start + chunkSize);
    const slice = samples.slice(start, end);
    chunks.push({
      index,
      startSample: start,
      endSample: end,
      startSeconds: start / sampleRate,
      endSeconds: end / sampleRate,
      samples: slice
    });

    if (end >= samples.length) {
      break;
    }
  }

  return chunks;
}
