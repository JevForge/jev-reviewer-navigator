# Changelog

All notable changes to this project are documented in this file.

## [0.4.4] — 2026-09-24

### Added

* Required reviewer floors, monorepo project evidence, aggregated team load, and an extensible availability source.
* `primary_reviewer` output, composite wrapper, friendly config errors, offline E2E fixture, Marketplace flow diagram, and consumer CODEOWNERS example.

Release/tag publication remains a separate operation.

## [Unreleased]

## [0.2.2] — TBD

### Added

* Optional Actions cache for typed decisions (`cache_decisions` input, `cache_hit` output).

## [0.2.1] — 2026-09-24

### Added

* PR comment evidence table (CODEOWNERS / history / label / component / load / availability) per suggested reviewer.

## [0.2.0] — 2026-09-24

### Added

* Idempotent reviewer assignment: only request reviewers/teams not already on the PR (`assign_status=unchanged` when nothing new).

## [0.1.0] — 2026-09-24

### Added

* Initial public release of JEV Reviewer Navigator.
* CODEOWNERS, path history, labels, and component map evidence.
* Configurable Jev providers (`vercel-ai-gateway`, `typesafe-native`, `custom-compatible`).
* Recommend-only default with optional explicit assignment.
* Soft availability and review-load signals.
* Deterministic fallback when Jev is unavailable.
