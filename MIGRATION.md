# MIGRATION.md — Provenance & Historical Notes

> **Purpose.** This is the **single sanctioned location** for historical/provenance references
> in this repository. All other files in the default distribution are kept product-neutral.
> The branding/grep acceptance gates in `IMPLEMENTATION-PLAN.md` (§3, §13) treat documented
> notes in this file as the one allowed exception.

## Origin

Agent OS Protocol began as an internal multi-agent orchestration layer developed inside a
private GRC product (AesirX ComplianceOne) by Ronni K. Gothard Christiansen. It is now being
**forked into an independent, public, product-neutral platform** with no dependency on, and no
content from, that original product.

The independent platform:

- Is owned and maintained by **Gothard.dk // Ronni K. Gothard Christiansen**.
- Is licensed under the **Apache License 2.0** (the original internal code was proprietary).
- Carries **no** product-specific branding, agents, skills, memories, regulatory/domain
  content, staging URLs, or copyright headers from the original project.
- Ships a generic, trainable agent roster; any domain knowledge is added by the user via
  `/train` as optional, reversible packs.

## What changed in the fork

| Area | Original (internal) | Independent platform |
|---|---|---|
| Copyright | `AesirX.io Ltd.`, "proprietary and confidential" | `Gothard.dk // Ronni K. Gothard Christiansen`, Apache-2.0 + SPDX headers |
| License | Proprietary | Apache-2.0 (`LICENSE` + `NOTICE`) |
| Lobby URL | Hardcoded product staging URL | Configurable `AGENT_OS_LOBBY_URL` (empty = Local Mode) |
| Agents | Included product-specific/domain agents | Generic roster + a trainable Domain Specialist |
| Skills/memories | Included product regulatory/domain content | Removed from the default distribution |
| Generated state | Forked graph/observations/indexes | Regenerated fresh; never carried over |

## Source-of-truth boundary

During the fork, the original repository was treated as **read-only reference only** and was
never modified. The extraction copied generic infrastructure and neutralized it; product
content was dropped (not carried), and runtime/generated state was regenerated rather than
forked. See `IMPLEMENTATION-PLAN.md` §7 (extraction manifest) for the file-level disposition.

## Third-party material

Any third-party components retained during extraction keep their upstream license notices
(MIT/BSD are Apache-2.0 compatible); see `NOTICE`.
