# Roadmap features

Implemented beyond the original MVP prompt:

| Feature | Input gate | Notes |
|---------|------------|-------|
| Optional assignment | `assign_reviewers` + `decision_only=false` | Uses `pulls.requestReviewers` |
| Auto-assign intent | `auto_assign` | Documents always-on assign workflows |
| Team availability soft signal | `consider_availability` | Org membership only; never invents OOO |
| Review load soft signal | `consider_review_load` | Open `review-requested:` search counts |
| Deterministic fallback | always on for unavailable Jev | CODEOWNERS/history ranking, `provisional=true` |

## Future ideas (not implemented)

- Calendar / OOO integrations
- Cross-repo review-load dashboards
- Required-reviewer enforcement as a merge gate
- Slack / Teams notifications
