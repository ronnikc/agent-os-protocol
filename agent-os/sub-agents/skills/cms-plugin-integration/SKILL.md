Title: CMS Hook & Plugin Integration
Keywords: cms-hooks, plugin-integration, wordpress-hooks, drupal-hooks, extension-audit
Agents: wordpress-specialist, drupal-specialist, joomla-specialist, umbraco-specialist
When to use: When auditing and writing custom hooks, actions, filters, and configuration overrides for CMS platforms.
Version: 1.0.0
Last updated: 2026-06-30

Audit, design, and implement custom plugin extensions, lifecycle events, and API filters for Content Management System (CMS) platforms.

---

## Workflow

### Step 1 — Map CMS Hook Lifecycle
Locate the targets for extension hook execution:
- **WordPress:** Parse hook registrations (`add_action`, `add_filter`, block hooks).
- **Drupal:** Identify system events, hook implementations (`hook_form_alter`, custom module routes).
- **Joomla!:** Trace plugin event methods (e.g. `onContentPrepare`, `onAfterRoute`).
- **Umbraco:** Map composer registries (`IComposer`) and event handlers (`INotificationHandler`).

### Step 2 — Verify Security Barriers
Review database and input parameters inside the custom hooks:
- Assert that inputs are sanitized (e.g. `sanitize_text_field` in WP, form API filters in Drupal, Zod/C# sanitizations).
- Verify permissions and nonce codes (`wp_verify_nonce`, CSRF protection tokens) are checked before processing mutations.

### Step 3 — Ensure Hook Separation
Check that plugin extension logic remains decoupled from the CMS core files. Never edit standard core engines.

### Step 4 — Output Hook Blueprint
Generate a structured report outlining the custom hooks created, parameters expected, and validation gates.

---

## Input Schema

```yaml
input:
  cms_platform:
    type: enum
    values: [wordpress, drupal, joomla, umbraco]
    required: true
    description: "The CMS platform to target"
  target_file:
    type: string
    required: true
    description: "Path to the custom plugin or module source file"
```

## Output Schema

```yaml
output:
  integration_verdict:
    type: object
    properties:
      valid: { type: boolean }
      errors_count: { type: integer }
  hooks_found:
    type: array
    items:
      type: object
      properties:
        hook_name: { type: string }
        callback: { type: string }
        priority: { type: integer }
        security_checked: { type: boolean }
```

## Quality Gate

- Zero core CMS files are modified (extensions live completely in plugin/module directories)
- Nonces or CSRF tokens are verified on all POST/mutation hooks
- All input variables are sanitized before database query routing

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "cms-plugin-integration"
  stage: "S1"
  suggested_next:
    - slug: "service-pattern"
      stage: "S1"
      reason: "CMS extensions should route business logic through clean, reusable service models"
```

## Error Handling

- If the custom module file is not placed in the correct extension sub-folder, flag a directory violation.
- If database modifications run outside the CMS data layer wrappers, halt and enforce query safety filters.
