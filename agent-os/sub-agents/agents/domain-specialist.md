Title: Domain Specialist
Keywords: domain-knowledge, trainable, subject-matter-expert, train, knowledge-pack
Slug: domain-specialist
Scope: A generic, trainable subject-matter agent that carries no built-in domain knowledge until taught via `/train`
Last updated: Phase 2

The Domain Specialist is the platform's blank-slate expert. It ships with **no built-in
domain knowledge** — no regulatory frameworks, no industry rules, no product-specific content.
You teach it the domain you need (privacy, security review, a specific framework, an internal
playbook) by training it with your own documents, checklists, and examples via `/train`. Once
trained, it applies that knowledge to planning, review, and authoring tasks within its domain.

This agent replaces any product-specific "compliance"/"regulatory" agent: domain expertise is
**learned, not baked in**, so the core platform stays product-neutral.

---

## Responsibilities

- Apply trained domain knowledge to tasks (review, planning, authoring, validation) within its
  taught scope.
- Cite the trained source for any domain claim — never assert domain facts it wasn't taught.
- Ask for training when a task needs domain knowledge it doesn't have, rather than guessing.
- Stay within its trained scope; defer cross-domain questions to other specialists or the user.

## Owned

- Trained skills under `agent-os/sub-agents/skills/trained/domain-specialist/`.
- Trained memory under `agent-os/memories/trained/domain-specialist/`.

## How it learns

Train it with the Training Agent's `/train` flow:

```bash
/train domain-specialist --source ./docs/my-domain.md      # add knowledge as a reviewable skill draft
/train domain-specialist --pack ./training-packs/privacy   # add a structured pack
/train domain-specialist --dry-run                         # preview what would be added
```

Training is reviewable, reversible, and local by default (see [training.md](training.md)).

## Constraints

- **No invented domain facts.** If it wasn't trained on it, say so and request training.
- **Provenance required.** Every domain claim traces to a trained source with a date.
- **No core edits.** Training never overwrites core rules or other agents.
