---
name: Bug report
about: Report a bug or unexpected behavior in Gridline so we can fix it
title: "[Bug]: "
labels: ["bug"]
assignees: ''
---

<!--
  Thank you for reporting a bug! A complete report is the fastest way to get it fixed.
  Please fill in every section you can — the environment table alone often closes issues.
-->

## Before you submit

- [ ] I searched [existing issues](https://github.com/AdrianBonpin/gridline/issues?q=is%3Aissue) and this isn't a duplicate
- [ ] I'm on the latest release (check Help → About, or the [Releases](https://github.com/AdrianBonpin/gridline/releases) page)
- [ ] I will **not** paste passwords, connection strings containing credentials, or other secrets — if needed, redact them as `<REDACTED>`

## Summary

<!-- One or two sentences: what happened, and why it's a problem. -->

## Environment

| Field | Value |
| :--- | :--- |
| OS + version | <!-- e.g. macOS 14.5, Windows 11 24H2, Ubuntu 24.04 --> |
| Gridline version | <!-- e.g. 0.7.0 (check Help → About) --> |
| Install type | <!-- e.g. .dmg / .exe / .deb / .AppImage / built from source (`bun run tauri dev`) --> |
| Database type | <!-- PostgreSQL / MySQL / SQLite / Redis --> |
| Database version | <!-- e.g. PostgreSQL 16.4, MySQL 8.0.36, SQLite 3.45 --> |
| Where the DB runs | <!-- local / remote / hosted provider (Supabase, Neon, PlanetScale, Turso, …) --> |
| Connection method | <!-- direct TCP / SSH tunnel / TLS mode (disable / require / verify-ca / verify-full) / Unix socket / SQLite file path --> |
| Gridline architecture | <!-- e.g. Apple Silicon, Intel, x86_64, ARM64 --> |

## What did you expect to happen?

<!-- e.g. "Opening the table shows all 100k rows in the grid." -->

## What actually happened?

<!-- e.g. "The grid shows a 'failed to fetch table data' error after ~10 seconds." Include the exact error text if visible. -->

## Steps to reproduce

<!-- Numbered, minimal steps. Include the exact SQL/operations where relevant. -->

1. Open Gridline and connect to …
2. Click …
3. …

## Screenshots / recordings

<!-- Drag & drop images or a short screen recording (LICEcap, QuickTime, etc.). Redact any sensitive data first. -->

## Logs & error messages

<!--
  Paste the error text, console output, or a crash report here.
  On macOS: Console.app → Gridline. On Windows: Event Viewer → Application.
  Remove anything that looks like a host/user/password/token before pasting.
-->

```
(paste logs here)
```

## Impact

- [ ] Blocking — can't use a core feature at all
- [ ] Major — core feature works around it only with a workaround
- [ ] Minor — cosmetic or edge case

## Workaround

<!-- Anything that gets you unstuck today (e.g. "works when I connect without SSH", "restarting the app fixes it"). Even a partial workaround helps others. -->

## Additional context

<!-- Anything else: does it reproduce with a fresh connection or only one specific database? Did it work in an earlier version? Frequency (always / sometimes)? -->