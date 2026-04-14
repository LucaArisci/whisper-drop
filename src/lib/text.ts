function isBoundaryCharacter(value: string | undefined): boolean {
  return value === undefined || /\s|[.,!?;:()[\]{}"'-]/.test(value);
}

function longestSuffixPrefix(left: string, right: string): number {
  const max = Math.min(left.length, right.length);

  for (let length = max; length > 0; length -= 1) {
    const leftSlice = left.slice(-length);
    const rightSlice = right.slice(0, length);
    const leftBefore = left.slice(-length - 1, -length) || undefined;
    const rightAfter = right.charAt(length) || undefined;

    if (
      leftSlice === rightSlice &&
      isBoundaryCharacter(leftBefore) &&
      isBoundaryCharacter(rightAfter)
    ) {
      return length;
    }
  }

  return 0;
}

export function mergeChunkTranscripts(parts: string[]): string {
  return parts.reduce((merged, nextPart) => {
    const left = merged.trimEnd();
    const right = nextPart.trimStart();

    if (!left) {
      return right;
    }

    if (!right) {
      return left;
    }

    const exactOverlap = longestSuffixPrefix(left, right);
    if (exactOverlap > 0) {
      return `${left}${right.slice(exactOverlap)}`;
    }

    return `${left}\n${right}`;
  }, "");
}

export function resolveTranscriptText(result: {
  text?: string;
  chunks?: Array<{ text?: string }>;
}): string {
  const directText = result.text?.trim() ?? "";
  if (directText) {
    return directText;
  }

  if (!Array.isArray(result.chunks)) {
    return "";
  }

  return mergeChunkTranscripts(
    result.chunks
      .map((chunk) => chunk.text?.trim() ?? "")
      .filter((chunkText) => chunkText.length > 0)
  ).trim();
}
