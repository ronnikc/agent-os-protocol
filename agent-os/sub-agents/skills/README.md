Title: Skills Index
Keywords: skills, index, capabilities, retrieval
Scope: all agents
Version: 1.1.0
Last updated: 2026-04-27

Scan this index to find the right skill for a task. Each skill has a summary line — read only the skills relevant to the current task.

---

## Skill Format (v1.1.0)

All 79 skills follow the unified v1.1.0 layered format with these mandatory sections:

| Section | Purpose |
|---------|---------|
| **Metadata block** | Title, Keywords, Agents, When to use, Version, Last updated |
| **Workflow** | Numbered step-by-step procedure |
| **Input Schema** | Typed YAML inputs the skill expects |
| **Output Schema** | Structured YAML output definition |
| **Quality Gate** | Pre-return verification checks |
| **Chain Metadata** | Skill slug, stage, suggested next skills |
| **Error Handling** | Edge cases and fallback behavior |

### Layered Skill Structure (v1.1.0)

Every skill lives in its own directory with a canonical entry point:

```
agent-os/sub-agents/skills/<slug>/
├── SKILL.md            # mandatory — metadata + workflow + schemas
├── references/         # optional — deep reference content loaded conditionally
│   └── *.md            # e.g., annex-a-2022.md, controls.md, evidence-templates.md
└── scripts/            # optional — bundled helper scripts (e.g., add-key.mjs)
    └── *.{sh,mjs,py}
```

**Conditional loading rule:** SKILL.md is the entry point and MUST be loaded by any agent invoking the skill. Reference files in `references/` are loaded ONLY when the workflow explicitly requires them (e.g., "if user asks about a specific Annex A control, load `references/annex-a-2022.md`"). This keeps agent context focused — load shallow, drill down when needed.

**Migration note:** The previous flat `<slug>.md` format was deprecated and migrated to the layered pattern in migrate2 on 2026-04-27. All cross-references updated.

**Stages:** S1=Engineering, S2=Process, S3=Quality, S4=Domain, S5=Delivery

---

## Retrieval Protocol

1. Read this INDEX first
2. Match task against skill summaries below
3. Load max 2–3 skills per task (preserve agent context)
4. If no skills match, proceed with agent definition only
5. Use Chain Metadata `suggested_next` to discover follow-on skills

---

## Skill Registry

### Engineering Skills

| Skill | File | Summary | Used by agents |
|-------|------|---------|----------------|
| Sprint Decomposition | [sprint-decomposition/SKILL.md](sprint-decomposition/SKILL.md) | Break sprint specs into sized, ordered, agent-routed tasks with dependency mapping | planning, product |
| Task Routing | [task-routing/SKILL.md](task-routing/SKILL.md) | Route decomposed tasks to the correct specialist agent with proper context; includes parallel dispatch decisions | planning |
| Codebase Exploration | [codebase-exploration/SKILL.md](codebase-exploration/SKILL.md) | Systematic codebase search: file patterns, grep strategies, impact tracing | research |
| Impact Analysis | [impact-analysis/SKILL.md](impact-analysis/SKILL.md) | Assess blast radius of a change: affected files, modules, tests, documentation | research |
| Codebase Graph Navigation | [codebase-graph-navigation/SKILL.md](codebase-graph-navigation/SKILL.md) | Build, query, and analyze the dependency graph for structural codebase intelligence | graph-navigator, research, planning |
| Service Pattern | [service-pattern/SKILL.md](service-pattern/SKILL.md) | Backend service implementation: constructor, org_id filtering, AppError, audit events | backend |
| Component Pattern | [component-pattern/SKILL.md](component-pattern/SKILL.md) | Frontend component implementation: useLocale, CSS naming, state management, hooks | frontend, design |
| API Contract Validation | [api-contract-validation/SKILL.md](api-contract-validation/SKILL.md) | Verify API contracts: request/response schemas, error formats, endpoint consistency | api |
| Test Patterns | [test-patterns/SKILL.md](test-patterns/SKILL.md) | Test implementation: mock patterns, factory functions, Zod validation, coverage | test |
| Coverage Enforcement | [coverage-enforcement/SKILL.md](coverage-enforcement/SKILL.md) | Verify and enforce CI coverage thresholds, identify uncovered code paths | test |
| Pattern Compliance | [pattern-domain-specialist/SKILL.md](pattern-domain-specialist/SKILL.md) | Review code against established patterns: imports, error handling, naming, security | code-review |
| Skill Maintenance & Authoring | [skill-maintenance/SKILL.md](skill-maintenance/SKILL.md) | Verify Agent OS skills remain accurate and author new skills: method names match source, no redundancy, metadata current, creation guidelines | code-review, documentation |
| Spec Linting | [spec-linting/SKILL.md](spec-linting/SKILL.md) | Validate sprint specs against Gate -2 structural checks before commit | product, code-review |
| Build Validation | [build-validation/SKILL.md](build-validation/SKILL.md) | TypeScript compilation validation, dependency-graph health, import resolution | build-integrity |
| Source-Driven Development | [source-driven-development/SKILL.md](source-driven-development/SKILL.md) | Ground every framework-specific decision in official docs for the version in package.json; cite sources; flag UNVERIFIED — anti-hallucination discipline | backend, frontend, api, test, research, documentation, accessibility |
| Incremental Implementation | [incremental-implementation/SKILL.md](incremental-implementation/SKILL.md) | Build in thin vertical slices: implement → test → verify → commit; scope discipline + feature flags + rollback-friendly increments | backend, frontend, api, test, infrastructure |
| Database Migration Audit | [database-migration-audit/SKILL.md](database-migration-audit/SKILL.md) | Audit database migrations, schema definitions, indexing efficiency, and rollback operations | database-administrator, backend |
| Asset Prototyping | [asset-prototyping/SKILL.md](asset-prototyping/SKILL.md) | Generate static wireframe sandboxes, wire design layouts, and stub image boundaries | design, frontend, demo-architect |
| MCP Server Configuration | [mcp-server-config/SKILL.md](mcp-server-config/SKILL.md) | Audit and configure Model Context Protocol (MCP) tool registrations, schemas, and connector settings | wordpress-specialist, drupal-specialist, joomla-specialist, umbraco-specialist, infrastructure |
| Mock API Specification | [mock-api-specification/SKILL.md](mock-api-specification/SKILL.md) | Design mock API handlers, MSW route stubs, and network interceptors for testing | api, e2e-architect, test, crm-integration-engineer |

### Process & Orchestration Skills

| Skill | File | Summary | Used by agents |
|-------|------|---------|----------------|
| Agent Task Execution | [agent-task-execution/SKILL.md](agent-task-execution/SKILL.md) | Execute sprint tasks via sub-agents with two-stage review: spec domain-specialist then code quality | planning, code-review |
| Implementation Planning | [implementation-planning/SKILL.md](implementation-planning/SKILL.md) | Create detailed, bite-sized implementation plans with exact file paths, code, and TDD steps | planning, product |
| Design Ideation | [design-ideation/SKILL.md](design-ideation/SKILL.md) | Structured pre-implementation design: explore context, propose approaches, present design, get approval | planning, product, ux, design, research |
| Review Request | [review-request/SKILL.md](review-request/SKILL.md) | Dispatch structured code reviews with git SHAs, diff context, and severity-based response handling | planning, backend, frontend, api |
| Branch Completion | [branch-completion/SKILL.md](branch-completion/SKILL.md) | Guide completion of development work: verify tests, present integration options, execute choice | release |
| Sprint Gate Enforcement | [sprint-gate-enforcement/SKILL.md](sprint-gate-enforcement/SKILL.md) | Run pre-sprint or close-out gate checks via sprint-gate-runner.sh, block progression on failures | sprint-gate-enforcer, planning |
| Deprecation and Migration | [deprecation-and-migration/SKILL.md](deprecation-and-migration/SKILL.md) | Code-as-liability discipline: deprecation decision, strangler/adapter/feature-flag patterns, Churn Rule, zombie-code response | planning, backend, frontend, api, infrastructure, release, documentation |
| Structured Data Analysis | [structured-data-analysis/SKILL.md](structured-data-analysis/SKILL.md) | Parse, filter, aggregate, and compile structured logs, CSVs, and telemetry data tables | research, database-administrator, planning |

### Quality & Discipline Skills

| Skill | File | Summary | Used by agents |
|-------|------|---------|----------------|
| TDD Discipline | [tdd-discipline/SKILL.md](tdd-discipline/SKILL.md) | Enforce Red-Green-Refactor cycle: no production code without a failing test first | test, backend, frontend, api |
| Root Cause Debugging | [root-cause-debugging/SKILL.md](root-cause-debugging/SKILL.md) | Systematic 4-phase debugging: root cause investigation before fixes, escalation after 3 failures | backend, frontend, api, test, build-integrity, infrastructure |
| Verification Gate | [verification-gate/SKILL.md](verification-gate/SKILL.md) | No completion claims without fresh verification evidence — applies to all agents and all sprint gates | all agents |
| Review Reception | [review-reception/SKILL.md](review-reception/SKILL.md) | Handle code review feedback: verify before implementing, push back when incorrect, clarify before acting | backend, frontend, api, test, build-integrity, domain-specialist, security, i18n, accessibility, infrastructure |
| Runtime Verification | [runtime-verification/SKILL.md](runtime-verification/SKILL.md) | Run comprehensive codebase health checks: type-check, lint, tests, security scan | build-integrity, sprint-gate-enforcer, code-review |
| Production Readiness Scan | [production-readiness-scan/SKILL.md](production-readiness-scan/SKILL.md) | Triage scan for 7 systemic anti-patterns (grep-based) — finds ~30% of issues, always escalate to specialist review | product-qa, frontend, code-review, sprint-gate-enforcer |
| Code Simplification | [code-simplification/SKILL.md](code-simplification/SKILL.md) | Reduce complexity preserving exact behavior — Chesterton's Fence, Rule of 500, scope discipline, project-specific safety patterns preserved | code-review, backend, frontend, api |
| Code Review and Quality | [code-review-and-quality/SKILL.md](code-review-and-quality/SKILL.md) | Five-axis review (correctness/readability/architecture/security/performance), change sizing ~100 lines, severity labels (Blocker/Critical/Nit/Optional/FYI) | code-review, planning, backend, frontend, api |
| Security and Hardening | [security-and-hardening/SKILL.md](security-and-hardening/SKILL.md) | OWASP Top 10 prevention: input validation at boundaries, secrets management, helmet/CSP, npm audit triage, file upload safety, SSRF allowlists | security, backend, frontend, api, code-review, infrastructure |
| Performance Optimization | [performance-optimization/SKILL.md](performance-optimization/SKILL.md) | Measure-first workflow: Core Web Vitals targets, N+1 fixes, Mongo index discipline, image optimization, bundle budgets, regression guardrails | frontend, backend, infrastructure, code-review |
| Chaos Testing | [chaos-testing/SKILL.md](chaos-testing/SKILL.md) | Inject network failures, service outages, and latency to audit recovery, exceptions, and resilience | chaos-steward, performance-analyst, test |
| Dependency Vulnerability Auditing | [vulnerability-auditing/SKILL.md](vulnerability-auditing/SKILL.md) | Run and audit dependency scanner alerts (e.g. npm audit) and securely resolve version increments | security, pipeline-specialist, infrastructure |
| Memory & Performance Profiling | [memory-profiling/SKILL.md](memory-profiling/SKILL.md) | Analyze Node/browser heap allocations, locate memory leaks, and profile connection cycles | performance-analyst, test |

### Domain Skills

| Skill | File | Summary | Used by agents |
|-------|------|---------|----------------|
| Audit Trail Verification | [audit-trail-verification/SKILL.md](audit-trail-verification/SKILL.md) | Verify audit events are emitted for all state changes per taxonomy | domain-specialist |
| RBAC Verification | [rbac-verification/SKILL.md](rbac-verification/SKILL.md) | Verify RBAC checks on endpoints, permission matrix domain-specialist, role assignments | security |
| Accessibility Audit | [accessibility-audit/SKILL.md](accessibility-audit/SKILL.md) | WCAG 2.1 AA domain-specialist audit: checklist, severity rating, remediation guidance | accessibility, ux |
| Accessibility Implementation | [accessibility-implementation/SKILL.md](accessibility-implementation/SKILL.md) | Implement accessibility: ARIA patterns, focus management, keyboard nav, screen reader support | accessibility, frontend |
| Accessibility Testing | [accessibility-testing/SKILL.md](accessibility-testing/SKILL.md) | Test accessibility: axe-core checks, keyboard testing, screen reader verification | accessibility |
| Design Token Audit | [design-token-audit/SKILL.md](design-token-audit/SKILL.md) | Verify styling variables, visual design system tokens, layout compliance, and contrast ratios | design-system-custodian, ux-researcher |
| Localization Verification | [localization-verification/SKILL.md](localization-verification/SKILL.md) | Audit translation keys synchronization, missing locale keys, and Dynamic UI localization hooks | i18n-specialist, content |
| CMS Hook & Plugin Integration | [cms-plugin-integration/SKILL.md](cms-plugin-integration/SKILL.md) | Audit, design, and implement custom plugin extensions, event hooks, and configuration overrides | wordpress-specialist, drupal-specialist, joomla-specialist, umbraco-specialist |
| Brand Guidelines Alignment | [brand-guidelines-alignment/SKILL.md](brand-guidelines-alignment/SKILL.md) | Audit visual copy, typography weights, logo dimensions, and page styling against official branding specs | design, ux, design-system-custodian, comms-specialist |
| Figma Design Integration | [figma-design-integration/SKILL.md](figma-design-integration/SKILL.md) | Interface with Figma REST APIs to extract design tokens, CSS variables, and clean vector SVGs | design, ux, design-system-custodian, frontend, demo-architect |

### Product & Validation Skills

| Skill | File | Summary | Used by agents |
|-------|------|---------|----------------|

### Delivery Skills

| Skill | File | Summary | Used by agents |
|-------|------|---------|----------------|
| Release Notes | [release-notes/SKILL.md](release-notes/SKILL.md) | Create sprint release notes: factual format, acceptance criteria mirroring | documentation |
| Doc Housekeeping | [doc-housekeeping/SKILL.md](doc-housekeeping/SKILL.md) | Post-sprint documentation updates: all 9 mandatory files, stats, dates | documentation |
| Release Checklist | [release-checklist/SKILL.md](release-checklist/SKILL.md) | Pre-release verification: builds, tests, stats, i18n, documentation completeness | release |
| Deployment Verification | [deployment-verification/SKILL.md](deployment-verification/SKILL.md) | Verify deployment: Docker build, health checks, security headers, CORS | infrastructure |
| Documentation and ADRs | [documentation-and-adrs/SKILL.md](documentation-and-adrs/SKILL.md) | Capture significant decisions as ADRs (Context/Decision/Alternatives/Consequences); inline why-not-what comments; Chesterton-fence comments for required-but-weird patterns | documentation, planning, product, code-review, backend, frontend, infrastructure, security |
| Pipeline Configuration | [pipeline-configuration/SKILL.md](pipeline-configuration/SKILL.md) | Manage, validate, and optimize automated CI/CD integration workflows, caching keys, and jobs | pipeline-specialist, infrastructure |
| Git Branch & Commit Management | [git-branch-management/SKILL.md](git-branch-management/SKILL.md) | Audit and coordinate branch checkouts, rebases, squashing, and commit message formats | release, scrum-coordinator |

### Content & Growth Skills

| Skill | File | Summary | Used by agents |
|-------|------|---------|----------------|
| Campaign Metric Auditing | [campaign-metric-audit/SKILL.md](campaign-metric-audit/SKILL.md) | Audit advertising conversion tracking codes, UTM query codes, and calculate acquisition metrics | ad-campaign-manager, newsletter-strategist, comms-specialist |
| SEO Competitor Analysis | [seo-competitor-analysis/SKILL.md](seo-competitor-analysis/SKILL.md) | Analyze organic competitor landing page metadata, keywords, and SERP layouts to optimize SEO targets | seo, seo-link-architect, ad-campaign-manager |

---

## When to Create a New Skill

Create a NEW skill when:
- A task type is performed repeatedly across sprints
- The task has specific rules that agents need to follow consistently
- A non-obvious procedure was discovered and should be codified
- An agent needs domain knowledge beyond its definition file

Update an EXISTING skill when:
- Adding detail to an established procedure
- Correcting a rule or adding a new edge case
- Reflecting a lessons-learned incident
- >70% overlap with an existing skill exists (extend, don't duplicate)

See [`skill-maintenance/SKILL.md`](skill-maintenance/SKILL.md) → Skill Authoring Guidelines for the full creation process.

---

*Last updated: 2026-04-27 — added 8 skills adapted from addyosmani/agent-skills: source-driven-development, incremental-implementation, code-simplification, code-review-and-quality, security-and-hardening, performance-optimization, documentation-and-adrs, deprecation-and-migration.*
