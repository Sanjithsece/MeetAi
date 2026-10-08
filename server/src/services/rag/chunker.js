/**
 * Splits text into overlapping chunks, preferring paragraph, then sentence,
 * then word boundaries so a chunk rarely cuts a thought in half.
 */
export function chunkText(text, { size = 1200, overlap = 200 } = {}) {
  const clean = String(text ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const safeOverlap = Math.max(0, Math.min(overlap, Math.floor(size / 2)));
  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const minCut = Math.floor(size * 0.5);
      const boundary = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf(" ")].find(
        (index) => index >= minCut
      );
      if (boundary !== undefined) end = start + boundary + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    // Step back by the overlap, then forward to the next whitespace so the
    // next chunk never begins with a word fragment.
    let next = Math.max(end - safeOverlap, start + 1);
    if (next > 0 && !/\s/.test(clean[next - 1])) {
      const space = clean.slice(next, end).search(/\s/);
      next = space === -1 ? end : next + space + 1;
    }
    start = next;
  }
  return chunks;
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
