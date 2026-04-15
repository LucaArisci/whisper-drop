/**
 * Shared logic with `public/whispercpp/bootstrap-worker.js` streaming download:
 * prefer Content-Length when present, otherwise fall back to the catalog size.
 */
export function whisperCppStreamDownloadRatio(
  loaded: number,
  contentLengthFromHeader: number,
  expectedBytesFromCatalog: number
): number {
  const denom =
    contentLengthFromHeader > 0 ? contentLengthFromHeader : expectedBytesFromCatalog;
  if (denom > 0) {
    return Math.min(0.999, loaded / denom);
  }
  return loaded > 0 ? 0.05 : 0;
}
