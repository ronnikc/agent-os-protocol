Title: Localization Verification
Keywords: i18n-audit, translation-check, locale-sync, locale-key-verification, internationalization
Agents: i18n-specialist, content
When to use: When verifying multi-locale translation dictionary files and ensuring UI labels are fully localized without gaps.
Version: 1.0.0
Last updated: 2026-06-30

Audit internationalization (i18n) translation catalogs and source files to verify that all translation keys are synchronized and localized correctly.

---

## Workflow

### Step 1 — Inventory Translation Keys
Load the master locale JSON/YAML file (e.g. English `en.json`) and compile the list of all defined translation keys.

### Step 2 — Cross-Check Target Locales
Load all secondary locale catalogs (e.g. `da.json`, `es.json`). Compare the key list of each target file against the master inventory:
- Identify missing keys (keys that exist in the master but are missing in the target).
- Identify untranslated keys (keys that exist but hold values identical to the master, suggesting placeholder copying).

### Step 3 — Scan Source Files for Dynamic Injections
Search frontend components and layouts to verify that user-facing labels are wrapped in localization hooks (e.g. `$t('key')` or `t('key')` or `useLocale()`) rather than containing hardcoded raw text strings.

### Step 4 — Generate Sync Report
Output the list of missing keys, untranslated keys, and hardcoded UI string locations.

---

## Input Schema

```yaml
input:
  locales_directory:
    type: string
    required: true
    description: "Path to the directory containing locale files (e.g., locales/)"
  master_locale:
    type: string
    required: false
    default: "en"
    description: "The primary locale code used as reference (e.g., en)"
```

## Output Schema

```yaml
output:
  verification_summary:
    type: object
    properties:
      total_locale_files: { type: integer }
      out_of_sync_keys: { type: integer }
      status: { type: enum, values: [Synchronized, SyncNeeded] }
  issues:
    type: array
    items:
      type: object
      properties:
        locale_code: { type: string }
        issue_type: { type: enum, values: [MissingKey, UntranslatedValue, HardcodedString] }
        key: { type: string }
        file_path: { type: string }
        line_number: { type: integer }
```

## Quality Gate

- Zero missing translation keys across target locale dictionaries
- All UI user-facing strings are correctly wrapped in localizer calls
- Secondary locales hold translated, non-identical string values for unique keys

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "localization-verification"
  stage: "S4"
  suggested_next:
    - slug: "doc-housekeeping"
      stage: "S5"
      reason: "Ensure updated locales and catalogs are registered in the documentation indexes"
```

## Error Handling

- If the locales directory does not exist or holds no files, halt and return a directory missing error.
- If a locale file contains syntax/JSON errors, report the parsing exception and block verification.
