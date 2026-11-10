// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify that a request's headers signature matches the raw body bytes and Slack signing secret. */
export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined
): boolean {
  if (!timestampHeader || !signatureHeader) return false;

  // Prevent replay attacks (reject payloads older than 5 minutes)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;
  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp) || timestamp < fiveMinutesAgo) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac('sha256', signingSecret);
  hmac.update(baseString, 'utf8');
  
  const expectedSignature = `v0=${hmac.digest('hex')}`;

  try {
    const signatureBuffer = Buffer.from(signatureHeader, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    
    // Constant-time comparison to mitigate timing attacks
    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (err) {
    return false;
  }
}
