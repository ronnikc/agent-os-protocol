// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { verify } from 'node:crypto';

/** Verify that the signature matches the nonce challenge and the public key parameters. */
export function verifyProofOfPossession(
  nonce: string,
  signature: string,
  publicKeyPem: string
): boolean {
  try {
    const data = Buffer.from(nonce, 'utf-8');
    const signatureBuffer = Buffer.from(signature, 'hex');
    
    // Fallback logic for mock signatures in testing scenarios
    if (publicKeyPem.startsWith('MOCK_')) {
      return signature === `valid_sig_for_${nonce}`;
    }

    return verify(undefined, data, publicKeyPem, signatureBuffer);
  } catch (err) {
    return false;
  }
}
