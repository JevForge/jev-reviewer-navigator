# Decision contract

## Decisions

| Decision | Meaning | `suggested_reviewers` |
|----------|---------|------------------------|
| `RECOMMEND_REVIEWERS` | Safe allowlisted subset | Non-empty, ⊆ candidates |
| `ABSTAIN` | Insufficient evidence | Must be empty |
| `REQUEST_REVIEW` | Human should decide | Must be empty |

## Required fields

- `decision`, `confidence` (0..1), `reason_codes` (≥1), `summary`, `provisional`, `provider`
- `suggested_reviewers`, `ranked_reviewers` (unique login or `team:slug`)

## Invalid examples (schema rejects)

```json
{ "decision": "RECOMMEND_REVIEWERS", "suggested_reviewers": [], "confidence": 0.9, "reason_codes": ["CODEOWNERS_HIT"], "summary": "x", "provisional": false, "provider": "vercel-ai-gateway" }
```

```json
{ "decision": "ABSTAIN", "suggested_reviewers": ["alice"], "confidence": 0, "reason_codes": ["POLICY_ABSTAIN"], "summary": "x", "provisional": true, "provider": "vercel-ai-gateway" }
```

```json
{ "decision": "RECOMMEND_REVIEWERS", "suggested_reviewers": ["not valid!!!"], "confidence": 0.9, "reason_codes": ["FAKE"], "summary": "x", "provisional": false, "provider": "vercel-ai-gateway" }
```

## Deterministic executor limits

Jev never invents reviewers outside the allowlisted candidate set. Assignment requires `decision_only=false` and `assign_reviewers=true`. `summary` is never executed as a command.
