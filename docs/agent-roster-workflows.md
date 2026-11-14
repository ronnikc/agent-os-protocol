# Agent roster workflows

The hosted Panel exposes the three actions in **Agents** for lobby management. Imports currently take a public GitHub Markdown file URL pinned to a full commit SHA. Edit the loaded text in the preview and choose read-only or standard hosted tools. Manage saved drafts from **Manage drafts**, where you can request Agent Evaluation Engineer review, activate, or retire.

Hosted tasks read up to four active training records for the current lobby and role. Training is fetched at task time, and retirement removes it from future recall. Merge reflection can produce a training draft for approval when the lobby has a model configured and the task has an identifiable agent role. The existing local training CLI remains the local workflow.

The hosted verification suite checks that approved records survive a store restart, stay within their lobby and role, and reach an assigned workspace task. It also checks three successive requests on one hosted session before approval, after approval, and after retirement. Retired training is omitted from later system context. Earlier conversation history may still contain the agent's own discussion of that guidance.

Put **Create Agent**, **Import Agent**, and **Train Agent** in the Agents panel. Each action opens a draft with a preview, a tool and memory diff, an optional **Request agent review** action, and explicit activation. The draft shows the target lobby or local workspace before saving.

| Action | First step | Draft output |
| --- | --- | --- |
| Create Agent | Enter a name, purpose, responsibilities, inputs, output and runtime. | Native Agent OS definition with a unique slug and scoped tool selections. |
| Import Agent | Select a GitHub repository, revision and agent definition. | Native draft with the exact source commit and path, a conversion preview and an unresolved items list. |
| Train Agent | Select an installed role and supply a document or choose a lesson from Memory. | Reviewable skill draft attached to that role, with provenance and an activation preview. |

Import reads selected text through the existing GitHub integration or a public repository read. Treat source text as draft material. Resolve the commit before preview, cap the input, and show unsupported tools, missing skills and license information for review. Resolve slug collisions explicitly. External scripts, hooks and tool declarations do not run during import. A source example can be rewritten into original native instructions when reuse terms are unclear.

Tool choices come from capabilities the target runtime actually exposes. Show the requested permission, the granted scope and any setup required. New or expanded grants need an explicit approval from someone who can grant them. The runner enforces grants during execution. A draft or an imported instruction cannot grant itself a tool.

Send the draft and its proposed permissions to Agent Evaluation Engineer for a fixture plan. Offer Reality Checker for a second review of scope, unverified claims and handoffs. Both reviews attach findings to the draft. The person activating it sees the same revision the review examined. Edits invalidate the review for changed content. Activation records the previous version so the owner can revert it.

## Memory audit

Local memory has facts, diaries, an index builder, and a panel endpoint that renders a diary prompt. The endpoint invokes Bash. Exposing the rendered prompt in the panel does not establish that every launcher attaches it to later turns, especially on Windows.

The training CLI creates drafts and activates them into the target agent's trained skill directory. The runtime search did not establish that hosted agents read that directory. The hosted merge sweep records a lesson event when reflection succeeds. In direct-write mode it can also append repository memory. The hosted task prompt does not retrieve those recorded events. The loop reflection hook is best-effort, and the CLI's optional reflection runs the review in dry-run mode.

The current memory verification checks file and hook wiring, routing and dry-run review. It does not prove that a lesson recorded in one task changes a later task. A graph check on this Windows environment used its structural fallback because jq was unavailable.

## Implementation order and acceptance checks

1. Add a native draft format and the Create and Import paths. Fixtures should cover pinned sources, unsupported tool requests, duplicate slugs and permission denial. Importing must leave the installed roster unchanged until activation.
2. Build the visual training path over the existing draft and activation model. Test preview, review, activation and rollback with a synthetic source. Verify that an inactive skill is absent from the next task context and an active skill is present.
3. Connect self-learning to recall. Capture an outcome with its task, source revision and evidence, propose a lesson, and let the owner approve it for a role or lobby. Retrieve a bounded set of relevant approved lessons at task start. Show which lesson IDs were used and let owners retire stale entries.
4. Verify the full improvement cycle with two tasks across a restart. The first produces a lesson, the second recalls it after approval, and a rerun after retirement omits it. Include a second lobby and role to check isolation. Compare outcomes with the lesson disabled and enabled before claiming a measured improvement.
