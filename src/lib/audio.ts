import type { DecodedAudioPayload } from "../types";

export async function decodeAndResampleAudio(
  file: File,
  onProgress?: (percent: number, message: string) => void
): Promise<DecodedAudioPayload> {
  onProgress?.(5, "Reading audio file...");
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    onProgress?.(20, "Decoding audio...");
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const targetRate = 16000;
    const durationSeconds = decodedBuffer.duration;
    const frameCount = Math.ceil(durationSeconds * targetRate);

    onProgress?.(45, "Resampling to 16 kHz mono...");
    const offlineContext = new OfflineAudioContext(1, frameCount, targetRate);
    const source = offlineContext.createBufferSource();
    const monoBuffer = offlineContext.createBuffer(
      1,
      decodedBuffer.length,
      decodedBuffer.sampleRate
    );

    const monoChannel = monoBuffer.getChannelData(0);
    for (let channel = 0; channel < decodedBuffer.numberOfChannels; channel += 1) {
      const input = decodedBuffer.getChannelData(channel);
      for (let index = 0; index < input.length; index += 1) {
        monoChannel[index] += input[index] / decodedBuffer.numberOfChannels;
      }
    }

    source.buffer = monoBuffer;
    source.connect(offlineContext.destination);
    source.start(0);
    const rendered = await offlineContext.startRendering();
    onProgress?.(90, "Audio ready for transcription.");

    return {
      sampleRate: targetRate,
      samples: rendered.getChannelData(0),
      durationSeconds
    };
  } finally {
    await audioContext.close();
  }
}
