/**
 * Parses realtime printf lines from whisper.cpp WASM (see upstream emscripten.cpp: print_realtime).
 */
export function parseWhisperCppConsoleLines(lines: string[]): string {
  const re = /^\[[\d:.]+\s*-->\s*[\d:.]+\]\s*(.*)$/;
  const parts: string[] = [];

  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      const chunk = m[1].trim();
      if (chunk) {
        parts.push(chunk);
      }
    }
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}
