# Docs style — how we write docs in this repo

Doc consistency matters because contexts get cleared periodically; a fresh agent or fresh-me must pick up frictionlessly. Apply these rules to every `.md` file in this repo.

## Rules

1. **Headings: sentence case.** `## Locked references`, not `## Locked References`.
2. **Date format: `YYYY-MM-DD` everywhere.**
3. **Status markers (suffix style):**
   - `(locked YYYY-MM-DD)` — irreversible decision.
   - `(set YYYY-MM-DD)` — current best call, may evolve.
   - `(updated YYYY-MM-DD)` — amended fact.
   - `(parked)` — intentionally on hold.
   - `(stale YYYY-MM-DD)` — known stale, scheduled for cleanup.
4. **Open questions: checkbox lists.** `- [ ]` open, `- [x] ~~strikethrough~~ — answer (YYYY-MM-DD)` closed.
5. **Bullets: `-`, never `*`.**
6. **Tables only when row/column structure is load-bearing.** Don't table prose.
7. **Code fences for runnable commands or schema/path strings.** Inline file paths get backticks (`hats/engineering.md`) — no fence.
8. **Cross-references: repo-relative paths in backticks.** No anchor links — they rot when headings change.
9. **Memory vs doc boundary:** memory holds *immutable facts and feedback rules*. Project docs hold *evolving plans and scope*. If it'd be wrong to "update," it's memory. If it changes next week, it's a doc.
10. **Section ordering per hat doc:** Persona → Current focus → Locked decisions → Open questions → Out of scope → Patterns/pitfalls (optional).
11. **One H1 per file, sentence-case.**
12. **Tone: confident, terse, human.** Short sentences. Active verbs. No hype.
13. **Patterns / pitfalls: numbered, problem → why → fix.** Each item self-contained for context-reset survival.
14. **No emoji in docs.**
15. **No time estimates anywhere.** Scope by in/out, not duration.

## Doc system entry order (for fresh contexts)

1. `memory/MEMORY.md` (auto-loaded)
2. `CLAUDE.md` (auto-loaded)
3. `STATUS.md` — current state pointer
4. `SCOPE-DEMO.md` — in/out boundary
5. `hats/<relevant>.md` — domain context
6. `weekly/<latest-monday>.md` — what just shipped

`VENTURE.md` and `competitors.md` are strategic-context — load only for strategic decisions, not code work.

## When a CHANGELOG entry is required

Any time a wave or hotfix bundle ships. Format: `## YYYY-MM-DD — <title>` followed by 3-8 bullets. Append to top.

## When STATUS.md must be updated

- Phase changes.
- Active week changes (Mondays).
- An open scope or product question gets resolved or a new one surfaces.
- A new blocker appears or clears.
