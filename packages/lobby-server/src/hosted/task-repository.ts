// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { AsyncLocalStorage } from 'node:async_hooks';
import type { GitHubRepoClient } from './github-repo-client.js';

interface WriteScope {
  branch: string;
  commits: string[];
}

/** Repository tools exposed to an agent. Only the server can authorize a write turn. */
export class TaskRepository {
  private readonly scope = new AsyncLocalStorage<WriteScope>();

  constructor(private readonly client: GitHubRepoClient) {}

  run<T>(scope: WriteScope, turn: () => Promise<T>): Promise<T> {
    return this.scope.run(scope, turn);
  }

  readFile(path: string): Promise<string> {
    return this.client.readFile(path, this.scope.getStore()?.branch);
  }

  listFiles(path: string): Promise<string[]> {
    return this.client.listFiles(path, this.scope.getStore()?.branch);
  }

  async readCiEvidence(): Promise<string> {
    const scope = this.scope.getStore();
    if (!scope) return 'CI evidence requires an assigned repository task.';
    const ref = scope.commits.at(-1) ?? scope.branch;
    const result = await this.client.getCheckRunsForRef(ref);
    return JSON.stringify({
      ref, status: result.status, conclusion: result.conclusion, returnedChecks: result.total,
      checks: result.runs.slice(0, 20).map(run => ({
        name: String(run.name).slice(0, 120), status: run.status, conclusion: run.conclusion,
      })),
    });
  }

  async writeFile(path: string, content: string, message: string): Promise<string> {
    const scope = this.scope.getStore();
    if (!scope) throw new Error('Repository writes require an assigned repository task.');
    const commit = await this.client.writeFile(path, content, message, scope.branch);
    scope.commits.push(commit);
    return commit;
  }

  createPullRequest(): never {
    throw new Error('The lobby manages pull requests for repository tasks.');
  }
}
