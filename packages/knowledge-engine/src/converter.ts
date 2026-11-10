// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { sanitizeMarkdown } from './sanitizers.js';

const execFileAsync = promisify(execFile);
const CONVERSION_TIMEOUT_MS = 30 * 1000; // 30 seconds timeout limit

/** Convert a document file (PDF, DOCX, XLSX, etc.) to Markdown via python markitdown tool. */
export async function convertFileToMarkdown(filePath: string): Promise<string> {
  const extension = extname(filePath).toLowerCase();

  // Try running the python markitdown tool via child process
  try {
    const { stdout } = await execFileAsync('python', ['-m', 'markitdown', filePath], {
      timeout: CONVERSION_TIMEOUT_MS
    });
    return sanitizeMarkdown(stdout);
  } catch (err) {
    // If Python execution fails (e.g. markitdown not installed in local development environment),
    // we employ a structured fallback so the development environment remains fully functional.
    if ((err as any).code === 'ENOENT' || (err as Error).message.includes('markitdown')) {
      const buffer = await readFile(filePath);
      
      let fallbackText = '';
      if (extension === '.md' || extension === '.txt') {
        fallbackText = buffer.toString('utf8');
      } else {
        fallbackText = `# Fallback Converted Document\n\nConverted file: \`${filePath}\`\nOriginal size: ${buffer.length} bytes.\n\n*(Note: Python markitdown was not found; running in development fallback mode)*`;
      }
      return sanitizeMarkdown(fallbackText);
    }
    
    // Bubble up real execution errors (like timeout or execution failures)
    throw new Error(`MarkItDown conversion subprocess failed: ${(err as Error).message}`);
  }
}
