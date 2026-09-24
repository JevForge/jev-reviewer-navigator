# Contributing

Thanks for improving JEV Reviewer Navigator.

## Setup

```bash
git clone https://github.com/JevForge/jev-reviewer-navigator.git
cd jev-reviewer-navigator
npm ci
```

Requires **Node.js 24+**.

## Local checks

```bash
npm run typecheck
npm test
npm run build
# or everything:
npm run all
```

When you change TypeScript under `src/`, rebuild and **commit `dist/`** so consumers can use the Action without running `npm install`.

## Pull requests

* Keep PRs focused and small when possible.
* Add or update unit/contract/integration tests for schema, collectors, policy, and executors.
* Update README / CHANGELOG / examples when public behavior or docs change.
* Never commit secrets, tokens, or `.env` files.
* Do not rename public Action inputs/outputs without a clear breaking-change note.

## Issues

Use the bug or feature templates. **Never paste API keys or tokens into issues.**

Public docs and runtime messages are English.
