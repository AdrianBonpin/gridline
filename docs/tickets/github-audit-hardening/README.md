# Comprehensive GitHub Issue and Codebase Audit Remediation

**Spec:** docs/superpowers/specs/2026-11-21-github-audit-hardening.md
**Baseline:** a9cb7ef5ec5091f8df4300bf06ac1cac8cce45c5
**Branch:** feat/github-audit-hardening
**Spec issue:** https://github.com/AdrianBonpin/gridline/issues/63

## Graph

| Ticket | Blocked by | Delivers |
| :--- | :--- | :--- |
| 01 | None (can start immediately) | Desktop E2E harness with a demo-database smoke flow |
| 02 | 01 | Exact Row Identity for edits and deletes |
| 03 | 02 | Single-row writes are atomic and conflict-aware |
| 04 | 01 | Pending work is scoped to its Change Origin |
| 05 | 04 | Viewer identity and freshness |
| 06 | 02, 05 | Selection follows Row Identity |
| 07 | None (can start immediately) | Explicit column rename intent |
| 08 | 01, 07 | SQLite rebuild is one transaction and refuses unsafe shapes |
| 09 | None (can start immediately) | Paginated reads describe the rows they return |
| 10 | 08 | SQLite rebuild preserves schema metadata |
| 11 | None (can start immediately) | Legal identifiers and definitions round-trip faithfully |
| 12 | 11 | Cross-schema foreign keys resolve and search |
| 13 | None (can start immediately) | Table actions are valid and single-path |
| 14 | 01 | Every Execution Entry Point is guarded |
| 15 | None (can start immediately) | SQL classification fails closed |
| 16 | 15 | Backend export is provably read-only |
| 17 | 04, 14, 15 | Destructive confirmation is bound to its request |
| 18 | 14 | Query workspace tells the truth |
| 19 | None (can start immediately) | One execution per request |
| 20 | None (can start immediately) | Copy and export fidelity |
| 21 | None (can start immediately) | SSH host trust before authentication |
| 22 | 21 | Deliberate SSH key re-enrollment |
| 23 | None (can start immediately) | TLS modes fail closed and verify the real host |
| 24 | None (can start immediately) | Connection lifecycle closes everything |
| 25 | None (can start immediately) | No application-wide head-of-line blocking |
| 26 | None (can start immediately) | Connection status and credential copy tell the truth |
| 27 | None (can start immediately) | Session-only credentials reach tool jobs |
| 28 | None (can start immediately) | DDL copy returns the payload verbatim |
| 29 | None (can start immediately) | File Grants: expand and secure backup output |
| 30 | 29 | Migrate restore, export, and import to File Grants |
| 31 | None (can start immediately) | Tool jobs are owned, bounded, and cancellable |
| 32 | 30, 31 | SQLite dump is snapshot-consistent and lossless |
| 33 | 30, 31 | PostgreSQL restore is transactional or explicitly non-atomic |
| 34 | 30, 31 | MySQL restore parses and cleans exactly |
| 35 | None (can start immediately) | OS file open is race-safe and Unicode-safe |
| 36 | None (can start immediately) | Local store integrity and permissions |
| 37 | 36 | Connection transfer round-trips |
| 38 | None (can start immediately) | Data import is type-driven and validated |
| 39 | None (can start immediately) | Everyday interaction never misfires |
| 40 | None (can start immediately) | #62 diagnostics and truthful Linux support surface |
| 41 | None (can start immediately) | AppImage startup and paint smoke |
| 42 | None (can start immediately) | Production CSP and least-privilege capabilities |
| 43 | None (can start immediately) | One release pipeline with least trust |
| 44 | 43 | Release inputs are verified |
| 45 | 43 | macOS signing fails closed |
| 46 | None (can start immediately) | Cask rendering validates inputs |
| 47 | None (can start immediately) | Dependency advisories remediated with governed exceptions |
| 48 | 47 | Dependency automation and cross-platform checks |
| 49 | None (can start immediately) | Version consistency across manifests |
| 50 | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49 | Release gate verification |

## Notes

- Ticket numbers follow dependency order; every blocker has a lower number.
- `01` is the only prefactoring ticket: it stands up the targeted end-to-end harness the later critical-flow tickets extend.
- File Grants land as an expand (`29`) then migrate (`30`) sequence; `30` also removes raw-path authorization.
- `50` is the release gate and is blocked by every preceding ticket.
- Local ticket files are canonical. Tracker issues mirror them.
