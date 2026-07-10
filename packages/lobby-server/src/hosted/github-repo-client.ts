// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * GitHubRepoClient — lightweight wrapper for the GitHub REST API using the
 * installation token from the lobby's GitHub integration. No external Octokit dependency.
 */
export class GitHubRepoClient {
  constructor(
    public readonly owner: string,
    public readonly repo: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch
  ) {}

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

  /** Read a file from the repository, decoding the base64 content. */
  async readFile(path: string, ref?: string): Promise<string> {
    const pathWithQuery = ref ? `/contents/${path}?ref=${ref}` : `/contents/${path}`;
    const data = await this.request(pathWithQuery);
    if (data.type !== 'file') {
      throw new Error(`Path ${path} is not a file`);
    }
    return Buffer.from(data.content, 'base64').toString('utf8');
  }

  /** Read contents of a directory, returning details for each item. */
  async readDir(path: string, ref?: string): Promise<any[]> {
    const pathWithQuery = ref ? `/contents/${path}?ref=${ref}` : `/contents/${path}`;
    const data = await this.request(pathWithQuery);
    if (!Array.isArray(data)) {
      return [];
    }
    return data;
  }

  /** Create or update a file in the repository, automatically resolving the current file SHA if it exists. */
  async writeFile(path: string, content: string, message: string, branch?: string): Promise<string> {
    let sha: string | undefined;
    try {
      const pathWithQuery = branch ? `/contents/${path}?ref=${branch}` : `/contents/${path}`;
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
      ...(branch ? { branch } : {}),
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
    try {
      ref = await this.request(`/git/ref/heads/${encodeURIComponent(branch)}`);
    } catch (err) {
      if (!GitHubRepoClient.isEmptyRepoError(err)) throw err;
      const [first, ...rest] = files;
      const firstSha = await this.writeFile(first.path, first.content, message, branch);
      if (rest.length === 0) return firstSha;
      return this.commitFiles(rest, message, branch);
    }
    const baseCommitSha = ref.object.sha;
    const baseCommit = await this.request(`/git/commits/${baseCommitSha}`);

    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    const CHUNK = 10;
    for (let i = 0; i < files.length; i += CHUNK) {
      const chunk = files.slice(i, i + CHUNK);
      const blobs = await Promise.all(chunk.map(f =>
        this.request('/git/blobs', {
          method: 'POST',
          body: JSON.stringify({ content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' }),
        })));
      chunk.forEach((f, j) => treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: blobs[j].sha }));
    }

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
