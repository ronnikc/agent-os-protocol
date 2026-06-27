Title: Security and Hardening
Keywords: security, owasp, hardening, input-validation, authentication, authorization, secrets, npm-audit, csp, rate-limiting, xss, injection, helmet
Agents: security, backend, frontend, api, code-review, infrastructure
When to use: When handling user input, building authentication/authorization, storing or transmitting sensitive data, integrating with external APIs, adding file uploads or webhooks, modifying CORS/CSP configuration, or auditing dependencies. Always run as a quality gate on any PR that touches an external boundary.
Version: 1.0.0
Last updated: 2026-04-27

OWASP Top 10 prevention discipline for the Agent OS Protocol codebase. Treat every external input as hostile, every secret as sacred, and every authorization check as mandatory. Complements `rbac-verification` (which checks RBAC on every endpoint) by covering the rest of the security surface — input validation, secrets, headers, dependencies, sessions, and rate limiting. Adapted from [addyosmani/agent-skills security-and-hardening](https://github.com/addyosmani/agent-skills/blob/main/skills/security-and-hardening/SKILL.md).

---

## The Three-Tier Boundary System

### Always Do (No Exceptions)

- **Validate all external input** at the boundary using a `Zod` schema (existing project pattern) before passing to the service layer
- **Parameterize all database queries** — the native MongoDB driver does this when you pass operators as objects; never build queries from string concatenation
- **Encode output** to prevent XSS — React auto-escapes `{value}`; never use `dangerouslySetInnerHTML` with user data
- **HTTPS everywhere** for external communication
- **Hash secrets** with `bcrypt` (existing project dep) — minimum salt rounds 12
- **Set security headers** via `helmet` (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- **Use `httpOnly`, `secure`, `sameSite` cookies** for sessions
- **Run `npm audit` before every release** as part of `release-checklist`
- **Verify `enforceOrgScope` middleware** is on every authenticated route — workspace-scoped isolation

### Ask First (Requires Human Approval)

- Adding new authentication flows or changing auth logic
- Storing new categories of sensitive data (PII, payment info, platform evidence files)
- Adding new external service integrations
- Changing CORS configuration
- Adding file upload handlers
- Modifying rate limiting (`adminRateLimiter`)
- Granting new permissions or roles in `the role-seed file`
- Disabling any helmet directive

### Never Do

- **Never commit secrets** to git — `.env` is gitignored; verify before staging
- **Never log sensitive data** (passwords, session tokens, full credit card numbers, PII in audit events)
- **Never trust client-side validation** as a security boundary
- **Never disable security headers** for convenience
- **Never use `eval()` or `Function()`** with user-provided data
- **Never store auth tokens in `localStorage`** or any client-readable storage
- **Never expose stack traces** or internal error details to API clients — `error-handler` middleware enforces this

---

## OWASP Top 10 — Project Patterns

### A01: Broken Access Control

Always check authorization, not just authentication. The user being logged in is necessary but not sufficient.

```typescript
// Every protected route runs this chain:
router.use(authenticate as any, enforceOrgScope as any, adminRateLimiter);

// Plus a permission check on the action:
router.patch(
  '/:id',
  requirePermission(Permission.RISK_UPDATE) as any,
  async (req, res, next) => {
    const session = (req as AuthenticatedRequest).session;
    const updated = await riskService.update(
      session.org_id,        // first arg = org scope
      req.params.id as string,
      req.body
    );
    res.json(updated);
  }
);
```

Cross-workspaces access is the #1 workspace-scoped bug. `enforceOrgScope` + service signature `(org_id, ...)` together prevent it. Never bypass either. See `rbac-verification` for the full RBAC checklist.

### A02: Cryptographic Failures

```typescript
import { hash, compare } from 'bcrypt';

const SALT_ROUNDS = 12; // minimum
const hashedPassword = await hash(plaintext, SALT_ROUNDS);
const isValid = await compare(plaintext, hashedPassword);
```

- Passwords: bcrypt only — never plaintext, never SHA-only, never reversible encryption
- Session secrets: from `process.env`, never hardcoded
- PII: encrypt at rest if stored; minimize in audit events

### A03: Injection (NoSQL Operator Injection in MongoDB)

```typescript
// BAD: lets the user inject MongoDB operators via JSON body
await db.collection('users').findOne({ username: req.body.username });

// GOOD: validate with Zod first, narrow to string before query
const schema = z.object({ username: z.string().min(1).max(64) });
const { username } = schema.parse(req.body);
await db.collection('users').findOne({ username });
```

- Never pass raw `req.body` fields directly into Mongo filters
- Validate with `Zod` at the boundary
- Narrow `req.params.x` (which is `string | string[]`) with `as string` before service calls

### A04: Insecure Design — Validation at Boundaries

```typescript
import { z } from 'zod';

const CreateRiskSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  due_date: z.string().datetime().optional(),
});

router.post('/', requirePermission(Permission.RISK_CREATE) as any, async (req, res, next) => {
  const result = CreateRiskSchema.safeParse(req.body);
  if (!result.success) {
    return next(new AppError(422, 'VALIDATION_ERROR', 'Invalid input', { details: result.error.flatten() }));
  }
  const risk = await riskService.create((req as AuthenticatedRequest).session.org_id, result.data);
  res.status(201).json(risk);
});
```

Schema validation lives at the route boundary. Services trust their inputs because routes have validated them.

### A05: Security Misconfiguration

```typescript
import helmet from 'helmet';
app.use(helmet());

app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
  },
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:3000',
  credentials: true,
}));
```

- CORS: `origin: '*'` is **never** acceptable in production
- CSP: tighten `unsafe-inline` away as soon as styling allows
- `nginx.conf` headers: must mirror helmet, not weaken it

### A06: Vulnerable & Outdated Components — npm audit Triage

```
npm audit reports a vulnerability
├── Severity: critical or high
│   ├── Reachable in the running app?
│   │   ├── YES → fix immediately (update, patch, replace)
│   │   └── NO (dev-only, unused path) → fix soon, not a release blocker
│   └── Fix available?
│       ├── YES → update to patched version
│       └── NO → workaround, replace dep, or allowlist with review date
├── Severity: moderate
│   ├── Reachable in production → fix in next release
│   └── Dev-only → backlog
└── Severity: low → next dependency update cycle
```

When deferring, document the reason and review date. `npm audit --production` is what `release-checklist` runs.

### A07: Authentication Failures

```typescript
app.use(session({
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

// Stricter rate limit on auth
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
```

### A08: Software & Data Integrity — File Uploads

```typescript
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function validateUpload(file: UploadedFile) {
  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'File type not allowed');
  }
  if (file.size > MAX_SIZE) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'File too large (max 10MB)');
  }
  // For evidence files: verify magic bytes, not extension
}
```

### A09: Logging Failures

- Audit events MUST cover all state changes (`audit-trail-verification`)
- Never log passwords, tokens, or full PII payloads
- Stack traces stay server-side — `error-handler` strips them from responses

### A10: SSRF on External Integrations

When the backend fetches a user-supplied URL (webhooks, evidence imports), allowlist hosts and reject internal IP ranges (`127.0.0.1`, `169.254.169.254`, RFC1918) before the request.

---

## Sensitive Data Hygiene

```typescript
// Strip sensitive fields from API responses
function sanitizeUser(user: UserRecord): PublicUser {
  const { password_hash, reset_token, mfa_secret, ...publicFields } = user;
  return publicFields;
}

const API_KEY = process.env.STRIPE_API_KEY;
if (!API_KEY) throw new Error('STRIPE_API_KEY not configured');
```

**Pre-commit secret check:**
```bash
git diff --cached | grep -iE "password|secret|api[_-]?key|token|bearer"
```

`.gitignore` must include: `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`.

---

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "This is an internal admin tool, security doesn't matter" | This platform handles real code and credentials. Internal-only admin endpoints are still security-relevant. |
| "We'll add security later" | Security retrofitting is 10x harder than building it in. Add it now. |
| "No one would try to exploit this" | Automated scanners will find it within hours of deployment. |
| "Helmet handles CSP for us" | Helmet provides defaults. You still need to tighten CSP for the specific app. |
| "It's just a prototype" | Prototypes become production. Security habits from day one. |
| "The audit warning is dev-only, ignore it" | Triage with the decision tree above — dev-only doesn't mean zero risk. |

---

## Red Flags

- User input passed directly into Mongo filters, shell commands, or `dangerouslySetInnerHTML`
- Secrets in source code or git history
- Authenticated routes without `requirePermission` or `enforceOrgScope`
- CORS `origin: '*'` in any environment but local dev
- No rate limit on `/api/auth/*`
- Stack traces exposed in API responses
- Critical/high `npm audit` findings without a triage decision recorded
- File upload handlers without type and size validation
- New external integrations without an SSRF allowlist
- Audit events containing raw passwords, tokens, or full PII

---

## Input Schema

```yaml
input:
  changeset_paths:
    type: array
    items: string
    required: true
    description: "Files in scope for security review"
  surface_areas:
    type: array
    items:
      type: enum
      values: [auth, input-validation, file-upload, external-integration, secrets, headers, cors, dependencies, audit-logging, rbac]
    required: true
    description: "Which security surfaces the change touches"
  is_release_gate:
    type: boolean
    required: false
    default: false
    description: "If true, runs the full release checklist (including npm audit) and blocks on any critical/high finding reachable in production"
```

## Output Schema

```yaml
output:
  findings:
    type: array
    items:
      type: object
      properties:
        severity:
          type: enum
          values: [Blocker, Critical, Major, Minor, Info]
        owasp_category: { type: string, description: "A01..A10 if applicable" }
        surface: { type: string }
        file: { type: string }
        line: { type: integer }
        description: { type: string }
        remediation: { type: string }
  npm_audit:
    type: object
    description: "Only populated if dependencies surface was reviewed"
    properties:
      critical_high_reachable: { type: integer }
      critical_high_unreachable_deferred: { type: integer }
      moderate: { type: integer }
      low: { type: integer }
      deferral_decisions: { type: array, items: { type: object, properties: { package: string, reason: string, review_by: string } } }
  summary:
    type: object
    properties:
      blocker_count: { type: integer }
      critical_count: { type: integer }
      passed: { type: boolean, description: "True iff zero Blocker and zero reachable Critical findings" }
```

## Quality Gate

- Zero Blocker findings (missing auth, missing RBAC, secret committed, SQL/NoSQL injection)
- Zero Critical findings reachable in production code paths
- All user input validated with Zod at the route boundary
- Every authenticated route runs `authenticate` + `enforceOrgScope` + `requirePermission`
- No `dangerouslySetInnerHTML` with user-derived data
- No CORS wildcard origin in non-local environments
- `helmet` enabled with CSP appropriate for the app
- Auth endpoints have a stricter rate limit than general API
- `npm audit` triaged: every critical/high either fixed or has a deferral decision recorded
- No secrets in the diff (grep check passed)

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "security-and-hardening"
  stage: "S3"
  suggested_next:
    - slug: "rbac-verification"
      stage: "S4"
      reason: "Verify per-route permission checks and the seeded permission matrix"
    - slug: "audit-trail-verification"
      stage: "S4"
      reason: "Confirm state-changing operations emit audit events for compliance"
    - slug: "code-review-and-quality"
      stage: "S3"
      reason: "Run the five-axis review with security as one of the axes"
    - slug: "deployment-verification"
      stage: "S5"
      reason: "Verify nginx headers and CORS in deployed environment match policy"
```

## Error Handling

- If a Blocker is detected, stop the review and report immediately — do not continue scanning unrelated surfaces
- If `npm audit` cannot run (network failure), retry once; if still failing, mark `npm_audit` results as `unverified` and block release
- If a finding's severity is ambiguous, default to the higher severity and let the user downgrade with explicit justification
- If a security pattern conflicts with existing project code, do NOT silently rewrite — surface the conflict and route to the Security Specialist
- If reviewing dependencies and a critical CVE has no patch, the deferral decision must include: package, version, reason production code is/isn't reachable, review-by date, owning agent
- If the change adds a new external integration, require an SSRF allowlist and an updated CORS/CSP review before approval
