// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LobbyStore } from '../store.js';
import type { KnowledgeSyncJob } from '../models.js';
import { convertFileToMarkdown } from '../../../knowledge-engine/src/converter.js';
import { graphifyMarkdown } from '../../../knowledge-engine/src/graphify.js';
import { chunkMarkdown } from '../../../knowledge-engine/src/chunker.js';
import { commitAndPushRepo } from './repoWriter.js';

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB limit
const ALLOWED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
  'text/markdown',
  'text/plain'
];

export async function processKnowledgeSyncJob(
  jobId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  store: LobbyStore
): Promise<KnowledgeSyncJob> {
  const job = await store.getKnowledgeSyncJob(jobId);
  if (!job) throw new Error('Job not found');

  await store.upsertKnowledgeSyncJob({
    ...job,
    status: 'running',
    updated_at: new Date().toISOString()
  });

  // 1. Validation filters
  if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
    const errorMsg = 'File exceeds maximum size limit of 50MB';
    return await markJobAsFailed(job, errorMsg, store);
  }

  if (!ALLOWED_MIMES.includes(mimeType)) {
    const errorMsg = `MIME type '${mimeType}' is not on the allowed list`;
    return await markJobAsFailed(job, errorMsg, store);
  }

  // 2. Temp directory isolation & checksum hashing
  const hash = createHash('sha256').update(fileBuffer).digest('hex');
  const tempDir = await mkdtemp(join(tmpdir(), 'agent-os-kb-'));
  const inputFilePath = join(tempDir, fileName);

  try {
    // Write original bytes to temp file
    const fs = await import('node:fs/promises');
    await fs.writeFile(inputFilePath, fileBuffer);

    // 3. Spawns conversion pipeline via markitdown subprocess
    const markdownContent = await convertFileToMarkdown(inputFilePath);

    await store.upsertKnowledgeSyncJob({
      ...job,
      status: 'converted',
      source_sha256: hash,
      updated_at: new Date().toISOString()
    });

    // 4. Index nodes and build knowledge graph visual structures
    const graphData = graphifyMarkdown(markdownContent, fileName);
    const chunksData = chunkMarkdown(markdownContent);
    const provenanceData = {
      job_id: job.id,
      actor_ref: job.created_by_identity_ref,
      lobby_id: job.lobby_id,
      timestamp: new Date().toISOString()
    };

    await store.upsertKnowledgeSyncJob({
      ...job,
      status: 'indexed',
      updated_at: new Date().toISOString()
    });

    // 5. Write to canonical repository and commit-push changes
    const kb = await store.getKnowledgeBase(job.lobby_id);
    if (!kb) {
      throw new Error('Knowledge Base configuration not found for lobby');
    }

    // Mint a fresh installation token via the App JWT — the secret stored at connect time expires
    // after ~1h and silently broke KB pushes an hour after the GitHub App was connected.
    let githubToken: string | null = null;
    const integration = await store.getIntegration(job.lobby_id, 'github');
    if (integration?.status === 'active' && integration.installation_id) {
      const { getInstallationToken } = await import('../integrations/github/appAuth.js');
      githubToken = await getInstallationToken(integration.installation_id).catch(() => null);
    }

    const commitSha = await commitAndPushRepo(
      kb.kb_root_path,
      kb.repository_url,
      kb.branch,
      fileName,
      markdownContent,
      graphData,
      chunksData,
      provenanceData,
      githubToken || undefined
    );

    // 6. Update cache properties
    await store.upsertKnowledgeBase({
      ...kb,
      latest_commit_sha: commitSha,
      last_synced_at: new Date().toISOString(),
      last_indexed_at: new Date().toISOString()
    });

    const finishedJob: KnowledgeSyncJob = {
      ...job,
      status: 'committed',
      source_ref: commitSha,
      source_sha256: hash,
      updated_at: new Date().toISOString()
    };
    return await store.upsertKnowledgeSyncJob(finishedJob);

  } catch (err) {
    return await markJobAsFailed(job, (err as Error).message, store);
  } finally {
    // Clean up temp directories safely
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function markJobAsFailed(
  job: KnowledgeSyncJob,
  error: string,
  store: LobbyStore
): Promise<KnowledgeSyncJob> {
  const updatedJob: KnowledgeSyncJob = {
    ...job,
    status: 'failed',
    error,
    updated_at: new Date().toISOString()
  };
  return await store.upsertKnowledgeSyncJob(updatedJob);
}
