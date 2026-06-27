#!/usr/bin/env node
/**
 * generate-skill-references.mjs — Generate skill reference files from regulatory packs.
 *
 * Reads packs/regulatory/<pack-slug>/{frameworks,forms,procedures,deadlines,fines-risks,pack}.json
 * and writes agent-os/sub-agents/skills/<skill-slug>/references/{frameworks,forms,procedures,deadlines,fines-risks}.md.
 *
 * Idempotent: re-running on unchanged source produces no diff. Hand-authored
 * sections marked with <!-- HAND-AUTHORED START --> ... <!-- HAND-AUTHORED END -->
 * are preserved.
 *
 * Usage:
 *   node agent-os/scripts/generate-skill-references.mjs <pack-slug> [skill-slug]
 *   node agent-os/scripts/generate-skill-references.mjs my-skill
 *   node agent-os/scripts/generate-skill-references.mjs eu-nis2 eu-nis2
 *
 * If skill-slug omitted, defaults to pack-slug.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACK_DIR = path.join(REPO_ROOT, 'packs', 'regulatory');
const SKILLS_DIR = path.join(REPO_ROOT, 'agent-os', 'sub-agents', 'skills');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Unwrap a possibly-i18n value `{ en, vi, ... }` to a string. Returns '' if missing.
function txt(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.en || v.vi || Object.values(v)[0] || '';
  return String(v);
}

function pipe(s) {
  return String(s).replace(/\|/g, '\\|');
}

function preserveHandAuthored(existingContent, generated) {
  if (!existingContent) return generated;
  const handAuthoredRe = /<!-- HAND-AUTHORED START -->[\s\S]*?<!-- HAND-AUTHORED END -->/g;
  const matches = [...existingContent.matchAll(handAuthoredRe)];
  if (matches.length === 0) return generated;
  return generated.replace(/(<!-- HAND-AUTHORED PLACEHOLDER -->)/, () => {
    const m = matches.shift();
    return m ? m[0] : '';
  });
}

function writeIfChanged(filePath, content) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  const merged = preserveHandAuthored(existing, content);
  if (existing === merged) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, merged, 'utf8');
  return true;
}

function frameworksMd(packMeta, frameworks) {
  const lines = [];
  lines.push(`# ${packMeta.name} — Frameworks`);
  lines.push('');
  lines.push(`> Generated from \`packs/regulatory/${packMeta.pack_code}/frameworks.json\`. Do not hand-edit. Re-run \`agent-os/scripts/generate-skill-references.mjs ${packMeta.pack_code}\` to refresh.`);
  lines.push('');
  lines.push(`**Pack:** \`${packMeta.pack_code}\` (v${packMeta.version})`);
  const jurisdictionLabel = packMeta.jurisdiction
    ? `${packMeta.jurisdiction}${packMeta.jurisdiction_code ? ` (${packMeta.jurisdiction_code})` : ''}`
    : (packMeta.jurisdiction_code || '—');
  lines.push(`**Jurisdiction:** ${jurisdictionLabel}`);
  if (packMeta.regulatory_domain) lines.push(`**Domain:** ${packMeta.regulatory_domain}`);
  if (packMeta.authority_name) lines.push(`**Authority:** ${packMeta.authority_name}`);
  if (packMeta.effective_date) lines.push(`**Effective:** ${packMeta.effective_date}`);
  if (packMeta.status) lines.push(`**Status:** ${packMeta.status}`);
  lines.push('');
  lines.push('## Framework instruments');
  lines.push('');
  for (const f of frameworks || []) {
    lines.push(`### ${f.framework_code} — ${f.display_name || ''}`);
    lines.push('');
    if (f.description) lines.push(txt(f.description));
    lines.push('');
    lines.push(`- **Type:** ${f.framework_type || 'n/a'}`);
    lines.push(`- **Authority:** ${f.authority_name || 'n/a'}${f.authority_url ? ` — ${f.authority_url}` : ''}`);
    if (f.effective_date) lines.push(`- **Effective:** ${f.effective_date}${f.effective_end ? ` → ${f.effective_end}` : ''}`);
    lines.push(`- **Status:** ${f.status || 'n/a'}`);
    if (f.replaced_by) lines.push(`- **Replaced by:** \`${f.replaced_by}\``);
    if (f.parent_framework_code) lines.push(`- **Parent:** \`${f.parent_framework_code}\``);
    if (f.requirements && f.requirements.length) {
      lines.push(`- **Requirements:** ${f.requirements.length} mandatory + advisory items (see below)`);
      lines.push('');
      lines.push(`#### Requirements`);
      lines.push('');
      lines.push(`| Category | Title | Reference | Module | Mandatory |`);
      lines.push(`|---|---|---|---|---|`);
      for (const r of f.requirements) {
        lines.push(`| ${pipe(txt(r.category))} | ${pipe(txt(r.title))} | ${pipe(txt(r.reference))} | ${pipe(txt(r.applicable_module))} | ${r.mandatory ? 'Yes' : 'No'} |`);
      }
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

function formsMd(packMeta, forms) {
  const lines = [];
  lines.push(`# ${packMeta.name} — Forms`);
  lines.push('');
  lines.push(`> Generated from \`packs/regulatory/${packMeta.pack_code}/forms.json\`. Do not hand-edit.`);
  lines.push('');
  if (!forms || !forms.length) {
    lines.push('_No forms defined in this pack._');
    return lines.join('\n') + '\n';
  }
  lines.push(`**Total forms:** ${forms.length}`);
  lines.push('');
  lines.push('| Schema ID | Title (EN) | Category | Framework | Official ID |');
  lines.push('|---|---|---|---|---|');
  for (const f of forms) {
    lines.push(`| \`${pipe(txt(f.schema_id))}\` | ${pipe(txt(f.title))} | ${pipe(txt(f.form_category))} | ${pipe(txt(f.framework_code))} | ${pipe(txt(f.official_form_id) || '—')} |`);
  }
  return lines.join('\n') + '\n';
}

function proceduresMd(packMeta, procedures) {
  const lines = [];
  lines.push(`# ${packMeta.name} — Procedures`);
  lines.push('');
  lines.push(`> Generated from \`packs/regulatory/${packMeta.pack_code}/procedures.json\`. Do not hand-edit.`);
  lines.push('');
  if (!procedures || !procedures.length) {
    lines.push('_No procedures defined in this pack._');
    return lines.join('\n') + '\n';
  }
  for (const p of procedures) {
    const id = p.procedure_id || '—';
    const name = txt(p.procedure_name) || id;
    lines.push(`## ${id} — ${name}`);
    lines.push('');
    const trigger = txt(p.trigger);
    if (trigger) lines.push(`**Trigger:** ${trigger}`);
    if (Array.isArray(p.related_form_ids) && p.related_form_ids.length) {
      lines.push(`**Related forms:** ${p.related_form_ids.map((id) => `\`${id}\``).join(', ')}`);
    }
    if (Array.isArray(p.submission_channels) && p.submission_channels.length) {
      const ch = p.submission_channels.map((c) => txt(c)).filter(Boolean).join('; ');
      if (ch) lines.push(`**Submission channels:** ${ch}`);
    }
    if (Array.isArray(p.steps) && p.steps.length) {
      lines.push('');
      lines.push(`**Steps:**`);
      lines.push('');
      for (const s of p.steps) {
        const desc = txt(s.description) || '(no description)';
        const owner = txt(s.responsible_party);
        const ownerSuffix = owner ? ` — _${owner}_` : '';
        lines.push(`${s.step_number || '-'}. ${desc}${ownerSuffix}`);
      }
    }
    if (Array.isArray(p.output_documents) && p.output_documents.length) {
      lines.push('');
      lines.push(`**Output documents:** ${p.output_documents.map((d) => txt(d)).filter(Boolean).join('; ')}`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

function deadlinesMd(packMeta, deadlines) {
  const lines = [];
  lines.push(`# ${packMeta.name} — Deadlines`);
  lines.push('');
  lines.push(`> Generated from \`packs/regulatory/${packMeta.pack_code}/deadlines.json\`. Do not hand-edit.`);
  lines.push('');
  if (!deadlines || !deadlines.length) {
    lines.push('_No statutory deadlines defined in this pack._');
    return lines.join('\n') + '\n';
  }
  lines.push(`**Total deadlines:** ${deadlines.length}`);
  lines.push('');
  lines.push('| SLA Type | Window | Extension | Reference | Framework |');
  lines.push('|---|---|---|---|---|');
  for (const d of deadlines) {
    const slaType = txt(d.sla_type) || '—';
    const unit = txt(d.unit).replace(/_/g, ' ');
    const win = (d.deadline != null && unit) ? `${d.deadline} ${unit}` : '—';
    const ext = d.extension == null ? '—' : (typeof d.extension === 'object' ? JSON.stringify(d.extension) : String(d.extension));
    lines.push(`| \`${pipe(slaType)}\` | ${pipe(win)} | ${pipe(ext)} | ${pipe(txt(d.reference))} | ${pipe(txt(d.framework_code))} |`);
  }
  // Surface i18n notes (when present) below the table.
  const withNotes = deadlines.filter((d) => txt(d.note));
  if (withNotes.length) {
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    for (const d of withNotes) {
      lines.push(`- \`${txt(d.sla_type)}\` — ${txt(d.note)}`);
    }
  }
  return lines.join('\n') + '\n';
}

function finesRisksMd(packMeta, fines) {
  const lines = [];
  lines.push(`# ${packMeta.name} — Fines & Risks`);
  lines.push('');
  lines.push(`> Generated from \`packs/regulatory/${packMeta.pack_code}/fines-risks.json\`. Do not hand-edit.`);
  lines.push('');
  if (!fines || !fines.length) {
    lines.push('_No penalty matrix defined in this pack._');
    return lines.join('\n') + '\n';
  }
  for (const f of fines) {
    const id = f.area_id || '—';
    const name = txt(f.area_name) || id;
    lines.push(`## ${id} — ${name}`);
    lines.push('');
    if (Array.isArray(f.draft_articles) && f.draft_articles.length) {
      lines.push(`- **Articles:** ${f.draft_articles.map((a) => `\`${txt(a)}\``).join(', ')}`);
    }
    if (f.enforcement_status) lines.push(`- **Enforcement status:** ${txt(f.enforcement_status)}`);
    if (f.fine_range_individual) lines.push(`- **Fine (individual):** ${txt(f.fine_range_individual)}`);
    if (f.fine_range_organization) lines.push(`- **Fine (organization):** ${txt(f.fine_range_organization)}`);
    if (f.revenue_percentage_escalation) lines.push(`- **Revenue-based escalation:** ${txt(f.revenue_percentage_escalation)}`);
    if (f.deadlines) lines.push(`- **Deadlines:** ${txt(f.deadlines)}`);
    if (Array.isArray(f.related_procedure_ids) && f.related_procedure_ids.length) {
      lines.push(`- **Related procedures:** ${f.related_procedure_ids.map((p) => `\`${p}\``).join(', ')}`);
    }
    if (Array.isArray(f.violation_triggers) && f.violation_triggers.length) {
      lines.push('');
      lines.push(`**Violation triggers:**`);
      for (const v of f.violation_triggers) lines.push(`- ${txt(v)}`);
    }
    if (Array.isArray(f.remediation_measures) && f.remediation_measures.length) {
      lines.push('');
      lines.push(`**Remediation measures:**`);
      for (const r of f.remediation_measures) lines.push(`- ${txt(r)}`);
    }
    const note = txt(f.note);
    if (note) {
      lines.push('');
      lines.push(`> ${note}`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

// Sprint 46.9.0 — guidances.md per skill. Mirrors the procedures.md format —
// H2 per guidance, body inline, source citation in a side-block.
function guidancesMd(packMeta, guidances) {
  const lines = [];
  lines.push(`# ${packMeta.name} — Guidance`);
  lines.push('');
  lines.push(
    `> Generated from \`packs/regulatory/${packMeta.pack_code}/guidances.json\`. Do not hand-edit. Re-run \`agent-os/scripts/generate-skill-references.mjs ${packMeta.pack_code}\` to refresh.`,
  );
  lines.push('');
  if (!guidances || !guidances.length) {
    lines.push('_No guidance defined in this pack._');
    return lines.join('\n') + '\n';
  }
  lines.push(`**Total guidance entries:** ${guidances.length}`);
  lines.push('');
  for (const g of guidances) {
    const id = g.guidance_id || '';
    const title = txt(g.title) || id;
    lines.push(`## ${id} — ${title}`);
    lines.push('');
    if (g.official_reference_id) lines.push(`- **Official reference:** ${g.official_reference_id}`);
    if (g.source_layer) lines.push(`- **Source layer:** ${g.source_layer}`);
    if (g.guidance_type) lines.push(`- **Type:** ${g.guidance_type}`);
    if (g.category) lines.push(`- **Category:** ${g.category}`);
    if (g.status) lines.push(`- **Status:** ${g.status}`);
    if (g.jurisdiction) lines.push(`- **Jurisdiction:** ${g.jurisdiction}`);
    if (g.authority) lines.push(`- **Authority:** ${txt(g.authority)}`);
    if (g.effective_date) lines.push(`- **Effective:** ${g.effective_date}`);
    if (g.phased_effective_date) lines.push(`- **Phased effective:** ${g.phased_effective_date}`);
    if (Array.isArray(g.applies_to) && g.applies_to.length)
      lines.push(`- **Applies to:** ${g.applies_to.join(', ')}`);
    if (Array.isArray(g.related_modules) && g.related_modules.length)
      lines.push(`- **Related modules:** ${g.related_modules.join(', ')}`);
    if (Array.isArray(g.related_procedure_ids) && g.related_procedure_ids.length)
      lines.push(
        `- **Related procedures:** ${g.related_procedure_ids.map((p) => '`' + p + '`').join(', ')}`,
      );
    if (Array.isArray(g.related_form_ids) && g.related_form_ids.length)
      lines.push(
        `- **Related forms:** ${g.related_form_ids.map((p) => '`' + p + '`').join(', ')}`,
      );
    if (Array.isArray(g.related_requirements) && g.related_requirements.length)
      lines.push(
        `- **Related requirements:** ${g.related_requirements.map((p) => '`' + p + '`').join(', ')}`,
      );
    if (Array.isArray(g.tags) && g.tags.length) lines.push(`- **Tags:** ${g.tags.join(', ')}`);
    if (g.version) lines.push(`- **Version:** ${g.version}`);
    lines.push('');
    if (g.summary) {
      lines.push(`**Summary:** ${txt(g.summary)}`);
      lines.push('');
    }
    if (Array.isArray(g.sections) && g.sections.length) {
      for (const s of g.sections) {
        lines.push(`### ${txt(s.title) || s.section_id || ''}`);
        lines.push('');
        const body = txt(s.body);
        if (body) lines.push(body);
        lines.push('');
      }
    }
    if (Array.isArray(g.version_history) && g.version_history.length) {
      lines.push(`**Version history:**`);
      lines.push('');
      for (const vh of g.version_history) {
        const summary = txt(vh.summary);
        const src = vh.source_doc ? ` — ${vh.source_doc}` : '';
        lines.push(`- \`${vh.version}\` (${vh.date}): ${summary}${src}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}

function generate(packSlug, skillSlug = packSlug) {
  const packDir = path.join(PACK_DIR, packSlug);
  if (!fs.existsSync(packDir)) {
    console.error(`[ERR] pack not found: ${packDir}`);
    return false;
  }
  const packMeta = readJson(path.join(packDir, 'pack.json'));
  if (!packMeta) {
    console.error(`[ERR] pack.json missing in ${packDir}`);
    return false;
  }
  const frameworks = readJson(path.join(packDir, 'frameworks.json'));
  const forms = readJson(path.join(packDir, 'forms.json'));
  const procedures = readJson(path.join(packDir, 'procedures.json'));
  const deadlines = readJson(path.join(packDir, 'deadlines.json'));
  const fines = readJson(path.join(packDir, 'fines-risks.json'));
  // Sprint 46.9.0 — guidances are optional content; absent in older packs.
  const guidances = readJson(path.join(packDir, 'guidances.json'));

  const refDir = path.join(SKILLS_DIR, skillSlug, 'references');

  const writes = [
    ['frameworks.md', frameworksMd(packMeta, frameworks)],
    ['forms.md', formsMd(packMeta, forms)],
    ['procedures.md', proceduresMd(packMeta, procedures)],
    ['deadlines.md', deadlinesMd(packMeta, deadlines)],
    ['fines-risks.md', finesRisksMd(packMeta, fines)],
    ['guidances.md', guidancesMd(packMeta, guidances)],
  ];

  let changed = 0;
  for (const [name, body] of writes) {
    if (writeIfChanged(path.join(refDir, name), body)) changed++;
  }
  console.log(`[OK] ${packSlug} → ${skillSlug}/references/ (${changed} files changed, ${writes.length - changed} unchanged)`);
  return true;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node agent-os/scripts/generate-skill-references.mjs <pack-slug> [skill-slug]');
    process.exit(2);
  }
  const [packSlug, skillSlug] = args;
  const ok = generate(packSlug, skillSlug);
  process.exit(ok ? 0 : 1);
}

main();
