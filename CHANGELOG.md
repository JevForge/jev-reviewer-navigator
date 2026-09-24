# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.2.1] — TBD

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
