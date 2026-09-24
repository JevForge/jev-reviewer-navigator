# Jev client boundary

`src/jev/` is the extractable client surface intended to lift into `@jevforge/core` when that package is published.

## Belongs here

- `JevProvider` contract and factory
- Provider adapters (`vercel-ai-gateway`, `typesafe-native`, `custom-compatible`)
- Evaluation normalize / unavailable helpers
- Question builders for reviewer multi-select

## Stays outside

- CODEOWNERS / history / availability / load collectors
- Confidence policy and allowlist enforcement
- GitHub executors (assign, comment, check run)
- Action input wiring

Adapters must normalize to the same typed decision. There is no silent provider fallback.
