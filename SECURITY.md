# Security Policy

## Reporting a vulnerability

Do **not** open a public issue for exploitable security bugs or leaked secrets.

Use [GitHub Security Advisories](https://github.com/JevForge/jev-reviewer-navigator/security/advisories/new) for this repository when available. If advisories are not enabled, contact a JevForge organization owner through a private channel.

Never include production API keys, tokens, or credentials in any report.

## Secrets

| Secret | Used by |
| ------ | ------- |
| `AI_GATEWAY_API_KEY` | `vercel-ai-gateway` (default) |
| `TYPESAFE_API_KEY` | `typesafe-native` |
| `JEV_CUSTOM_API_KEY` | `custom-compatible` |

* Store them only as GitHub Actions secrets.
* The Action does not log token values.
* Repository `jev_endpoint` does not receive credentials unless `trust_repo_jev_endpoint` is explicitly `true`.

## Trust model

Changed paths, CODEOWNERS owners, labels, commit authors, and PR metadata are **untrusted**. Only allowlisted reviewer ids may be suggested or assigned. The `summary` output is human-readable text and must never be executed as a command or shell expression.
