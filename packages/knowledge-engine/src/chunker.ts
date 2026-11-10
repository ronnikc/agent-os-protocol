// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

export interface TextChunk {
  index: number;
  text: string;
  wordCount: number;
}

/** Segment a markdown document into semantic chunks of a target size. */
export function chunkMarkdown(text: string, maxChunkLength = 1000): TextChunk[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: TextChunk[] = [];
  
  let currentChunk = '';
  let chunkIdx = 0;

  for (const para of paragraphs) {
    if ((currentChunk + para).length > maxChunkLength && currentChunk.length > 0) {
      chunks.push({
        index: chunkIdx++,
        text: currentChunk.trim(),
        wordCount: currentChunk.split(/\s+/).filter(Boolean).length
      });
      currentChunk = '';
    }
    currentChunk += (currentChunk ? '\n\n' : '') + para;
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({
      index: chunkIdx++,
      text: currentChunk.trim(),
      wordCount: currentChunk.split(/\s+/).filter(Boolean).length
    });
  }

  return chunks;
}
