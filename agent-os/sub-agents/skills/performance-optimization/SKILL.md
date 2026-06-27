Title: Performance Optimization
Keywords: performance, core-web-vitals, lcp, inp, cls, profiling, n+1, bundle-size, lighthouse, regression, measurement, caching
Agents: frontend, backend, infrastructure, code-review
When to use: When a sprint spec has performance requirements (load time budgets, response SLAs), users or monitoring report slowness, Core Web Vitals are below thresholds, you suspect a recent change introduced regression, or you're handling large datasets / high traffic. NOT for premature optimization — measure first.
Version: 1.0.0
Last updated: 2026-04-27

Measure before optimizing. Performance work without measurement is guessing — and guessing leads to premature optimization that adds complexity without improving what matters. Profile first, identify the actual bottleneck, fix it, measure again. The project already runs Lighthouse via `lighthouserc.js`; this skill defines when, how, and what to act on. Adapted from [addyosmani/agent-skills performance-optimization](https://github.com/addyosmani/agent-skills/blob/main/skills/performance-optimization/SKILL.md).

---

## Core Web Vitals Targets

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| **LCP** (Largest Contentful Paint) | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| **INP** (Interaction to Next Paint) | ≤ 200ms | ≤ 500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | ≤ 0.1 | ≤ 0.25 | > 0.25 |

The project's `lighthouserc.js` should align with these thresholds. If a perf-sensitive sprint targets stricter values, encode the target in the sprint spec and update `lighthouserc.js`.

---

## Backend Targets (project-internal)

| Metric | Target |
|--------|--------|
| API response time (p95) | ≤ 200ms for read, ≤ 500ms for write |
| List endpoint without pagination | ❌ never — always paginate |
| Single-workspaces query without `org_id` index | ❌ never — every query must filter on indexed `org_id` |
| Bulk operations | use `bulkWrite` / `insertMany`, not loops of `insertOne` |

---

## The Optimization Workflow

```
1. MEASURE  → Establish baseline with real data
2. IDENTIFY → Find the actual bottleneck (not assumed)
3. FIX      → Address the specific bottleneck
4. VERIFY   → Measure again, confirm improvement
5. GUARD    → Add monitoring or test to prevent regression
```

### Step 1 — Measure

Two complementary approaches — use both:

- **Synthetic (Lighthouse via `lighthouserc.js`, DevTools Performance, Chrome DevTools MCP):** controlled and reproducible. Best for CI regression detection.
- **RUM (web-vitals library, real users):** required to validate that a fix actually helped real users.

**Frontend measurement:**

```bash
# Synthetic: project runs Lighthouse via lighthouserc.js
npx lhci autorun

# Or per-page locally
npx lighthouse http://localhost:5173/admin/risks --view
```

```typescript
// RUM: web-vitals library
import { onLCP, onINP, onCLS } from 'web-vitals';
onLCP((metric) => sendToAnalytics(metric));
onINP((metric) => sendToAnalytics(metric));
onCLS((metric) => sendToAnalytics(metric));
```

**Backend measurement:**

```typescript
// Add timing to suspicious queries
console.time('risk-list-query');
const risks = await db.collection('risks').find({ org_id }).toArray();
console.timeEnd('risk-list-query');

// Or use the existing audit-log timing fields if present
```

For broader profiling, use `node --inspect` and Chrome DevTools, or wrap the suspect path with `performance.now()`.

### Step 2 — Identify the Bottleneck

Use the symptom to decide what to measure first:

```
What is slow?
├── First page load
│   ├── Large bundle? --> Measure bundle, check route-level code splitting
│   ├── Slow TTFB? --> Profile backend route, check Mongo query and indexes
│   └── Render-blocking resources? --> Check network waterfall in DevTools MCP
├── Interaction sluggish
│   ├── UI freezes on click? --> Profile main thread, look for long tasks (>50ms)
│   ├── Form input lag? --> Check re-renders, controlled-component overhead
│   └── Animation jank? --> Check layout thrashing, forced reflows
├── Slow after navigation
│   ├── Data loading? --> Measure API response, check for waterfalls
│   └── Client rendering? --> Profile component renders
└── Backend / API
    ├── Single endpoint slow? --> Check Mongo query, indexes, N+1
    ├── All endpoints slow? --> Connection pool, memory, CPU
    └── Intermittent? --> Lock contention, GC pauses, external deps
```

---

## Common Anti-Patterns and Fixes

### N+1 Queries (Backend)

```typescript
// BAD: one query per risk for the owner
const risks = await db.collection('risks').find({ org_id }).toArray();
for (const risk of risks) {
  risk.owner = await db.collection('users').findOne({ _id: risk.owner_id });
}

// GOOD: single $lookup
const risks = await db.collection('risks').aggregate([
  { $match: { org_id } },
  { $lookup: {
      from: 'users',
      localField: 'owner_id',
      foreignField: '_id',
      as: 'owner',
    },
  },
  { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
]).toArray();
```

### Unbounded List Endpoints

```typescript
// BAD: returns every risk
const risks = await db.collection('risks').find({ org_id }).toArray();

// GOOD: existing project pagination pattern
const page = Number(req.query.page) || 1;
const page_size = Math.min(Number(req.query.page_size) || 20, 100);
const cursor = db.collection('risks')
  .find({ org_id })
  .sort({ created_at: -1 })
  .skip((page - 1) * page_size)
  .limit(page_size);
```

Hard cap `page_size` (e.g., 100) — don't trust client-supplied values.

### Missing Mongo Indexes

Every query must hit an index. Common required indexes for a workspace-scoped collection:

```typescript
db.collection('risks').createIndexes([
  { key: { org_id: 1, created_at: -1 } },     // list query
  { key: { org_id: 1, status: 1 } },           // status filter
  { key: { org_id: 1, _id: 1 } },              // findById within workspaces
]);
```

Verify by running `.explain('executionStats')` and confirming `IXSCAN`, not `COLLSCAN`.

### Image Optimization (Frontend)

```html
<!-- BAD: no dimensions, no responsive sizing, blocks LCP -->
<img src="/hero.jpg" />

<!-- GOOD: hero / LCP image with fetchpriority + srcset -->
<picture>
  <source
    srcset="/hero-800.avif 800w, /hero-1200.avif 1200w, /hero-1600.avif 1600w"
    sizes="(max-width: 1200px) 100vw, 1200px"
    type="image/avif"
  />
  <img
    src="/hero-1200.webp"
    width="1200"
    height="600"
    fetchpriority="high"
    alt="Hero description"
  />
</picture>

<!-- GOOD: below-the-fold lazy + async -->
<img src="/content.webp" width="800" height="400" loading="lazy" decoding="async" alt="..." />
```

Always set `width` and `height` to prevent CLS.

### Unnecessary React Re-renders

```tsx
// BAD: new object every render → children re-render
function RiskList() {
  return <RiskFilters options={{ sortBy: 'date', order: 'desc' }} />;
}

// GOOD: stable reference
const DEFAULT_OPTIONS = { sortBy: 'date', order: 'desc' } as const;
function RiskList() {
  return <RiskFilters options={DEFAULT_OPTIONS} />;
}

// React.memo for expensive components
const RiskRow = React.memo(function RiskRow({ risk }: Props) {
  return <tr>{/* expensive render */}</tr>;
});

// useMemo for expensive computations
function RiskStats({ risks }: Props) {
  const stats = useMemo(() => calculateStats(risks), [risks]);
  return <div>{stats.completed} / {stats.total}</div>;
}
```

Don't memoize everything — measure first. Over-memoization adds memory cost and code clutter.

### Bundle Size

```typescript
// Modern bundlers (Vite) tree-shake named imports automatically
// when ESM + sideEffects: false. The real wins are splitting and lazy loading.

// GOOD: dynamic import for heavy / rarely-used features
const ChartLibrary = lazy(() => import('./ChartLibrary'));

// GOOD: route-level code splitting
const SettingsPage = lazy(() => import('./pages/admin/Settings'));

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <SettingsPage />
    </Suspense>
  );
}
```

### Backend Caching

```typescript
// Cache frequently-read, rarely-changed config
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cachedConfig: AppConfig | null = null;
let cacheExpiry = 0;

async function getAppConfig(): Promise<AppConfig> {
  if (cachedConfig && Date.now() < cacheExpiry) return cachedConfig;
  cachedConfig = await db.collection('config').findOne();
  cacheExpiry = Date.now() + CACHE_TTL;
  return cachedConfig!;
}

// Static asset caching at nginx layer (already configured in nginx.conf)
// Verify Cache-Control: public, max-age=... immutable for hashed filenames
```

---

## Performance Budget

Set in `lighthouserc.js`. Suggested values:

```
JavaScript bundle:        < 250KB gzipped (initial load)
CSS:                      < 50KB gzipped
Images (above fold):      < 200KB per image
Fonts:                    < 100KB total
API response (p95):       < 200ms
Time to Interactive:      < 3.5s on 4G
Lighthouse Performance:   ≥ 90
```

Enforce in CI:

```bash
npx lhci autorun
# Bundle size check (add bundlesize.config if not present)
```

---

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "We'll optimize later" | Performance debt compounds. Fix obvious anti-patterns now, defer micro-optimizations. |
| "It's fast on my machine" | Your machine isn't the user's. Profile on representative hardware and networks. |
| "This optimization is obvious" | If you didn't measure, you don't know. Profile first. |
| "Users won't notice 100ms" | Research shows 100ms delays impact conversion. Users notice. |
| "The framework handles performance" | Frameworks prevent some issues but can't fix N+1 queries or oversized bundles. |

---

## Red Flags

- Optimization without before/after measurements
- N+1 patterns in data fetching
- List endpoints without pagination
- Mongo queries without an `org_id`-prefixed index
- Images without `width`/`height` (causes CLS)
- Bundle size growing PR-over-PR without review
- `React.memo` and `useMemo` everywhere (overuse is as bad as underuse)
- No web-vitals telemetry in production

---

## Input Schema

```yaml
input:
  trigger:
    type: enum
    values: [spec-requirement, monitoring-alert, regression-suspected, audit, sprint-gate]
    required: true
  scope:
    type: enum
    values: [single-page, single-endpoint, full-frontend, full-backend, full-stack]
    required: true
  baseline_metrics:
    type: object
    description: "Existing measurements before optimization (must be present for verify step)"
    properties:
      lcp_ms: { type: number }
      inp_ms: { type: number }
      cls: { type: number }
      api_p95_ms: { type: number }
      bundle_kb: { type: number }
  target_metrics:
    type: object
    description: "Target values from spec or Core Web Vitals 'Good' tier"
```

## Output Schema

```yaml
output:
  measurements:
    type: object
    properties:
      before:
        type: object
        properties:
          lcp_ms: { type: number }
          inp_ms: { type: number }
          cls: { type: number }
          api_p95_ms: { type: number }
          bundle_kb: { type: number }
          method: { type: string, description: "Lighthouse, RUM, manual timing, etc." }
      after:
        type: object
        properties:
          lcp_ms: { type: number }
          inp_ms: { type: number }
          cls: { type: number }
          api_p95_ms: { type: number }
          bundle_kb: { type: number }
  bottlenecks_addressed:
    type: array
    items:
      type: object
      properties:
        category:
          type: enum
          values: [n+1-query, missing-index, unbounded-list, image-optimization, react-rerender, bundle-size, missing-cache, layout-thrash, other]
        file: { type: string }
        before_evidence: { type: string }
        fix_summary: { type: string }
        after_evidence: { type: string }
  regressions_introduced: { type: array, items: { type: string } }
  guardrails_added:
    type: array
    description: "Tests, CI checks, monitoring added to prevent regression"
    items: { type: object, properties: { type: string, location: string } }
```

## Quality Gate

- Before AND after measurements are recorded with the same method
- Each fix targets a specific measured bottleneck — no speculative changes
- Core Web Vitals are within "Good" thresholds OR meet stricter spec target
- API p95 within 200ms (read) / 500ms (write) — or has a documented exception
- All list endpoints paginated with hard cap on `page_size`
- All Mongo queries hit indexes (`IXSCAN`, not `COLLSCAN`) — verified via `.explain()`
- No image without `width`/`height` introduced
- Bundle size hasn't increased without justification
- Existing tests still pass — optimization didn't break behavior
- A regression guardrail is in place (lighthouserc target, CI bundle check, or test)

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "performance-optimization"
  stage: "S3"
  suggested_next:
    - slug: "code-review-and-quality"
      stage: "S3"
      reason: "Run multi-axis review on the optimization to confirm clarity and architecture not degraded"
    - slug: "verification-gate"
      stage: "S3"
      reason: "Confirm before/after evidence and full test pass before merge"
    - slug: "deployment-verification"
      stage: "S5"
      reason: "Validate nginx caching headers and CDN behavior in deployed environment"
```

## Error Handling

- If baseline measurements are missing, refuse to optimize — gather them first. Optimization without baseline is guessing
- If the "fix" doesn't improve the measured metric, revert it — speculative complexity is worse than the original
- If multiple bottlenecks exist, fix one at a time and re-measure between each — combined fixes mask which one helped
- If `lighthouserc.js` budget regresses, the merge blocks until either the regression is fixed or the budget is updated with explicit justification
- If Mongo query lacks an index, prefer adding the index over rewriting the query — but verify with `.explain()` that the new index is actually used
- If `React.memo` is the proposed fix, require profiler evidence showing the re-render cost — don't memoize without measurement
