// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { createHash } from 'node:crypto';

export interface DocumentProvenance {
  sourceName: string;
  conversionTime: string;
  sha256: string;
  compiler: string;
}

/** Generate a provenance header string to prepended to markdown files. */
export function generateProvenanceHeader(provenance: DocumentProvenance): string {
  return `<!--
provenance:
  source: "${provenance.sourceName}"
  converted_at: "${provenance.conversionTime}"
  sha256: "${provenance.sha256}"
  compiler: "${provenance.compiler}"
-->\n\n`;
}

/** Prepend provenance metadata to the converted markdown. */
export function wrapMarkdownWithProvenance(markdown: string, sourceName: string): string {
  const sha256 = createHash('sha256').update(markdown).digest('hex');
  const provenance: DocumentProvenance = {
    sourceName,
    conversionTime: new Date().toISOString(),
    sha256,
    compiler: 'markitdown-v0.2.0'
  };

  return generateProvenanceHeader(provenance) + markdown;
}
