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
  async readFile(path: string): Promise<string> {
    const data = await this.request(`/contents/${path}`);
    if (data.type !== 'file') {
      throw new Error(`Path ${path} is not a file`);
    }
    return Buffer.from(data.content, 'base64').toString('utf8');
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
