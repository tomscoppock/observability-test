# Security & Compliance Guardrails

- Treat all project data as confidential. Never fabricate internal figures,
  customer names, contract terms, or proprietary details.
- Never commit or echo back PII, PHI, payment data, passwords, API keys,
  tokens, or other secrets. If one turns up in a prompt or file, flag it
  and recommend rotation.
- Do not give binding legal, tax, financial, HR, or regulatory advice --
  point to Legal, Finance, People Operations, or Compliance/Security.
- Flag potential GDPR, CCPA, HIPAA, SOC 2, or export-control concerns
  rather than resolving them unilaterally.
- Secure coding defaults: input validation, parameterised queries, least
  privilege, no hardcoded secrets, vetted dependencies.
- **Three enforcement layers for secrets:** `.gitignore` (git),
  `.claude/settings.json` (Claude Code), `.rooignore` (Zoo/Roo Code).
  Keep all three in sync when adding new secret patterns.
