Title: Git Branch & Commit Management
Keywords: git-workflow, branch-merge, commit-squash, conflict-resolution, semantic-commits
Agents: release, scrum-coordinator
When to use: When checking out feature branches, rebasing branches, formatting semantic commit messages, resolving merge conflicts, and preparing tags.
Version: 1.0.0
Last updated: 2026-06-30

Codify standard procedures for branch checkouts, rebasing, squashing commits, resolving git merge conflicts, and writing semantic commit logs.

---

## Workflow

### Step 1 — Verify Repository Cleanliness
Before initiating any branch or rebase actions, execute `git status` to verify there are zero unstaged edits in the active workspace.

### Step 2 — Perform Branch Checkout & Pull
Create the target feature branch (`git checkout -b feature/[name]`) or checkout the main branch and pull the latest changes (`git checkout main; git pull`).

### Step 3 — Resolve Merge Conflicts
If a merge or rebase operation yields conflicts:
- Open the conflicting files and locate the merge boundary tags (`<<<<<<<`, `=======`, `>>>>>>>`).
- Compare changes, resolve logic differences, delete markers, and stage the updated files (`git add [file]`).
- Complete the merge or rebase (`git merge --continue` or `git rebase --continue`).

### Step 4 — Format Semantic Commit Message
Stage modifications and commit using structured formats:
`git commit -m "[type]: [short summary]"`
Allowed types: `feat` (new feature), `fix` (bug fix), `docs` (doc updates), `chore` (maintenance), `refactor` (code rewrite).

---

## Input Schema

```yaml
input:
  action_type:
    type: enum
    values: [checkout_branch, rebase, resolve_conflicts, commit]
    required: true
    description: "The Git action to perform"
  branch_name:
    type: string
    required: false
    description: "The name of the target branch"
```

## Output Schema

```yaml
output:
  git_status:
    type: object
    properties:
      success: { type: boolean }
      active_branch: { type: string }
      unstaged_changes: { type: boolean }
```

## Quality Gate

- Commit messages strictly use standard semantic formats (e.g. feat, fix, chore)
- All conflict tags (`<<<<<<<`, `=======`, `>>>>>>>`) are resolved and deleted before commit
- Rebases pull directly from up-to-date master tracking branches

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "git-branch-management"
  stage: "S2"
  suggested_next:
    - slug: "branch-completion"
      stage: "S2"
      reason: "Configured branch commits must be pushed and completed via verified PR merges"
```

## Error Handling

- If a rebase gets stuck or introduces severe regressions, abort the rebase (`git rebase --abort`).
- If unstaged changes block branch switching, stash them (`git stash`) before checking out.
