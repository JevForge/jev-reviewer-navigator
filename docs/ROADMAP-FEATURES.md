# Roadmap features

All items in the original improvement plan through `0.4.4` are implemented in
the current working tree; live release/tag publication remains an explicit
release operation.

Implemented beyond the original MVP prompt:

| Feature | Input gate | Notes |
|---------|------------|-------|
| Optional assignment | `assign_reviewers` + `decision_only=false` | Uses `pulls.requestReviewers` |
| Auto-assign intent | `auto_assign` | Documents always-on assign workflows |
| Team availability soft signal | `consider_availability` | Org membership only; never invents OOO |
| Review load soft signal | `consider_review_load` | Open `review-requested:` search counts |
| Deterministic fallback | always on for unavailable Jev | CODEOWNERS/history ranking, `provisional=true` |
| Required reviewer floor | `required_reviewers` in config | Path-matched deterministic minimum from an allowlisted pool |
| Monorepo evidence | `affected_projects` or `monorepo_plan` | Project mappings become candidate evidence |
| Primary reviewer | `primary_reviewer` output | First ranked reviewer or empty |
| Team load aggregation | `consider_review_load` | Sums open requests for resolvable team members |
| Availability source | `AvailabilitySource` interface | Membership default; OOO remains unknown |
| Composite wrapper | `composite@v0` | Checkout + Action + output re-export |

## Future ideas (not implemented)

- Calendar / OOO integrations
- Cross-repo review-load dashboards
- Required-reviewer enforcement as a merge gate
- Slack / Teams notifications
