// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { LobbyStore } from '../store.js';

export interface GoogleDriveFileSelection {
  fileId: string;
  name: string;
  mimeType: string;
  accessToken: string;
}

export interface DownloadedDriveFile {
  name: string;
  mimeType: string;
  content: Buffer;
}

/** Download a selected file from Google Drive via Picker OAuth token under drive.file scope. */
export async function downloadGoogleDriveFile(
  selection: GoogleDriveFileSelection,
  _store: LobbyStore
): Promise<DownloadedDriveFile> {
  // Production URL resolves via standard Google Drive files API
  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${selection.fileId}?alt=media`;

  try {
    const res = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${selection.accessToken}`
      }
    });

    if (!res.ok) {
      throw new Error(`Google API returned HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const content = Buffer.from(arrayBuffer);

    return {
      name: selection.name,
      mimeType: selection.mimeType,
      content
    };
  } catch (err) {
    throw new Error(`Failed to download file from Google Drive: ${(err as Error).message}`);
  }
}
