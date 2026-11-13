// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { posix } from 'node:path';
import type { WorkspaceFileTools } from '@agent-os/protocol-core';

/** Restrict model-facing file operations to the staged source tree. */
export function workspaceRelativePath(path: unknown, allowRoot = false): string {
  if (path === '' && allowRoot) return '';
  if (typeof path !== 'string' || !path || path.length > 512 || posix.isAbsolute(path) ||
      /[\\\u0000-\u001f\u007f]/.test(path)) {
    throw new Error('Choose a repository-relative workspace path.');
  }
  if (path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new Error('Choose a repository-relative workspace path.');
  }
  return path;
}

/** The guest implementation must also prevent symlink traversal at the point of access. */
export function workspaceRepository(guest: {
  read(path: string): Promise<string>;
  list(path: string): Promise<string[]>;
  write(path: string, content: string): Promise<void>;
}, signal: AbortSignal): WorkspaceFileTools {
  return {
    async readFile(path) {
      signal.throwIfAborted();
      return (await guest.read(workspaceRelativePath(path))).slice(0, 65_536);
    },
    async listFiles(path) {
      signal.throwIfAborted();
      return (await guest.list(workspaceRelativePath(path, true))).slice(0, 500);
    },
    async writeFile(path, content) {
      signal.throwIfAborted();
      if (typeof content !== 'string' || Buffer.byteLength(content) > 65_536) {
        throw new Error('Workspace file exceeds the write limit.');
      }
      await guest.write(workspaceRelativePath(path), content);
      return 'Staged in the workspace for review';
    },
    createPullRequest() {
      throw new Error('Review the workspace patch before publishing repository changes.');
    },
  };
}
