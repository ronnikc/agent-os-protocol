import { readFileSync } from 'node:fs';

const providers = ['e2b', 'agent37', 'daytona', 'modal', 'upstash-box', 'vercel-sandbox'];
const scenarios = [
  'delivery', 'crossLobbyDenial', 'budgetDenial', 'quotaFailure',
  'timeout', 'cancellation', 'restartRecovery', 'deletion',
];

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function checkEvidence(report) {
  const errors = [];
  if (!/^[a-f0-9]{40}$/i.test(report?.candidate ?? '')) {
    errors.push('A full candidate commit SHA is required.');
  }
  const rows = Array.isArray(report?.providers) ? report.providers : [];
  const revisions = new Set(rows.map(row => row?.pinnedRevision).filter(hasText));
  if (revisions.size > 1) errors.push('All providers must use the same pinned task revision.');
  for (const row of rows) {
    if (!providers.includes(row?.provider)) errors.push('Unknown provider row.');
  }
  for (const provider of providers) {
    const matches = rows.filter(row => row?.provider === provider);
    if (matches.length !== 1) {
      errors.push(`${provider}: expected exactly one live row.`);
      continue;
    }
    const [row] = matches;
    if (row.source !== 'live') errors.push(`${provider}: requires live evidence.`);
    for (const field of ['operator', 'plan', 'region', 'isolation', 'pinnedRevision', 'billingEvidence']) {
      if (!hasText(row[field])) errors.push(`${provider}: missing ${field}.`);
    }
    for (const scenario of scenarios) {
      const result = row.scenarios?.[scenario];
      if (result?.outcome !== 'pass' || !hasText(result.evidence)) {
        errors.push(`${provider}: missing passing evidence for ${scenario}.`);
      }
    }
    if (row.cleanup !== 'confirmed') errors.push(`${provider}: teardown is unconfirmed.`);
    if (row.pendingReservations !== 0) errors.push(`${provider}: unresolved or unknown reservations.`);
  }
  return errors;
}

try {
  const [file] = process.argv.slice(2);
  if (!file) throw new Error('Usage: node agent-os/scripts/check-provider-qualification.mjs <report.json>');
  const errors = checkEvidence(JSON.parse(readFileSync(file, 'utf8')));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('All six provider rows contain the required evidence. Review the linked records before sign-off.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
