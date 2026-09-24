# Improvement plan — JEV Reviewer Navigator

Ordered delivery. The implementation is complete in this working tree. Each item
remains independently releasable through `JevForge/jev-release-forge`.

| # | Item | SemVer | Status |
|---|------|--------|--------|
| 1 | Idempotent assignment | `0.2.0` | done |
| 2 | Evidence table in PR comment | `0.2.1` | done |
| 3 | Decision cache (`cache_decisions`) | `0.2.2` | done |
| 4 | Required reviewers by path | `0.3.0` | done |
| 5 | Monorepo Navigator plan input | `0.3.1` | done |
| 6 | Team review-load aggregation | `0.3.2` | done |
| 7 | Extensible availability interface | `0.3.3` | done |
| 8 | `primary_reviewer` output | `0.3.4` | done |
| 9 | Composite Action wrapper | `0.4.0` | done |
| 10 | Friendly config validation errors | `0.4.1` | done |
| 11 | E2E fixture workflow | `0.4.2` | done |
| 12 | Marketplace demo diagram (SVG) | `0.4.3` | done |
| 13 | Release packaging / Marketplace metadata | `0.4.4` | ready for release operation |
| 14 | Consumer CODEOWNERS / Quick Start | `0.4.4` | done |

## Design notes

1. **Idempotent assign** — List existing requested reviewers/teams; request only the delta; `assign_status=unchanged` when nothing new.
2. **Evidence comment** — Markdown table from candidate signals (CODEOWNERS / history / label / component / load / availability).
3. **Cache** — `@actions/cache` keyed by SHA + config fingerprint + paths + provider; restore typed decision; `cache_hit` output.
4. **Required reviewers** — Config rules `{ paths, any_of, min }` unioned into suggestions after Jev (deterministic floor).
5. **Monorepo** — `monorepo_plan` JSON (`affected_projects`) mapped through `component_map` / `project_reviewer_map`.
6. **Team load** — Resolve team members via API; aggregate open review-request counts as soft signal.
7. **Availability** — Pluggable `AvailabilitySource`; default = org membership; never invent OOO.
8. **Primary** — `primary_reviewer` = first of `ranked_reviewers` (or null).
9. **Composite** — `composite/action.yml` checkout + run + re-export outputs.
10. **Config errors** — Human Zod messages (`team:slug`, not `org/team`).
11. **E2E** — Workflow with mock provider path / fixture decision (offline-safe).
12. **Demo SVG** — Visual INPUT → JEV → OUTPUT for README/Marketplace.
13. **Consumer CODEOWNERS** — Example protecting `.jev/reviewer-navigator.yml`.

## Non-goals (still)

- Free-form LLM inventing users outside allowlist
- Merge gates / Slack notifications
- Renaming public inputs
