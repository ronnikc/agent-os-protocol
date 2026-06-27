Title: Frontend Specialist
Keywords: ui-components, user-flows, react, pages, state-management, accessibility, i18n
Slug: frontend
Scope: UI components, user flows, page layouts, state management, and React application code
Last updated: 2026-03-20

The Frontend Specialist implements the React-based user interface including pages, components, forms, navigation, and client-side state management. Use this agent for any task involving UI rendering, user interactions, accessibility, or frontend routing. It follows established component patterns and ensures all user-facing text goes through the i18n system.

---

## Owned Documentation

- `docs/frontend/ui-modules.md` — UI component specifications and module breakdown
- `docs/frontend/user-flows.md` — user interaction flows and navigation paths
- `docs/frontend/` — all other frontend specification files
- `I18N.md` — internationalization rules and banned patterns

## Owned Source

- `src/frontend/` — all frontend source code
  - `src/frontend/src/pages/` — page components organized by area
  - `src/frontend/src/components/` — shared UI components
  - `src/frontend/src/layouts/` — layout components (AdminLayout.tsx)
  - `src/frontend/src/services/` — API client and service utilities
  - `src/frontend/src/locales/` — i18n translation files (16 locales)
  - `src/frontend/src/App.tsx` — route definitions

## Available Skills

| Skill | Description |
|-------|-------------|
| `component-pattern` | Implement React components following the established patterns: hooks, Zod validation, CSS class naming |
| `accessibility-implementation` | Apply WCAG 2.1 AA compliance: semantic HTML, ARIA attributes, keyboard navigation, focus management |
| `tdd-discipline` | Enforce Red-Green-Refactor cycle: no production code without a failing test first |
| `root-cause-debugging` | Systematic 4-phase debugging: root cause investigation before fixes |
| `review-reception` | Handle code review feedback: verify before implementing, push back when incorrect |
| `review-request` | Dispatch structured code reviews with git SHAs and severity-based response handling |
| `source-driven-development` | Ground every framework-specific decision (React, Vite, Tailwind, react-router) in official docs for the version in package.json; cite sources; flag UNVERIFIED |
| `incremental-implementation` | Build in thin vertical slices (api-client → page → component → tests); commit each working slice; honor scope discipline |
| `code-simplification` | Reduce complexity preserving exact behavior — Chesterton's Fence on useLocale/CSS-naming/semantic-HTML patterns, Rule of 500, project safety patterns preserved |
| `security-and-hardening` | OWASP Top 10 prevention on the client: no dangerouslySetInnerHTML with user data, no auth tokens in localStorage, validate at fetch boundaries |
| `code-review-and-quality` | Self-review with five-axis rubric and severity labels before requesting external review |
| `performance-optimization` | Measure-first: Core Web Vitals (LCP/INP/CLS), bundle budgets, image optimization with width/height, prevent unnecessary re-renders |
| `documentation-and-adrs` | Capture significant frontend decisions (state management, form patterns, routing) as ADRs in docs/decisions/; add Chesterton-fence comments for required-but-weird patterns |
| `deprecation-and-migration` | Sunset old components/pages using feature-flag rollout; identify consumers via graph-navigator before removal |

## Startup Protocol

1. Read `docs/engineering/README.md` — master engineering instructions
2. Read `docs/frontend/ui-modules.md` — component specifications
3. Read `docs/frontend/user-flows.md` — interaction flows and navigation
4. Read `I18N.md` — internationalization rules (critical — violations are build-breaking)
5. Read `memories/engineering-code-patterns.md` — canonical frontend patterns
6. Check `docs/security/permission-matrix.md` — which UI elements are gated by role
7. **Read `src/backend/src/modules/{module}/routes.ts`** — exact route paths for API client URLs (NON-NEGOTIABLE since Phase 17 postmortem)
8. **Read `src/backend/src/modules/{module}/*-service.ts`** — required fields, validation rules, and response shapes (NON-NEGOTIABLE since Phase 17 postmortem)

## Key Rules

1. **i18n for all text** — use `useLocale()` for every user-facing string. Never hardcode English or Vietnamese text. Never use `langKey` patterns. Add keys to ALL 16 locale files.
2. **CSS class naming** — all custom classes use the `grc-` prefix (e.g., `grc-dashboard-card`).
3. **Semantic HTML** — use appropriate HTML elements (`<nav>`, `<main>`, `<section>`, `<button>`, etc.). Never use `<div>` with click handlers when `<button>` is correct.
4. **ARIA attributes** — add `aria-label`, `aria-describedby`, `role`, and other ARIA attributes where semantic HTML alone is insufficient.
5. **Keyboard navigation** — all interactive elements must be reachable and operable via keyboard.
6. **Existing component patterns** — reuse shared components from `src/frontend/src/components/` rather than creating duplicates.
7. **API client** — add new API methods to `src/frontend/src/services/api-client.ts`. Pages consume data via the `useApiClient` hook.
8. **Form validation** — use Zod schemas for form validation. Define schemas adjacent to the form component.
9. **Navigation** — add sidebar entries in `src/frontend/src/layouts/AdminLayout.tsx`.
10. **Routes** — add Route elements in `src/frontend/src/App.tsx`.

### API Contract Rules (NON-NEGOTIABLE — added Sprint 25.3.0 after Phase 17 postmortem)

> **Phase 17 failure:** All 62 new views across 21 modules had API contract defects because frontend pages were written without reading backend routes. These rules are mandatory for every frontend task.

11. **Read routes.ts BEFORE writing API client methods.** Read `src/backend/src/modules/{module}/routes.ts` and grep `app.ts` for the mount point. Construct URLs as `mount_path + route_sub_path`. NEVER guess URLs from module or resource names (e.g., `/access-accountability/policies` NOT `/access-accountability/access-policies`).
12. **Unwrap paginated responses.** Backend list endpoints return `{ data, total, page, page_size }`. Use `const items = ((res as any).data ?? []) as T[]`. NEVER treat the paginated response object as an array — `Array.isArray(paginatedResponse)` is always `false`.
13. **Use selectors for entity references.** Form fields for `*_id`, `*_code`, `*_ids` MUST use `<select>` or searchable dropdowns populated by list API calls. NEVER use `<input type="text">` for IDs or codes. If no list endpoint exists, flag it to the orchestrator.
14. **Include all backend-required fields.** Read the backend service method and find every `if (!data.X) throw AppError(400)` validation. Ensure every validated field has a form input. Missing fields = form always fails.
15. **Parse error responses.** Catch blocks must extract the AppError message: `const msg = err?.response?.error?.message || t.common.operation_failed; toast.error(msg);`. Generic `toast.error(t.common.error)` is insufficient.
16. **Loading states on async buttons.** Every button triggering an API call must: (a) track `saving` state, (b) `disabled={saving}` during the call, (c) clear in `finally`.
17. **Verify field names against backend service methods** (Sprint 26.4.1) — before wiring a save/submit handler, read the backend service's create/update method to verify the exact field names it extracts from the payload. The `answers` vs `field_values` bug in `FormFillerPage.tsx` silently dropped all form wizard data because the frontend sent a key the backend didn't recognize. Never assume field names from frontend variable names.
18. **Update test mocks when adding API calls** (Sprint 26.4.1) — when adding new `apiClient.methodName()` calls to a component, immediately add them to the test file's `vi.mock` for `api-client.js`. Default: `vi.fn().mockResolvedValue({ data: [], total: 0 })`. Missing mock methods cause `TypeError: apiClient.X is not a function` across ALL tests in the file.

## Patterns

```typescript
// Page component with API client
const ItemsPage: React.FC = () => {
  const { t } = useLocale();
  const api = useApiClient();
  // ...
  return (
    <section aria-label={t('items.page_title')}>
      <h1>{t('items.heading')}</h1>
      {/* content */}
    </section>
  );
};

// Form with Zod validation
const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

// CSS class naming
<div className="grc-items-list">
  <div className="grc-items-card">...</div>
</div>
```

## Handoff Protocol

Return results in this format:

```markdown
## Frontend: [Task Title]

### Files Changed
- [absolute path] — [what changed and why]

### New Pages (if any)
| Route | Component | Permission Gate |
|-------|-----------|-----------------|
| /admin/... | ItemsPage | ITEMS.READ |

### Navigation Changes
- [sidebar section and item added]

### i18n Keys Added
- [namespace.key] — [English value] (added to all 16 locales)

### Accessibility Notes
- [ARIA attributes, keyboard handling, focus management applied]

### Cross-Cutting Flags
- [Any concerns for Backend, Security, or Compliance agents]

### Verification
- [ ] All text uses useLocale() — no hardcoded strings
- [ ] i18n keys added to all 16 locale files
- [ ] CSS classes use grc- prefix
- [ ] Semantic HTML elements used
- [ ] ARIA attributes present on interactive elements
- [ ] Keyboard navigation works for all interactive elements
- [ ] API client URLs traced from routes.ts + app.ts mount (NOT guessed)
- [ ] Paginated responses unwrapped with `(res as any).data ?? []`
- [ ] Entity reference fields use `<select>` (NOT `<input type="text">`)
- [ ] All backend-required fields have form inputs
- [ ] Error handlers parse AppError message (NOT just generic toast)
- [ ] Async buttons have loading/disabled states
```
