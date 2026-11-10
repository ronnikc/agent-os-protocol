// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * GitHub repo access via an installation token — the read/write surface the hosted lobby uses on the
 * user's OWN repo: list installed repos, browse the tree, read a file, and land changes as commits or
 * a pull request through the GitHub API. No repo is hosted here; every call is scoped to the
 * installation token minted in appAuth.ts. Agents (server-side), the Files tab, and the KB all go
 * through this one client.
 */

const GITHUB_API = 'https://api.github.com';

export interface RepoRef { owner: string; repo: string; }

export interface GitHubRepoInfo {
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
}

export interface RepoEntry { path: string; type: 'file' | 'dir'; size?: number; sha: string; }

export interface RepoClientOptions { fetchFn?: typeof fetch; }

async function gh<T>(token: string, path: string, init: RequestInit = {}, opts: RepoClientOptions = {}): Promise<T> {
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'agent-os-lobby',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** The repositories the installation can access (the ones the user selected when installing). */
export async function listInstallationRepos(token: string, opts?: RepoClientOptions): Promise<GitHubRepoInfo[]> {
  const data = await gh<{ repositories: GitHubRepoInfo[] }>(token, '/installation/repositories?per_page=100', {}, opts);
  return (data.repositories ?? []).map((r) => ({ full_name: r.full_name, private: r.private, default_branch: r.default_branch, html_url: r.html_url }));
}

/** List a directory in the repo tree at `path` (root when empty), on `ref` (branch/sha). */
export async function listTree(token: string, { owner, repo }: RepoRef, path: string, ref: string, opts?: RepoClientOptions): Promise<RepoEntry[]> {
  const p = path ? `/${path.replace(/^\/+/, '')}` : '';
  const data = await gh<Array<{ path: string; type: string; size?: number; sha: string }>>(
    token, `/repos/${owner}/${repo}/contents${p}?ref=${encodeURIComponent(ref)}`, {}, opts,
  );
  const arr = Array.isArray(data) ? data : [];
  return arr.map((e) => ({ path: e.path, type: e.type === 'dir' ? 'dir' : 'file', size: e.size, sha: e.sha }));
}

/** Read a file's UTF-8 contents (decoded from base64) + its blob sha (needed to update it). */
export async function getFile(token: string, { owner, repo }: RepoRef, path: string, ref: string, opts?: RepoClientOptions): Promise<{ content: string; sha: string }> {
  const data = await gh<{ content?: string; encoding?: string; sha: string; type: string }>(
    token, `/repos/${owner}/${repo}/contents/${path.replace(/^\/+/, '')}?ref=${encodeURIComponent(ref)}`, {}, opts,
  );
  if (data.type !== 'file' || typeof data.content !== 'string') throw new Error(`not a file: ${path}`);
  const content = Buffer.from(data.content, (data.encoding as BufferEncoding) || 'base64').toString('utf-8');
  return { content, sha: data.sha };
}

/**
 * Create or update a single file on `branch` (a commit). Pass the current `sha` to update; omit to
 * create. Returns the new commit sha.
 */
export async function putFile(
  token: string, { owner, repo }: RepoRef,
  args: { path: string; content: string; message: string; branch: string; sha?: string },
  opts?: RepoClientOptions,
): Promise<{ commitSha: string }> {
  const body = {
    message: args.message,
    content: Buffer.from(args.content, 'utf-8').toString('base64'),
    branch: args.branch,
    ...(args.sha ? { sha: args.sha } : {}),
  };
  const data = await gh<{ commit: { sha: string } }>(
    token, `/repos/${owner}/${repo}/contents/${args.path.replace(/^\/+/, '')}`,
    { method: 'PUT', body: JSON.stringify(body) }, opts,
  );
  return { commitSha: data.commit?.sha ?? '' };
}

/** Open a pull request from `head` into `base`. */
export async function openPullRequest(
  token: string, { owner, repo }: RepoRef,
  args: { title: string; head: string; base: string; body?: string },
  opts?: RepoClientOptions,
): Promise<{ number: number; html_url: string }> {
  return gh<{ number: number; html_url: string }>(
    token, `/repos/${owner}/${repo}/pulls`,
    { method: 'POST', body: JSON.stringify({ title: args.title, head: args.head, base: args.base, body: args.body }) }, opts,
  );
}

/** Parse "owner/repo" into a RepoRef. */
export function parseRepoRef(fullName: string): RepoRef {
  const [owner, repo] = String(fullName).split('/');
  if (!owner || !repo) throw new Error(`invalid repo "${fullName}" (expected owner/repo)`);
  return { owner, repo };
}
