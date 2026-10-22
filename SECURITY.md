# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately via
GitHub's **Security → Report a vulnerability** form for this repository. Include the Verso
version, your operating system and the steps to reproduce.

You will get an answer as soon as possible; once a fix is available it is released and the
report is credited (unless you prefer otherwise).

## Supported versions

Security fixes are made for the latest release.

## Scope

Verso is a local desktop app: it opens no network ports and sends no telemetry. Relevant
reports include, for example, ways for a project folder, a ZIP archive, a `.tex`/`.bib`
file or a PDF to read or write files outside the project, run commands, or reach Node.js
APIs from the renderer.

How the app is protected is documented in [docs/security.md](docs/security.md).
