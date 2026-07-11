// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * GitHubRepoClient — lightweight wrapper for the GitHub REST API using the
 * installation token from the lobby's GitHub integration. No external Octokit dependency.
 */
export class GitHubRepoClient {
  /**
   * The branch reads default to and writes commit to when a caller doesn't pass one explicitly.
   * The agent's repo tools (read_file/write_file) pass no branch, so this is how the branch/PR
   * workflow redirects a task's writes onto a per-task branch: set activeBranch for the task, run
   * the agent, then reset. Defaults to the connected working branch.
   */
  public activeBranch: string;

  constructor(
    public readonly owner: string,
    public readonly repo: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    activeBranch = 'main',
  ) {
    this.activeBranch = activeBranch;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}${cleanPath}`;
    const headers = {
      'Authorization': `token ${this.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Agent-OS-Lobby',
      'Content-Type': 'application/json',
      ...options.headers,
    };
    const res = await this.fetchFn(url, { ...options, headers });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`GitHub API error (${res.status}): ${errText || res.statusText}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /** Read a file from the repository, decoding the base64 content. Defaults to `activeBranch`. */
  async readFile(path: string, ref?: string): Promise<string> {
    const useRef = ref ?? this.activeBranch;
    const pathWithQuery = useRef ? `/contents/${path}?ref=${encodeURIComponent(useRef)}` : `/contents/${path}`;
    const data = await this.request(pathWithQuery);
    if (data.type !== 'file') {
      throw new Error(`Path ${path} is not a file`);
    }
    return Buffer.from(data.content, 'base64').toString('utf8');
  }

  /** Read contents of a directory, returning details for each item. Defaults to `activeBranch`. */
  async readDir(path: string, ref?: string): Promise<any[]> {
    const useRef = ref ?? this.activeBranch;
    const pathWithQuery = useRef ? `/contents/${path}?ref=${encodeURIComponent(useRef)}` : `/contents/${path}`;
    const data = await this.request(pathWithQuery);
    if (!Array.isArray(data)) {
      return [];
    }
    return data;
  }

  /**
   * Create or update a file and commit it, resolving the current file SHA if it exists. Commits to
   * `branch` when given, else `activeBranch` (the branch/PR workflow sets activeBranch per task).
   */
  async writeFile(path: string, content: string, message: string, branch?: string): Promise<string> {
    const target = branch ?? this.activeBranch;
    let sha: string | undefined;
    try {
      const pathWithQuery = target ? `/contents/${path}?ref=${encodeURIComponent(target)}` : `/contents/${path}`;
      const existing = await this.request(pathWithQuery);
      if (existing && existing.sha) {
        sha = existing.sha;
      }
    } catch (err: any) {
      // Ignore 404 (file doesn't exist yet)
      if (!err.message.includes('404')) {
        throw err;
      }
    }

    const body = {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
      ...(target ? { branch: target } : {}),
    };

    const res = await this.request(`/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return res.commit.sha;
  }

  /** True for the errors GitHub returns when a repo has no commits / the branch ref is absent. */
  private static isEmptyRepoError(err: unknown): boolean {
    const msg = String((err as Error)?.message ?? err);
    return msg.includes('Git Repository is empty') || (msg.includes('409') && msg.toLowerCase().includes('empty'));
  }

  /**
   * Every file path in the repo at `branch`, in one recursive-tree call (existence checks).
   * An EMPTY repository (no commits yet — a fresh test repo) has no branch ref at all; that is
   * simply "no files", not an error.
   */
  async listTreePaths(branch = 'main'): Promise<Set<string>> {
    let ref: any;
    try {
      ref = await this.request(`/git/ref/heads/${encodeURIComponent(branch)}`);
    } catch (err) {
      if (GitHubRepoClient.isEmptyRepoError(err) || String((err as Error)?.message ?? '').includes('404')) return new Set();
      throw err;
    }
    const commit = await this.request(`/git/commits/${ref.object.sha}`);
    const tree = await this.request(`/git/trees/${commit.tree.sha}?recursive=1`);
    return new Set<string>((tree.tree ?? []).filter((e: any) => e.type === 'blob').map((e: any) => e.path));
  }

  /**
   * Commit many files atomically as ONE commit via the Git Data API (blobs → tree → commit → ref).
   * The contents API (`writeFile`) creates one commit per file — initializing the Agent OS
   * structure writes ~140 files, and 140 commits would spam history and take minutes. Blobs are
   * created in parallel chunks; existing files at the same paths are updated in the same commit.
   *
   * EMPTY repositories (no commits yet) have no ref to anchor the batch on and the Git Data API
   * rejects them (409 "Git Repository is empty"). Bootstrap: write the FIRST file through the
   * contents API — which works on empty repos and creates `branch` with the initial commit — then
   * batch the remainder on top. A fresh, empty test repo is the common first-connect case.
   */
  async commitFiles(files: Array<{ path: string; content: string }>, message: string, branch = 'main'): Promise<string> {
    if (files.length === 0) throw new Error('commitFiles requires at least one file');
    let ref: any;
    let remaining = files;
    try {
      ref = await this.request(`/git/ref/heads/${encodeURIComponent(branch)}`);
    } catch (err) {
      if (!GitHubRepoClient.isEmptyRepoError(err)) throw err;
      // Bootstrap the branch with the first file via the contents API. A concurrent/previous
      // attempt may have just created the branch — GitHub then answers 409 "reference already
      // exists"; treat that as "branch is there now" rather than a failure.
      try {
        const firstSha = await this.writeFile(files[0].path, files[0].content, message, branch);
        remaining = files.slice(1);
        if (remaining.length === 0) return firstSha;
      } catch (bootErr) {
        if (!String((bootErr as Error)?.message ?? '').includes('reference already exists')) throw bootErr;
      }
      // The new ref is not instantly readable (GitHub replication) — the old code fell back to a
      // second contents-API write here, which raced the branch creation and 409'd. Poll instead.
      for (let attempt = 0; attempt < 6 && !ref; attempt++) {
        try { ref = await this.request(`/git/ref/heads/${encodeURIComponent(branch)}`); } catch { /* not yet */ }
        if (!ref) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
      if (!ref) throw new Error(`branch "${branch}" not readable after bootstrap commit — retry initialization`);
    }
    const baseCommitSha = ref.object.sha;
    const baseCommit = await this.request(`/git/commits/${baseCommitSha}`);
    files = remaining;

    // Inline each file's UTF-8 content directly in the tree entries. GitHub creates the blob for
    // every entry with a `content` field implicitly, so N files cost ONE tree call instead of N
    // separate blob POSTs — initializing ~140 seed files went from ~140 API calls to ~1, which is
    // what kept re-initialization from exhausting the installation's hourly rate limit. All seed
    // files are text; a binary path would need the blob route, but the seeder writes none.
    const treeItems = files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }));

    const tree = await this.request('/git/trees', {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeItems }),
    });
    const commit = await this.request('/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [baseCommitSha] }),
    });
    await this.request(`/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });
    return commit.sha;
  }

  /** Create `newBranch` pointing at the tip of `fromBranch`. Idempotent-ish: existing ref is fine. */
  async createBranch(newBranch: string, fromBranch: string): Promise<void> {
    const ref = await this.request(`/git/ref/heads/${encodeURIComponent(fromBranch)}`);
    try {
      await this.request('/git/refs', {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: ref.object.sha }),
      });
    } catch (err) {
      if (!String((err as Error)?.message ?? '').includes('reference already exists')) throw err;
    }
  }

  /** How many commits `branch` is ahead of `base` — used to skip empty PRs. */
  async aheadBy(base: string, branch: string): Promise<number> {
    const cmp = await this.request(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`);
    return typeof cmp.ahead_by === 'number' ? cmp.ahead_by : 0;
  }

  /** Delete a branch ref (used to clean up a task branch the agent never wrote to). */
  async deleteBranch(branch: string): Promise<void> {
    try { await this.request(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'DELETE' }); } catch { /* best effort */ }
  }

  /**
   * CI check-run summary for a ref (branch or SHA): the overall status/conclusion plus per-run
   * detail. `status` is 'completed' only when every run has finished; `conclusion` is 'success' when
   * all completed runs succeeded, 'failure' if any failed, else null (still running / none yet).
   */
  async getCheckRunsForRef(ref: string): Promise<{
    status: 'queued' | 'in_progress' | 'completed' | 'none';
    conclusion: 'success' | 'failure' | null;
    total: number;
    runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string | null }>;
  }> {
    const data = await this.request(`/commits/${encodeURIComponent(ref)}/check-runs`);
    const runs = (data.check_runs ?? []).map((r: any) => ({
      name: r.name, status: r.status, conclusion: r.conclusion ?? null, html_url: r.html_url ?? null,
    }));
    if (runs.length === 0) return { status: 'none', conclusion: null, total: 0, runs };
    const allDone = runs.every((r: any) => r.status === 'completed');
    const anyFailed = runs.some((r: any) => r.conclusion && !['success', 'neutral', 'skipped'].includes(r.conclusion));
    return {
      status: allDone ? 'completed' : (runs.some((r: any) => r.status === 'in_progress') ? 'in_progress' : 'queued'),
      conclusion: allDone ? (anyFailed ? 'failure' : 'success') : null,
      total: runs.length,
      runs,
    };
  }

  /** The failing job/step logs for a ref's check runs — fed back to an agent to fix a red CI run. */
  async getFailingCheckLogs(ref: string, maxChars = 4000): Promise<string> {
    const data = await this.request(`/commits/${encodeURIComponent(ref)}/check-runs`);
    const failed = (data.check_runs ?? []).filter((r: any) => r.conclusion && !['success', 'neutral', 'skipped'].includes(r.conclusion));
    if (failed.length === 0) return '';
    const lines = failed.map((r: any) => {
      const summary = r.output?.summary || r.output?.text || r.output?.title || '(no output captured)';
      return `### ${r.name} — ${r.conclusion}\n${String(summary).slice(0, 1500)}`;
    });
    return lines.join('\n\n').slice(0, maxChars);
  }

  /** Create a new Pull Request. Returns the HTML URL of the PR. */
  async createPullRequest(title: string, head: string, base: string, body?: string): Promise<string> {
    const payload = { title, head, base, body };
    const res = await this.request('/pulls', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.html_url;
  }

  /** List file paths inside a directory path in the repository. */
  async listFiles(path: string = ''): Promise<string[]> {
    const data = await this.request(`/contents/${path}`);
    if (!Array.isArray(data)) {
      return [data.path];
    }
    return data.map((item: any) => item.path);
  }
}
