// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/** Clean up converted markdown outputs, removing raw byte sequences or excessive padding. */
export function sanitizeMarkdown(rawMarkdown: string): string {
  if (!rawMarkdown) return '';

  return rawMarkdown
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove excessive consecutive blank lines
    .replace(/\n{4,}/g, '\n\n\n')
    // Trim surrounding white spaces
    .trim();
}
