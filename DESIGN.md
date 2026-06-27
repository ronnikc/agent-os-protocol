# Agent OS Protocol — Design System

## Purpose

This document defines the visual direction for **Agent OS Protocol** based on the investor deck platform preview. The goal is to evolve the current localhost Agent OS Panel into a polished, investor-grade product UI while keeping it practical for real developer workflows.

The design should communicate:

- **Control** — the user is operating a serious agent coordination cockpit.
- **Trust** — verified agents, private lobbies, and auditable actions are central.
- **Velocity** — multiple specialist agents working in parallel.
- **Clarity** — the UI must remain operational, not just futuristic.
- **Extensibility** — the same design language should support Local Mode, Swarm Mode, Loop Mode, UI Assist, and Concordium Agent ID.

---

# 1. Visual Direction

## Core Style

The interface should use a **dark, high-contrast, glass-panel control-plane aesthetic**:

- Deep navy / near-black background
- Subtle blue grid, glow, and orbital network effects
- Glassmorphism panels with thin neon borders
- Cyan and violet gradient highlights
- Minimal but sharp iconography
- Clear status indicators for agents, tasks, lobbies, and identity
- Data-dense but not cluttered

The UI should feel like a mix of:

- Developer cockpit
- Agent swarm operations center
- Security dashboard
- Mission control panel

It should **not** feel like a generic SaaS admin template.

---

# 2. Brand Elements

## Logo

The Agent OS Protocol logo direction used in the deck is a **modular hex/cube mark** with cyan-to-violet gradients.

Recommended usage:

- Logo mark on the left side of the top bar
- Text lockup: `Agent OS Protocol`
- Use the logo mark alone in compact/collapsed sidebars
- Use the full lockup in the main header and public landing pages

## Brand Keywords

- Agentic
- Modular
- Verified
- Swarm-ready
- Runtime-agnostic
- Local-first
- Accountable
- Protocol-native

---

# 3. Color System

## Dark Theme — Default

The dark theme should be the primary theme.

| Token | Suggested Value | Usage |
|---|---:|---|
| `--color-bg` | `#050B18` | Main app background |
| `--color-bg-elevated` | `#0B1326` | Panels, cards, modals |
| `--color-bg-soft` | `#101B31` | Inputs, tabs, list rows |
| `--color-border` | `#223452` | Default borders |
| `--color-border-active` | `#20D6FF` | Active panel borders |
| `--color-cyan` | `#00E5D4` | Primary action / live status |
| `--color-blue` | `#318CFF` | Links, selected navigation |
| `--color-violet` | `#9B5CFF` | Swarm / identity accent |
| `--color-purple` | `#C85BFF` | Advanced / loop mode accent |
| `--color-green` | `#35F28A` | Online / success |
| `--color-yellow` | `#F5C542` | Warning / unverified |
| `--color-red` | `#FF4D6D` | Failed / blocked / destructive |
| `--color-text` | `#F5F8FF` | Primary text |
| `--color-text-muted` | `#8DA0BF` | Secondary text |
| `--color-text-soft` | `#5E728F` | Disabled / metadata |

## Gradients

Primary brand gradient:

```css
background: linear-gradient(90deg, #00E5D4 0%, #318CFF 50%, #9B5CFF 100%);
```

Panel glow gradient:

```css
box-shadow:
  0 0 24px rgba(49, 140, 255, 0.22),
  0 0 48px rgba(155, 92, 255, 0.12);
```

Active border gradient:

```css
border-image: linear-gradient(90deg, #00E5D4, #318CFF, #9B5CFF) 1;
```

---

# 4. Optional Light Theme

The light theme should be available, but secondary. It should keep the same premium technical identity without becoming a plain enterprise dashboard.

## Light Theme Principles

- Use a cool off-white background, not pure white.
- Keep cyan/blue/violet accents.
- Use soft shadows instead of heavy glow.
- Preserve the same layout, spacing, and icon language.
- Use subtle grid or orbital background effects only in hero/overview areas.

| Token | Suggested Value | Usage |
|---|---:|---|
| `--color-bg` | `#F5F8FC` | Main app background |
| `--color-bg-elevated` | `#FFFFFF` | Panels/cards |
| `--color-bg-soft` | `#EAF0F8` | Inputs/list rows |
| `--color-border` | `#D6E0EF` | Default border |
| `--color-border-active` | `#258BFF` | Active border |
| `--color-cyan` | `#00AFA5` | Primary action/status |
| `--color-blue` | `#246BFE` | Links/selected nav |
| `--color-violet` | `#7A4DFF` | Identity/swarm accent |
| `--color-purple` | `#A63CFF` | Advanced/loop accent |
| `--color-green` | `#0EAD69` | Online/success |
| `--color-yellow` | `#C98A00` | Warning/unverified |
| `--color-red` | `#E5484D` | Failed/destructive |
| `--color-text` | `#102033` | Primary text |
| `--color-text-muted` | `#52667F` | Secondary text |
| `--color-text-soft` | `#8A9BB2` | Disabled/metadata |

Light theme card shadow:

```css
box-shadow: 0 8px 24px rgba(20, 39, 68, 0.08);
```

---

# 5. Typography

Recommended font stack:

```css
font-family:
  Inter,
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

## Hierarchy

| Element | Weight | Size Guidance |
|---|---:|---:|
| App title | 700 | 20–24px |
| Page title | 700 | 26–34px |
| Section title | 650 | 18–22px |
| Card title | 650 | 15–17px |
| Body text | 400–500 | 14–16px |
| Table text | 500 | 13–15px |
| Metadata | 400 | 12–13px |
| Status labels | 600 | 12–13px |

Use **sentence case** for labels and headings, except for technical acronyms.

---

# 6. Layout System

## Main Structure

The Panel should use a top-navigation layout as shown in the current product:

1. **Top bar**
   - Agent OS Protocol logo/name
   - Lobby / swarm selector
   - Connection status
   - Active agents count
   - User/avatar menu

2. **Primary tabs**
   - Agents
   - Lobby
   - Messages
   - Tasks
   - Requests
   - Sprint
   - Scheduled
   - Files
   - Gantt
   - Memory

3. **Page content**
   - Page heading
   - Contextual action row
   - Stats/overview cards
   - Main table or workflow board

## Spacing

Use an 8px grid.

| Token | Value |
|---|---:|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |

## Border Radius

| Element | Radius |
|---|---:|
| Buttons | 8px |
| Inputs | 8px |
| Cards | 12px |
| Large panels | 16px |
| Pills/badges | 999px |

---

# 7. Navigation & Header

## Top Bar

The top bar should remain compact but clearer than the current local version.

Recommended elements:

```text
[Agent OS Protocol]                          [Mode: Local / Swarm] [Lobby: ...] [WS: Connected] [3 / 35 Agents] [User]
```

## Swarm Status Pill

Use a pill at top-right:

- `Local Mode`
- `Swarm: <lobby-url>`
- `Private Lobby`
- `Public Lobby`
- `Verified Lobby`

Status colors:

| State | Color |
|---|---|
| Connected | Green |
| Connecting | Yellow |
| Disconnected | Red |
| Private verified | Violet |
| Public | Blue |
| Local | Cyan |

---

# 8. Agent List / Table Design

The Agents table should feel operational and live.

## Columns

Recommended columns:

| Column | Purpose |
|---|---|
| Select | Batch actions |
| Agent | Agent name + icon |
| Scope | Short capability description |
| Identity | Unverified / Registry Verified / Human-linked / Org-linked |
| Status | Stopped / Starting / Online / Busy / Failed |
| Activity | Sparkline / current action |
| Runtime | Claude / Codex / OpenCode / API |
| Action | Start / Stop / Details |

## Agent Identity Badges

| Badge | Meaning |
|---|---|
| `Unverified` | No registry identity |
| `Registry Verified` | Agent card verified through registry |
| `Human-linked` | Agent linked to verified human owner |
| `Org-linked` | Agent linked to verified organization |
| `Failed` | Registry check failed |

---

# 9. Dashboard Stats Added to Agents View

The slide preview added a useful metrics row above the agent table. This should become a real development task.

## Proposed Stats Cards

| Stat | Example | Description |
|---|---:|---|
| **Agents Online** | `32 / 35` | Number of active agents compared with configured roster |
| **Tasks in Progress** | `128` | Active tasks currently assigned or in progress |
| **Sprint Progress** | `68%` | Completion percentage for active sprint |
| **Throughput** | `243 tasks/day` | Tasks completed per rolling 24h or 7-day average |
| **Success Rate** | `98.7%` | Completed tasks without failure or rollback |

## Optional Extra Stats

| Stat | Purpose |
|---|---|
| **Verified Agents** | Shows how many online agents have verified Agent ID |
| **Loop Runs** | Number of active or completed Loop Mode runs |
| **Budget Used** | Tokens / cost / runtime budget used in current sprint |
| **Blocked Tasks** | Critical operational risk signal |
| **Avg ACK Time** | How quickly agents acknowledge assignments |
| **Reassignments** | Indicates coordination quality or failing agents |

## Recommended MVP Stats

For the first implementation, add only these five:

1. Agents Online
2. Tasks in Progress
3. Sprint Progress
4. Throughput
5. Success Rate

The extra metrics can come later once task lifecycle events and identity verification are more mature.

---

# 10. Stats Dev Task Outline

## Task Title

**Add Agent OS Panel overview stats to Agents view**

## Objective

Add a compact metrics row to the top of the Agents tab showing operational health of the active lobby / local agent team.

## User Story

As a user operating Agent OS Panel, I want to see live stats for agents, tasks, sprint progress, throughput, and success rate so I can understand the health of the swarm before starting or managing work.

## Scope

### Add UI stats row above the agent table

Cards:

- Agents Online
- Tasks in Progress
- Sprint Progress
- Throughput
- Success Rate

### Add data aggregation layer

The server should expose a new endpoint:

```http
GET /api/overview-stats
```

Suggested response:

```json
{
  "agents": {
    "online": 3,
    "total": 35
  },
  "tasks": {
    "in_progress": 12,
    "completed_24h": 24,
    "failed_24h": 1,
    "blocked": 2
  },
  "sprint": {
    "active": true,
    "progress_percent": 68,
    "completed": 17,
    "total": 25
  },
  "throughput": {
    "tasks_per_day": 24,
    "window": "24h"
  },
  "success_rate": {
    "percent": 96.0,
    "window": "7d"
  }
}
```

### Data sources

Use available local state first:

- Agent roster / runtime status
- Local lobby state
- `tasks.jsonl`
- Sprint/work-item records
- Lobby task lifecycle events when connected

### Live updates

Stats should update when these events occur:

- Agent started/stopped
- Agent status changes
- Task created
- Task assigned
- Task completed
- Task failed
- Sprint progress changes
- Lobby connected/disconnected

Preferred mechanism:

- Initial load via `GET /api/overview-stats`
- Live refresh via existing WebSocket event bus
- Fallback polling every 15–30 seconds

## Acceptance Criteria

- Agents tab displays five stat cards above the agent table.
- Stats work in Local Mode.
- Stats work in Swarm Mode when lobby data is available.
- If data is unavailable, the card shows `—` rather than fake numbers.
- Stats update without page reload when relevant WebSocket events fire.
- No hardcoded demo stats remain in production code.
- The UI remains responsive on small laptop screens.
- Light and dark themes both support the new stats row.

## Out of Scope for MVP

- Historical charts
- Billing/cost analytics
- Agent reputation scoring
- Detailed per-agent performance dashboards
- Predictive sprint completion estimates

---

# 11. Component Guidelines

## Buttons

Primary button:

```css
background: linear-gradient(90deg, #00E5D4, #318CFF);
color: #FFFFFF;
border: none;
```

Secondary button:

```css
background: rgba(49, 140, 255, 0.12);
border: 1px solid rgba(49, 140, 255, 0.35);
color: #DCE8FF;
```

Danger button:

```css
background: rgba(255, 77, 109, 0.15);
border: 1px solid rgba(255, 77, 109, 0.55);
color: #FF8AA0;
```

## Inputs

Inputs should use dark elevated surfaces with clear active focus:

```css
background: #0B1326;
border: 1px solid #223452;
color: #F5F8FF;
```

Focus:

```css
border-color: #20D6FF;
box-shadow: 0 0 0 3px rgba(32, 214, 255, 0.12);
```

## Cards

Cards should use subtle depth, not heavy bevels.

```css
background: linear-gradient(180deg, rgba(16, 27, 49, 0.92), rgba(8, 14, 28, 0.92));
border: 1px solid rgba(49, 140, 255, 0.24);
border-radius: 14px;
```

Active card:

```css
border-color: rgba(0, 229, 212, 0.65);
box-shadow: 0 0 28px rgba(0, 229, 212, 0.14);
```

---

# 12. Status Language

Use consistent language across the Panel.

## Agent Status

| Status | Meaning |
|---|---|
| `Stopped` | Agent is configured but not running |
| `Starting` | Runtime process is launching |
| `Online` | Agent is connected and idle/ready |
| `Busy` | Agent is actively assigned |
| `Waiting` | Agent is waiting for approval/input |
| `Failed` | Runtime or task failure |
| `Disconnected` | Lost connection |

## Task Status

Use the canonical work-item vocabulary:

- `planned`
- `in_progress`
- `blocked`
- `complete`
- `cancelled`

In the UI, labels can render as:

- Planned
- In progress
- Blocked
- Complete
- Cancelled

---

# 13. Motion & Interaction

Use motion sparingly.

Recommended:

- Soft glow pulse for connected / online status
- Smooth tab transition, 120–180ms
- Small hover lift for cards
- Activity sparkline animation only when meaningful
- Loading skeletons for tables and cards

Avoid:

- Constant background motion
- Excessive particle animation
- Distracting hover effects
- Fake activity animations when no data exists

---

# 14. Accessibility

Minimum standards:

- WCAG AA contrast for all text
- Visible focus state for keyboard users
- No information conveyed only by color
- Agent statuses must include text labels, not only colored dots
- Tables must support keyboard navigation
- Light theme must not rely on low-contrast pastel text

---

# 15. Implementation Notes

## Recommended CSS Architecture

Use design tokens at root:

```css
:root[data-theme="dark"] { ... }
:root[data-theme="light"] { ... }
```

Use component classes:

```css
.aos-card {}
.aos-panel {}
.aos-button {}
.aos-button--primary {}
.aos-button--danger {}
.aos-status {}
.aos-status--online {}
.aos-stat-card {}
```

Avoid scattering raw hex values across components. All colors should map back to tokens.

## Theme Toggle

Add a simple theme selector:

- System
- Dark
- Light

Persist preference in local storage:

```js
localStorage.setItem('agent-os-theme', theme)
```

---

# 16. Design Principle Summary

Agent OS Panel should feel like:

> **A serious control plane for humans coordinating verified AI agents.**

It should not be just a developer dashboard. It should communicate the future product thesis:

- Agents are team members.
- Teams need coordination.
- Private swarms need identity.
- Autonomous loops need guardrails.
- Developers need control.
- Organizations need auditability.
