# Security Policy

## Reporting

Report vulnerabilities privately to the JevForge maintainers. Do not open public issues for secrets or exploitable bugs.

## Secrets

- Never commit API keys (`AI_GATEWAY_API_KEY`, `TYPESAFE_API_KEY`, `JEV_CUSTOM_API_KEY`).
- The Action never logs token values.
- Repository `jev_endpoint` does not receive credentials unless `trust_repo_jev_endpoint` is true.

## Trust model

Issue/PR text, paths, CODEOWNERS owners, labels, and commit metadata are untrusted. Only allowlisted reviewer ids can be suggested or assigned.
