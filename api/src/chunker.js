'use strict';

/**
 * Simple fixed-size text chunker with overlap.
 *
 * Splits text into segments of approximately `chunkSize` characters,
 * with `overlap` characters shared between consecutive chunks.
 * This is intentionally naive -- advanced chunking (sentence-aware,
 * semantic) is out of scope for this learning project.
 */

/**
 * Split text into overlapping chunks.
 *
 * @param {string} text       The input text to chunk.
 * @param {number} [chunkSize=500]  Target size of each chunk in characters.
 * @param {number} [overlap=50]     Number of overlapping characters between chunks.
 * @returns {{ text: string, chunkIndex: number }[]}
 */
function chunkText(text, chunkSize = 500, overlap = 50) {
  if (!text || text.length === 0) return [];
  if (chunkSize <= 0) throw new Error('chunkSize must be positive');
  if (overlap < 0) throw new Error('overlap must be non-negative');
  if (overlap >= chunkSize) throw new Error('overlap must be less than chunkSize');

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push({
      text: text.slice(start, end),
      chunkIndex,
    });
    chunkIndex++;

    // Advance by (chunkSize - overlap), but if we've reached the end, stop
    const nextStart = start + chunkSize - overlap;
    if (nextStart >= text.length) break;
    start = nextStart;
  }

  return chunks;
}

module.exports = { chunkText };
