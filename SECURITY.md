# Security Policy

## Reporting a vulnerability

Report security issues **privately** — open a GitHub security advisory on this
repository (Security → Advisories → Report a vulnerability), or contact the
owner through the profile on GitHub.

Please do **not** open a public issue for a vulnerability, and never include
real secrets, keys, or tokens in any report, issue, or pull request — describe
the class of problem and the file/commit instead of pasting a value.

## Scope notes

- This repo is a coordination board. It must never contain credentials; if you
  find one in history, treat it as compromised and report it privately so it
  can be rotated.
- The board checker (`tools/coms_check.py`) is read-only against the repo it
  runs in.
