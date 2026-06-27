Title: Branch Completion
Keywords: branch, merge, pull-request, cleanup, integration, completion, workflow
Agents: release
When to use: When implementation is complete and all tests pass — to decide how to integrate the work (merge, PR, keep, or discard).
Version: 1.0.0
Last updated: 2026-03-18

Guide completion of development work by verifying tests, presenting structured options, executing the chosen workflow, and cleaning up. Core principle: Verify tests → Present options → Execute choice → Clean up.

---

## Workflow

### Step 1 — Verify Tests

**Before presenting options, verify ALL tests pass:**

```bash
# Build chain (sacred order)
npx tsc -p src/shared/tsconfig.json
npx tsc -p src/backend/tsconfig.json
npx tsc -p src/frontend/tsconfig.json --noEmit

# Run tests
npm run test:all
```

**If tests fail:** Stop. Do not proceed to Step 2. Report failures and fix first.

**If tests pass:** Continue.

### Step 2 — Determine Base Branch

```bash
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

### Step 3 — Present Options

Present exactly these 4 options:

```
Implementation complete. All tests passing. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (handle later)
4. Discard this work
```

Don't add explanation — keep options concise.

### Step 4 — Execute Choice

#### Option 1: Merge Locally

```bash
git checkout <base-branch>
git pull origin <base-branch>
git merge <feature-branch>
# Verify tests on merged result
npm run test:all
# If tests pass
git branch -d <feature-branch>
```

#### Option 2: Push and Create PR

```bash
git push -u origin <feature-branch>
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-3 bullets of what changed>

## Test Plan
- [ ] All tests passing
- [ ] Build chain verified (shared → backend → frontend)
- [ ] Sprint acceptance criteria met
EOF
)"
```

#### Option 3: Keep As-Is

Report: "Keeping branch `<name>`. Ready for later integration."

#### Option 4: Discard

**Confirm first:**
```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>

Type 'discard' to confirm.
```

Wait for exact confirmation. If confirmed:
```bash
git checkout <base-branch>
git branch -D <feature-branch>
```

---

## Anti-Patterns

- **Skipping test verification** — never present options without verified passing tests
- **Open-ended questions** — "What should I do next?" is ambiguous; present exactly 4 options
- **No confirmation for discard** — destructive actions require typed confirmation
- **Force-push without request** — never force-push unless explicitly asked

---

## Checklist

- [ ] Build chain passes (shared → backend → frontend)
- [ ] All tests pass
- [ ] 4 structured options presented
- [ ] Chosen option executed correctly
- [ ] Destructive actions confirmed before execution

## Input Schema

```yaml
input:
  feature_branch:
    type: string
    required: true
    description: "Name of the feature branch to complete"
  base_branch:
    type: string
    required: false
    default: "main"
    description: "Target branch for merge or PR base"
  pr_title:
    type: string
    required: false
    description: "Title for the pull request (Option 2 only)"
```

## Output Schema

```yaml
output:
  tests_passed:
    type: boolean
    description: "Whether all builds and tests passed in Step 1"
  option_chosen:
    type: integer
    enum: [1, 2, 3, 4]
    description: "Which of the 4 options the user selected"
  result:
    type: string
    description: "Outcome description (e.g., 'Merged to main', 'PR #42 created', 'Branch kept', 'Branch discarded')"
  pr_url:
    type: string
    required: false
    description: "URL of created PR (Option 2 only)"
```

## Quality Gate

- Build chain (shared, backend, frontend) passes with zero errors before presenting options
- All tests pass via `npm run test:all` before presenting options
- Exactly 4 options presented to the user — no more, no less
- Destructive actions (Option 4) require explicit typed confirmation before execution

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "branch-completion"
  stage: "S5"
  suggested_next:
    - slug: "release-notes"
      stage: "S5"
      reason: "After branch integration, create release notes for the delivered sprint"
    - slug: "doc-housekeeping"
      stage: "S5"
      reason: "After integration, ensure all mandatory documentation is updated"
```

## Error Handling

- If tests fail in Step 1, halt and report failures — do not present the 4 options
- If `git merge-base` cannot determine the base branch, prompt the user to specify it manually
- If PR creation via `gh pr create` fails (e.g., no remote, auth issue), fall back to pushing the branch and providing manual PR instructions
