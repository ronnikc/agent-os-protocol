// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Minimal Server-Sent-Events reader. Both the OpenAI- and Anthropic-compatible streaming APIs
 * emit `data: <payload>` lines; this yields each payload string (the caller parses JSON and
 * handles sentinels like `[DONE]`). Uses the reader API so it works against any web
 * ReadableStream (Node's global `fetch` and an injected fake `new Response(...)` alike).
 */
export async function* readSseData(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    const tail = buffer.replace(/\r$/, '');
    if (tail.startsWith('data:')) yield tail.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}
