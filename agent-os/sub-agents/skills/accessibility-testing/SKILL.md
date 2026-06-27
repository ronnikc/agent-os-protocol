Title: Accessibility Testing
Keywords: accessibility, testing, axe-core, keyboard, screen-reader, a11y
Agents: accessibility, test
When to use: When writing accessibility tests or verifying WCAG compliance through automated and manual testing.
Version: 1.0.0
Last updated: 2026-03-10

Test accessibility using axe-core for automated checks, keyboard-only navigation for operability, and screen reader verification for announcements. Includes test code templates and manual testing procedures.

---

## Automated Testing (axe-core)

### Setup

axe-core integrates with Vitest via jest-axe adapter.

### Test Pattern

```tsx
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MyComponent } from './MyComponent';
import { TestProviders } from '@/test-utils';

expect.extend(toHaveNoViolations);

describe('MyComponent accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <TestProviders>
        <MyComponent />
      </TestProviders>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no violations when error state is shown', async () => {
    const { container } = render(
      <TestProviders>
        <MyComponent error="Something went wrong" />
      </TestProviders>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

### What axe catches automatically

- Missing alt text on images
- Missing form labels
- Color contrast violations
- Invalid ARIA attributes
- Duplicate IDs
- Missing landmark roles
- Empty buttons/links

### What axe does NOT catch (requires manual testing)

- Keyboard navigation order
- Focus management (modal open/close)
- Screen reader announcement quality
- Meaningful alt text (vs. present but useless)
- Reduced motion compliance
- Dynamic content updates (aria-live timing)

## Manual Keyboard Testing

### Test procedure

1. Start at the top of the page
2. Press Tab — does focus move to the first interactive element?
3. Continue Tab — does focus follow a logical order?
4. On buttons: does Enter/Space activate them?
5. On links: does Enter navigate?
6. On modals: does focus move into the modal? Does ESC close it? Does focus return to trigger?
7. On dropdowns: do Arrow keys navigate options? Does ESC close?
8. Can you reach all functionality without a mouse?
9. Is focus always visible (FocusRing)?

### Key bindings to test

| Key | Expected behavior |
|-----|-------------------|
| Tab | Move to next interactive element |
| Shift+Tab | Move to previous interactive element |
| Enter | Activate button/link |
| Space | Activate button, toggle checkbox |
| Escape | Close modal/dropdown/popover |
| Arrow Up/Down | Navigate menu items, radio buttons |
| Arrow Left/Right | Navigate tabs |
| Home/End | Jump to first/last item in list |

## Screen Reader Testing

### What to verify

1. **Page title** announced on navigation
2. **Landmarks** identifiable (main, nav, aside, header, footer)
3. **Headings** navigable and hierarchy correct
4. **Form labels** announced when input focused
5. **Error messages** announced via role="alert"
6. **Status updates** announced via aria-live="polite"
7. **Button labels** descriptive (not just "Click here")
8. **Table structure** headers associated with cells
9. **Images** alt text read (or decorative images skipped)
10. **Dynamic content** changes announced appropriately

## Color Contrast Testing

### Minimum ratios (WCAG 2.1 AA)

| Element | Ratio |
|---------|-------|
| Normal text (< 18px or < 14px bold) | 4.5:1 |
| Large text (>= 18px or >= 14px bold) | 3:1 |
| UI components and graphical objects | 3:1 |

### Verification

Use browser DevTools color picker or contrast checker tool to verify ratios on:
- Body text
- Headings
- Links (default + hover + visited)
- Button text on button background
- Input text on input background
- Placeholder text
- Status badges (text on colored background)
- Error/warning/success messages

## Test Report Format

| Test | Component | Result | Issue (if fail) |
|------|-----------|--------|-----------------|
| axe-core | LoginForm | Pass | — |
| Keyboard nav | LoginForm | Pass | — |
| Focus management | DeleteModal | Fail | Focus not returned to trigger on close |
| Screen reader | StatusBadge | Fail | Color-only status not announced |
| Contrast | ErrorMessage | Pass | — |
| Reduced motion | Dashboard | Fail | Charts animate despite prefers-reduced-motion |

## Input Schema

```yaml
input:
  component_path:
    type: string
    required: true
    description: "Path to the component or page under test"
  test_types:
    type: array
    items: string
    required: false
    default: ["axe-core", "keyboard", "screen-reader", "contrast"]
    description: "Which accessibility test types to run"
  wcag_level:
    type: string
    required: false
    default: "AA"
    description: "WCAG conformance level target (A, AA, AAA)"
```

## Output Schema

```yaml
output:
  test_report:
    type: object
    description: "Structured accessibility test report"
    properties:
      component:
        type: string
      tests_run:
        type: array
        items:
          type: object
          properties:
            test_type: string
            result: "pass | fail"
            issues: array
      overall_result:
        type: "pass | fail"
      summary:
        type: string
```

## Quality Gate

- All axe-core automated checks return zero violations for the target WCAG level.
- Keyboard navigation test covers every interactive element and confirms logical tab order.
- Screen reader verification confirms all landmarks, headings, and form labels are announced correctly.
- Color contrast ratios meet or exceed WCAG AA minimums for all text and UI components.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "accessibility-testing"
  stage: "S4"
  suggested_next:
    - slug: "verification-gate"
      stage: "S3"
      reason: "Confirm all accessibility fixes pass verification before marking complete"
    - slug: "review-request"
      stage: "S2"
      reason: "Request code review after accessibility issues are resolved"
```

## Error Handling

- If axe-core is not installed or jest-axe adapter fails to load, report the dependency gap and provide installation instructions before proceeding.
- If a component cannot render in the test environment (missing providers, context), wrap with TestProviders and retry before reporting a test infrastructure failure.
- If contrast checking tools are unavailable, fall back to manual DevTools verification and document the manual check in the report.
- If screen reader testing is not possible in the current environment, document it as "deferred — requires manual screen reader session" and do not mark the test as passed.
