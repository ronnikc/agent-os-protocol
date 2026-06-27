Title: Accessibility Implementation
Keywords: accessibility, WCAG, ARIA, focus, keyboard, screen-reader, semantic-html
Agents: accessibility, frontend
When to use: When implementing accessibility fixes or building new accessible components. Load after accessibility-audit identifies issues.
Version: 1.0.0
Last updated: 2026-03-10

Implement accessibility using Phase 11 established utilities (useFocusTrap, useAnnounce, AccessibleModal, SkipToContent, FocusRing). Follow semantic HTML first, ARIA as supplementary. Cover keyboard navigation, focus management, color contrast, and reduced motion.

---

## Phase 11 Utilities (Reuse — Don't Reinvent)

### useFocusTrap

Traps focus within a container (modals, dialogs, dropdowns).

```tsx
import { useFocusTrap } from '@/hooks/useFocusTrap';

function MyModal({ isOpen, onClose }) {
  const trapRef = useFocusTrap(isOpen);
  return (
    <div ref={trapRef} role="dialog" aria-modal="true" aria-label="My Modal">
      {/* Content — focus stays within */}
      <button onClick={onClose}>Close</button>
    </div>
  );
}
```

### useAnnounce

Screen reader announcements via aria-live region.

```tsx
import { useAnnounce } from '@/hooks/useAnnounce';

function SaveButton() {
  const announce = useAnnounce();
  const handleSave = async () => {
    await save();
    announce('Changes saved successfully');
  };
  return <button onClick={handleSave}>Save</button>;
}
```

### AccessibleModal

Pre-built accessible modal with focus trap, ESC close, aria attributes.

```tsx
import { AccessibleModal } from '@/components/AccessibleModal';

<AccessibleModal isOpen={isOpen} onClose={onClose} title="Confirm Delete">
  <p>Are you sure?</p>
  <button onClick={onConfirm}>Delete</button>
  <button onClick={onClose}>Cancel</button>
</AccessibleModal>
```

### SkipToContent

Skip navigation link — rendered once in layout, visible on first Tab.

### FocusRing

Visible focus indicator for keyboard navigation — CSS utility, auto-applied.

## Implementation Patterns

### Semantic HTML First

```tsx
// CORRECT — semantic elements
<nav aria-label="Main navigation">
  <ul>
    <li><a href="/dashboard" aria-current={isActive ? 'page' : undefined}>Dashboard</a></li>
  </ul>
</nav>

<main id="main-content">
  <h1>Page Title</h1>
  <section aria-labelledby="section-heading">
    <h2 id="section-heading">Section</h2>
  </section>
</main>

// WRONG — div soup
<div className="nav">
  <div className="nav-item" onClick={navigate}>Dashboard</div>
</div>
```

### Interactive Elements

```tsx
// Buttons — always use <button>, never <div onClick>
<button type="button" onClick={handleClick} aria-label="Close dialog">
  <CloseIcon aria-hidden="true" />
</button>

// Toggle buttons
<button
  type="button"
  aria-pressed={isActive}
  onClick={toggle}
>
  {isActive ? 'Active' : 'Inactive'}
</button>

// Dropdown/Menu
<div role="menu" aria-label="Actions">
  <button role="menuitem" tabIndex={focused === 0 ? 0 : -1}>Edit</button>
  <button role="menuitem" tabIndex={focused === 1 ? 0 : -1}>Delete</button>
</div>
```

### Forms

```tsx
// Every input needs a label
<div>
  <label htmlFor="email">{t.auth.email}</label>
  <input
    id="email"
    type="email"
    aria-required="true"
    aria-invalid={!!errors.email}
    aria-describedby={errors.email ? 'email-error' : undefined}
    autoComplete="email"
  />
  {errors.email && (
    <span id="email-error" role="alert">{errors.email}</span>
  )}
</div>

// Required fields
<span aria-hidden="true">*</span>
<span className="sr-only">required</span>
```

### Data Tables

```tsx
<table>
  <caption>{t.admin.tickets.title}</caption>
  <thead>
    <tr>
      <th scope="col">{t.common.id}</th>
      <th scope="col">{t.common.status}</th>
      <th scope="col">{t.common.actions}</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>{ticket.id}</td>
      <td>{ticket.status}</td>
      <td>
        <button aria-label={`Edit ticket ${ticket.id}`}>Edit</button>
      </td>
    </tr>
  </tbody>
</table>
```

### Dynamic Content

```tsx
// Toast notifications
<div role="status" aria-live="polite">
  {message && <span>{message}</span>}
</div>

// Error alerts
<div role="alert">
  {error && <span>{error}</span>}
</div>

// Loading states
<div aria-busy={isLoading} aria-live="polite">
  {isLoading ? <span>{t.common.loading}</span> : <DataTable data={data} />}
</div>
```

### Reduced Motion

```tsx
// CSS
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

// JS hook (if needed)
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

## Common Fixes

| Issue | Fix |
|-------|-----|
| `<div onClick>` | Replace with `<button type="button" onClick>` |
| Missing label | Add `<label htmlFor="id">` matching input id |
| Missing alt | Add descriptive `alt="..."` or `alt=""` for decorative |
| Focus not trapped in modal | Apply `useFocusTrap(isOpen)` |
| No visible focus | Ensure FocusRing CSS is applied |
| Color-only indicator | Add text/icon alongside color |
| Heading skip (h1→h3) | Fix hierarchy to h1→h2→h3 |
| No skip nav | Add SkipToContent component in layout |
| Auto-playing animation | Add prefers-reduced-motion check |

## Input Schema

```yaml
input:
  findings:
    type: array
    items:
      type: object
      properties:
        component:
          type: string
        issue:
          type: string
        wcag_criterion:
          type: string
        severity:
          type: enum[Critical, Major, Minor]
        remediation:
          type: string
    required: true
    description: "Accessibility findings from the accessibility-audit skill"
  priority:
    type: enum[critical_only, critical_and_major, all]
    required: false
    default: "critical_and_major"
    description: "Which severity levels to implement fixes for"
```

## Output Schema

```yaml
output:
  fixes_applied:
    type: array
    items:
      component:
        type: string
      issue:
        type: string
      wcag_criterion:
        type: string
      fix_description:
        type: string
      file_modified:
        type: string
      line_range:
        type: string
  remaining_issues:
    type: array
    description: "Findings not addressed in this pass (e.g., minor issues deferred)"
  summary:
    type: string
    description: "Summary of fixes applied and remaining work"
```

## Quality Gate

- All Critical findings from the audit have been addressed — no critical issues remain.
- Fixes use Phase 11 utilities (useFocusTrap, useAnnounce, AccessibleModal, SkipToContent, FocusRing) where applicable — no reinvented wheels.
- Semantic HTML is used as the primary fix; ARIA is supplementary only.
- Every fix has been verified to not introduce new accessibility regressions (e.g., adding aria-hidden doesn't hide content from keyboard users).

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "accessibility-implementation"
  stage: "S4"
  suggested_next:
    - slug: "accessibility-audit"
      stage: "S4"
      reason: "Re-audit after implementation to verify fixes and check for regressions"
    - slug: "coverage-enforcement"
      stage: "S1"
      reason: "Ensure accessibility fixes are covered by component tests with axe-core assertions"
```

## Error Handling

- If a Phase 11 utility (e.g., useFocusTrap) cannot be found at the expected import path, search for it before creating a new implementation.
- If a fix requires changes to a shared component used by multiple pages, flag the blast radius and recommend running the full frontend test suite.
- If a finding's remediation is ambiguous or the component structure is too complex for a safe fix, flag it for manual review rather than applying an incorrect fix.
- If the component under fix uses a third-party library with limited accessibility support, document the limitation and suggest the best achievable fix.
