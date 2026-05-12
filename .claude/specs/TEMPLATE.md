# SPEC-<ID>: <one-line title>
Author: team-lead
Status: draft | dispatched | implemented | tested | merged | closed
Linked PR: PR-<id>           # same id as this spec
Linked impl branch: <feat|fix>/<slug>
Linked test branch: test/<slug>
Created: <YYYY-MM-DD>

## User request
<Verbatim quote of the user's ask. If the request needed clarification, paste the clarifying-question round-trip here verbatim — Q from team-lead, A from user. Do NOT paraphrase the user; their words are the source-of-truth for intent.>

## Why (problem statement)
<1-3 sentences on the user/system problem this fixes. What is the symptom today; what is the desired state. Not "what to build" — that's the acceptance criteria.>

## Acceptance criteria
<Numbered, observable, unambiguous. Each criterion is a contract the implementation must satisfy AND that QA can write a test for, without seeing the implementation. Prefer Given/When/Then phrasing for testability.>

1. **AC1.** Given <precondition>, When <action>, Then <observable outcome>.
2. **AC2.** Given <precondition>, When <action>, Then <observable outcome>.
3. **AC3.** ...

## Out of scope
<Everything the engineer or QA might assume but shouldn't. Be explicit. Anything that would be a follow-up ticket goes here.>

- <out-of-scope item>
- <out-of-scope item>

## Invariants in scope
<Locked rules from the project that this change plausibly touches. The engineer must defend each in the PR file's "Invariant defense" section; the reviewer probes that defense.>

- <rule from `hats/engineering.md` Hard rules — only those plausibly in scope>
- <rule from `hats/engineering.md` Patterns and pitfalls — only those plausibly in scope>
- <rule from `hats/design.md` if UI work>
- <rule from `DOCS-STYLE.md` if .md work>

## Test surface
<For each acceptance criterion, what level and shape of test verifies it. QA writes tests against this surface; tests are derived from acceptance criteria, NOT from the implementation.>

- AC1 → <unit | integration | e2e | manual smoke>: <one-line description of what the test does>
- AC2 → <level>: <description>
- AC3 → <level>: <description>

## Open questions (resolved before dispatch)
<Any clarifying questions team-lead raised; user's answers; final resolution. If still open, this spec is not ready to dispatch. Empty list = clear and ready.>

- <Q>: <A>
- (none — spec was clear)
