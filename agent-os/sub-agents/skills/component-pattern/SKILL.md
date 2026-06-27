Title: Component Pattern
Keywords: frontend, react, component, useLocale, css, zod, hooks, page, form, navigation
Agents: frontend, design
When to use: When implementing a new frontend page component or reviewing an existing component for pattern compliance.
Version: 1.0.0
Last updated: 2026-03-10

Frontend component implementation pattern for this project. Use `const { t } = useLocale()` for all text. CSS classes use `aos-` prefix (layout classes use `dm-` prefix). Pages use apiClient via named import. Forms validate with Zod. Navigation in AdminLayout.tsx. Routes in App.tsx. Semantic HTML first, ARIA supplementary.

---

## Page Component Template

Every frontend page follows this exact structure. Copy and adapt — do not invent new patterns.

```tsx
// Copyright (c) 2026 Gothard.dk All rights reserved.
// This source code is proprietary and confidential.
// See LICENSE.md for licensing terms.

import { useState, useEffect } from 'react';
import { apiClient } from '../../../services/api-client.js';
import { useLocale } from '../../../hooks/useLocale.js';
import { useToast } from '../../../components/Toast.js';
import { FormModal } from '../../../components/FormModal.js';
import { AccessibleModal } from '../../../components/AccessibleModal.js';
import { ScreenReaderOnly } from '../../../components/ScreenReaderOnly.js';
import { useAnnounce } from '../../../hooks/useAnnounce.js';
import { usePageTitle } from '../../../hooks/usePageTitle.js';

const emptyForm = {
  name: '',
  description: '',
  status: 'active',
};

export function ExamplesPage() {
  usePageTitle('Examples');
  const { t } = useLocale();
  const toast = useToast();
  const { announce } = useAnnounce();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [form, setForm] = useState(emptyForm);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const result = await apiClient.listExamples(filters);
      setItems(result.data);
      setTotal(result.total);
      announce(`${result.total} ${t.examples.item_count}`);
    } catch (err: any) {
      console.error('Failed:', err);
      toast.error(t.examples.fetch_error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [filters]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditing(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    try {
      if (editing) {
        await apiClient.updateExample(editing.example_id, form);
        toast.success(t.examples.update_success);
      } else {
        await apiClient.createExample(form);
        toast.success(t.examples.create_success);
      }
      resetForm();
      fetchItems();
    } catch (err: any) {
      toast.error(err.message || t.examples.save_error);
    }
  };

  return (
    <main className="dm-page" role="main">
      <header className="dm-header">
        <h1>{t.examples.title}</h1>
        <button onClick={() => setShowForm(true)} className="aos-btn aos-btn-primary">
          {t.examples.add_button}
        </button>
      </header>

      <section className="dm-filters" aria-label={t.common.filters}>
        {/* Filter controls */}
      </section>

      <ScreenReaderOnly>
        <div aria-live="polite">{loading ? t.common.loading : `${total} ${t.examples.item_count}`}</div>
      </ScreenReaderOnly>

      <section className="dm-table">
        <table role="grid" aria-label={t.examples.table_label}>
          <thead>
            <tr>
              <th scope="col">{t.examples.col_name}</th>
              <th scope="col">{t.examples.col_status}</th>
              <th scope="col">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item._id}>
                <td>{item.name}</td>
                <td>{t.examples.statuses[item.status] || item.status}</td>
                <td>
                  <button onClick={() => handleEdit(item)} aria-label={`${t.common.edit} ${item.name}`}>
                    {t.common.edit}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showForm && (
        <FormModal onClose={resetForm} onSubmit={handleSubmit} title={editing ? t.examples.edit_title : t.examples.add_title}>
          {/* Form fields */}
        </FormModal>
      )}
    </main>
  );
}
```

## Key Rules

### Imports

- **API client:** `import { apiClient } from '../../../services/api-client.js'` — named import, NOT default
- **Localization:** `import { useLocale } from '../../../hooks/useLocale.js'`
- **Toast:** `import { useToast } from '../../../components/Toast.js'`
- **All paths end in `.js`** even though source is `.tsx` — this is required for the build

### Localization (i18n)

- **Every visible string** must come from `t.*` — no hardcoded text
- Use `const { t } = useLocale()` at the top of every component
- Keys follow the pattern: `t.<module>.<element>` (e.g., `t.governance.vendors.title`)
- Never use `langKey` pattern or direct EN/VI lookups
- See **localization** for full rules

### CSS Classes

- Layout classes: `dm-page`, `dm-header`, `dm-filters`, `dm-form`, `dm-table`
- Component classes: `aos-btn`, `aos-btn-primary`, `aos-badge`, `aos-card`
- Always use the `aos-` prefix for new component-specific classes
- Never use inline styles for layout

### Exports

- Named function exports: `export function ExamplesPage()` — NOT `export default`

### Accessibility

- Use semantic HTML first: `<main>`, `<header>`, `<nav>`, `<section>`, `<table>`
- Add ARIA supplementary: `role`, `aria-label`, `aria-live`, `aria-describedby`
- Use `<ScreenReaderOnly>` for live regions and hidden labels
- Use `useAnnounce()` for dynamic content updates
- Use `usePageTitle()` for document title management
- Table headers use `scope="col"` or `scope="row"`
- Interactive elements have visible focus indicators
- Action buttons include context: `aria-label={`${t.common.edit} ${item.name}`}`

### Forms

- Use `FormModal` component for create/edit forms
- Form state managed via `useState` with an `emptyForm` constant
- Validate with Zod schemas before submission
- Show toast messages on success/error
- Reset form state after successful submission

### State Management

- Use `useState` for local page state
- Use `useEffect` for data fetching on mount and filter changes
- Loading state pattern: `setLoading(true)` before fetch, `setLoading(false)` in finally block

### Navigation

- Add menu item to the frontend
- Add route to the frontend
- Use consistent path pattern: `/admin/<module>`

### API Client

- All API calls go through `apiClient` (in the frontend)
- Method naming: `list<Module>`, `create<Module>`, `update<Module>`, `delete<Module>`, `get<Module>`
- Methods accept filter objects and return `{ data, total, page, page_size }`

## Checklist

- [ ] `useLocale()` initialized, all strings from `t.*`
- [ ] `apiClient` used via named import
- [ ] `usePageTitle()` set
- [ ] CSS classes use `dm-` for layout, `aos-` for components
- [ ] Named function export (not default)
- [ ] Semantic HTML with supplementary ARIA
- [ ] `ScreenReaderOnly` live region for loading/count
- [ ] `useAnnounce()` for dynamic updates
- [ ] Toast messages for success/error feedback
- [ ] Form resets after submit
- [ ] Navigation item added to AdminLayout.tsx
- [ ] Route added to App.tsx
- [ ] i18n keys added to all multiple locales files

## Input Schema

```yaml
inputs:
  module_name:
    type: string
    required: true
    description: "Name of the module (e.g., 'tasks', 'vendors'). Used for route paths, i18n key prefixes, and file naming."
  page_name:
    type: string
    required: true
    description: "Name of the page component (e.g., 'TasksPage', 'VendorsPage'). Used for the exported function name."
  entity_fields:
    type: array
    required: true
    description: "List of fields to display in the table and form. Each field has name, label_key, and form_type (text, select, date, etc.)."
  api_methods:
    type: array
    required: true
    description: "List of apiClient method names this page will call (e.g., 'listTasks', 'createTask')."
  has_filters:
    type: boolean
    required: false
    default: true
    description: "Whether the page includes a filter section above the data table."
```

## Output Schema

```yaml
outputs:
  page_file:
    type: file_path
    description: "Path to the created page component (the frontend pages)"
  api_client_methods:
    type: array
    description: "Methods added to the frontend
  nav_entry:
    type: object
    description: "Menu item added to AdminLayout.tsx"
  route_entry:
    type: object
    description: "Route element added to App.tsx"
  i18n_keys:
    type: array
    description: "List of i18n keys added across all multiple locales files"
```

## Quality Gate

- All visible strings use `t.*` from `useLocale()` with no hardcoded text in the component.
- Semantic HTML is used for all structural elements (`<main>`, `<header>`, `<section>`, `<table>`) with supplementary ARIA attributes.
- The page renders correctly with empty data (zero items) and shows appropriate loading/empty states.
- Navigation entry and route are registered, and the page is reachable via the admin sidebar.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "component-pattern"
  stage: "S1"
  suggested_next:
    - slug: "test-patterns"
      stage: "S1"
      reason: "Frontend component tests should be written immediately after creating the page"
    - slug: "api-contract-validation"
      stage: "S1"
      reason: "Validate that apiClient methods match backend route definitions"
```

## Error Handling

- If the apiClient method does not exist yet, stub it with a TODO comment and flag it in the output so the backend skill can create it.
- If i18n keys are missing from any of the multiple locales files, list the missing locales in the output rather than silently skipping them.
- If AdminLayout.tsx or App.tsx have merge conflicts or unexpected structure, report the conflict and do not force-write.
- If the module uses a non-standard layout (e.g., wizard flow instead of table), fall back to the closest existing pattern and document the deviation.
