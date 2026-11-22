# Comprehensive GitHub Issue and Codebase Audit Remediation

**Baseline:** a9cb7ef5ec5091f8df4300bf06ac1cac8cce45c5   **Branch:** feat/github-audit-hardening   **Date:** 2026-11-21

## Problem Statement

Gridline users can currently reach behavior that undermines the core promise of a trustworthy database client: a row edit or delete can address more than the selected row, staged work can outlive the database context in which it was created, schema edits can misinterpret user intent, and equivalent SQL operations do not consistently receive equivalent safety checks. Backup, restore, export, connection, and lifecycle paths also contain correctness, partial-failure, resource-management, and platform defects that the green unit-test baseline does not exercise.

The public tracker has one open issue and no open pull requests. Issue #62 reports that the current AppImage opens to a black screen on Fedora, but it lacks the exact Fedora release, graphics environment, diagnostics, and workaround results needed to identify a cause. The README's support language is broader than the available evidence. Closing or claiming to fix that report without environment-specific confirmation would be misleading.

The dependency baseline also needs remediation. The JavaScript production audit reports 55 affected-package advisory entries, including critical and high severity entries; this count includes multiple advisories per package and is not a count of demonstrated exploits. Rust auditing reports 18 vulnerabilities with patched upgrades, plus 20 warnings covering unmaintained, unsound, or yanked dependencies. Release automation and local privilege boundaries need to make security guarantees enforceable rather than documentary.

## Solution

Complete one comprehensive remediation cycle for every confirmed behavioral, security, reliability, and release finding from the baseline audit. Deliver it as sequential, focused pull requests into `prod`, with a single release gate: no new release is published until every applicable acceptance behavior and verification requirement in this specification passes. Pure style-only cleanup and unconfirmed hypotheses are not silently mixed into the cycle.

Gridline will make Row Identity, Change Origin, Column Identity, SSH Host Trust, and File Grants explicit. Every Execution Entry Point will apply consistent safety rules. Data-changing operations will fail before durable mutation when identity, origin, or stale-write checks fail. Schema rebuilds will preserve user data and metadata or make no change. Long-running work will be cancellable, bounded, isolated from unrelated connections, and honest about partial success.

For #62, Gridline will provide a diagnostic guide, accurate distribution-support language, and packaged-artifact startup/paint coverage. It will not ship an unconditional graphics workaround or close the issue until the reporter or an equivalent Fedora environment confirms the result.

Security-sensitive evidence and exploit reproductions remain in private advisories. Public planning records only the safety invariants and acceptance behavior needed to verify the fixes.

## User Stories

### Data editing and schema integrity

1. As a database user editing a table with a composite primary key, I want every key column included in Row Identity, so that editing or deleting one row cannot affect its sibling rows.
2. As a database user editing a table without a primary key, I want the backend row locator to address exactly the displayed row without becoming a visible/exported data column, so that no-PK editing is safe and exports remain replayable.
3. As a database user, I want an update or delete that matches zero or multiple rows to roll back before returning an error, so that a reported failure never conceals a durable write.
4. As a database user committing an edited value, I want the original value of that edited column checked during the write, so that another session's intervening change to the same value is surfaced as a conflict rather than silently overwritten.
5. As a developer moving between environments, I want pending changes grouped by their exact Change Origin, so that work staged for one connection, database, or target configuration can never be committed to another.
6. As a developer switching connections or databases, I want navigation to remain available and each origin's pending work to reappear when I return, so that safety does not require blocking normal exploration.
7. As a developer changing a saved connection's target while work is pending, I want the old work to refuse commit against the retargeted connection, so that a reused connection name or identifier does not redirect staged writes.
8. As a database user, I want tabs and their data associated with their originating connection and database, so that refreshing or revisiting a tab cannot silently query a newly selected database under an old tab's identity.
9. As a developer using Commit All, I want changes for the active origin applied sequentially with per-change atomicity, stopping at the first failure and clearly reporting earlier successes, so that I know exactly what is durable without a false all-or-nothing promise.
10. As a database user selecting rows, I want selection tied to Row Identity within a tab and cleared on every page, filter, sort, tab, origin, and dataset change, so that bulk copy/delete acts only on rows currently selected in the visible result context.
11. As a schema editor, I want column rename to be an explicit action independent of position, so that adding, moving, or removing a column is never inferred to be a rename.
12. As a SQLite user reordering columns or applying several edits together, I want values copied by Column Identity and all requested edits represented, so that no values move into the wrong column and no staged difference disappears.
13. As a SQLite user whose table requires rebuild, I want the rebuild to run atomically and preserve columns, primary/foreign keys, checks, unique constraints, indexes, triggers, generated-column definitions, table options, and sequences, so that a successful rebuild does not silently degrade the schema.
14. As a SQLite user with a table shape that cannot be rebuilt faithfully, I want a specific refusal before any mutation, so that unsupported rebuilds never leave a temporary, dropped, or partially modified table.
15. As a schema editor opening Edit Table directly from an unexpanded tree item, I want the form to load the live columns first, so that I never edit an empty or stale schema snapshot.
16. As a MySQL user filtering a large table, I want total-row and page counts to use the same filters as the data, so that pagination describes the filtered result rather than the whole table.
17. As any database user, I want page numbers to be positive and page sizes limited to 1–500, with metadata lookup separated from data pagination, so that malformed input cannot remove limits, overflow offsets, exhaust memory, or wedge loading state.
18. As a database user with quoted or otherwise unusual legal identifiers, I want browsing, filtering, sorting, introspection, editing, DDL copy, and export to quote or bind names correctly, so that legal objects work and invalid filter/sort requests fail explicitly instead of being ignored.
19. As a user following a cross-schema foreign key, I want preview and editing to use the referenced schema and to search beyond an initial small page, so that I can find the actual referenced row rather than a same-named table or the first fifty rows only.
20. As a SQLite user inserting a row with all defaults, I want an empty editable form to produce a valid default-values insert, so that generated defaults apply without a syntax error.
21. As a user committing schema or data changes, I want every affected tab refreshed after commit and optimistic markers cleared, with any failed refresh visibly marked stale, so that committed values do not remain visually pending or appear fresh when they are not.
22. As a user browsing views and materialized views, I want read-only enforcement and only valid object actions, so that the UI does not offer edits, empty-table operations, or drop forms that use the wrong object kind.

### Query execution and result safety

23. As a query author, I want initial Run, toolbar re-run, history/saved-query Run, refresh, pagination, and any other Execution Entry Point to share the same destructive-script analysis, so that changing the entry point does not bypass confirmation.
24. As a query author, I want ad-hoc query tabs excluded from table auto-refresh timers, so that edited but unreviewed SQL can never execute on a hidden timer.
25. As a database user running EXPLAIN forms, executable comments, data-modifying CTEs, comments before statements, or unknown verbs, I want classification to recognize actual side effects and fail closed on uncertainty, so that read-looking syntax cannot hide a write.
26. As a user exporting query results, I want backend validation to accept only operations proven read-only for the selected engine and to enforce read-only execution where the engine supports it, so that export cannot become an unguarded write path even if the frontend is bypassed.
27. As a user confirming a destructive query, I want the dialog bound to the originating tab, Change Origin, exact SQL revision, and execution intent, with modal focus and cancellation semantics, so that a tab switch or keyboard shortcut cannot execute it elsewhere or execute different text.
28. As a query author, I want thrown execution, cancellation, budget, and connection errors displayed in the query workspace and previous results visibly marked stale, so that a failed run never looks successful.
29. As a user changing page/filter/sort while a fetch is running, I want the newest intent to win through cancellation or a trailing fetch, so that the grid cannot show old rows under new controls.
30. As a query user paginating results, I want page changes to perform a guarded execution and always resolve loading/cancel state, so that controls neither freeze the tab nor display a new page label over old rows.
31. As a user running a SELECT with side effects or volatile functions, I want each requested execution to run the statement only once, so that counting, metadata discovery, empty results, and fallback behavior cannot repeat side effects; if an exact total cannot be obtained safely, the UI reports it as unknown rather than rerunning the statement.
32. As a user cancelling a query, I want cancellation to stop that execution without triggering a raw fallback or silent re-run, so that cancellation is final and visible.
33. As a user exporting visible rows, I want every CSV, SQL, Markdown, JSON, and Excel writer to project only declared columns and apply format-correct quoting, so that hidden locators, unusual identifiers, and cell content cannot corrupt the output.

### Connection trust and lifecycle

34. As an SSH tunnel user, I want known-hosts verification before authentication, explicit fingerprint enrollment for an unknown host, and a hard failure on a conflicting key, so that credentials are sent only to the trusted server.
35. As an SSH user rotating a legitimate server key, I want a deliberate re-enrollment flow separate from normal authentication, so that replacing trust is possible without an unsafe inline override.
36. As a connection user, I want invalid TLS modes rejected at input/import and refused at runtime, so that an unrecognized value can never silently select plaintext.
37. As a user selecting certificate verification through an SSH tunnel, I want certificate chain and hostname verification against the original database hostname, so that loopback forwarding does not silently weaken the chosen TLS mode.
38. As a user disconnecting or closing a viewer, I want the pool, tunnel, cancellation state, and related resources closed together, so that disconnect is real and no loopback proxy remains usable.
39. As a user reconnecting an existing SSH/TLS session, I want the old working session retained until its replacement is verified, so that a failed credential or configuration change does not silently break the existing connection.
40. As a user with keychain persistence disabled, I want backup, restore, sync, and DDL-copy jobs to reuse the matching session-only credential or prompt when absent, so that those tools work without persisting or logging the password.
41. As a SQLite user testing a connection, I want a missing or invalid existing file to fail rather than be created and reported online; when I intentionally want a new database, I want creation to be a separate explicit choice.
42. As a Redis or tunneled MySQL user testing a connection, I want credentials encoded correctly and the tunnel kept alive through the version query, so that the reported status and server version reflect the actual target.
43. As a user running a slow query/export on one connection, I want unrelated connections and tabs to remain usable, so that one operation does not create application-wide head-of-line blocking; same-connection serialization remains only where the driver requires it.
44. As a user copying a connection URL with a password, I want keychain or clipboard failure reported and no password-less URL presented as successful, so that I do not unknowingly paste a degraded credential string.

### Backup, restore, files, and jobs

45. As a user copying table DDL, I want the complete statement returned verbatim without error-message truncation or secret-pattern mangling, so that the copied SQL is valid and faithful.
46. As a user receiving a server/subprocess error, I want redaction and truncation to be linear-time, bounded, and Unicode-safe, so that errors cannot panic the app, poison shared state, expose credentials, or cause a CPU/memory stall.
47. As a user running backup/restore/sync jobs, I want visible cancellation, bounded waiting, managed child ownership, process-tree termination on cancel/exit, and deterministic cleanup, so that jobs cannot hang forever or continue invisibly after I quit.
48. As a PostgreSQL user restoring or syncing with destructive replacement, I want transactional restore used whenever the dump is compatible, so that a statement failure rolls the target back rather than leaving it partially replaced.
49. As a PostgreSQL user with a dump incompatible with transactional restore, I want the incompatibility and partial-application risk explained before an explicitly confirmed non-atomic run, so that I can choose knowingly rather than discover damage afterward.
50. As a DB-sync user, I want the actual target/restore failure reported as primary when it caused the source pipe to close, so that I receive the actionable error instead of a secondary broken-pipe message.
51. As a SQLite user choosing a dump destination, I want source/destination identity checked using resolved file identity and output written to a temporary sibling before atomic publication, so that a dump can never truncate its source or replace an existing destination with a failed partial file.
52. As a SQLite user backing up a live database, I want every table read from one consistent snapshot and any metadata/row/decode failure to fail the backup, so that the dump is neither torn nor silently incomplete.
53. As a SQLite user round-tripping data, I want invalid-UTF8 TEXT, BLOBs, non-finite REAL values that SQLite can store, sequence state, `user_version`, and `application_id` represented losslessly, so that restore never silently changes values or application schema versioning; any value without a lossless representation fails the dump before publication.
54. As a MySQL user restoring a dump, I want parsing to honor MySQL string/backtick escapes and dotted quoted identifiers and processing to remain memory-bounded under the documented size limit, so that valid dumps restore correctly without multi-copy memory spikes.
55. As a MySQL user requesting a clean restore, I want only the exact objects recreated by the dump dropped, including names containing dots, so that unrelated or similarly parsed objects are not removed.
56. As a user with a broken or hanging external database tool, I want every availability/version probe bounded by the same deadline policy, so that detection, backup, and DDL operations fail visibly instead of waiting indefinitely.
57. As a user selecting a file for backup, restore, import, or export, I want Rust-brokered native selection to issue an intent-scoped, single-job File Grant that expires after five minutes and is consumed on first use, so that a renderer-supplied path alone cannot authorize file access.
58. As a user repeating a file operation, I want to select the file again for each new job, so that old grants cannot be replayed, shared across jobs, or used for a different intent.
59. As a user exporting or dumping to disk, I want write, flush, and close failures to remove the temporary output and leave any prior destination intact, and I want decode failures to reject the operation while binary and invalid-text values use lossless encodings, so that a partial or silently altered artifact cannot masquerade as complete.
60. As a user opening a SQL file through the OS, I want validation and reading bound to the same safely opened file, with non-Unicode process arguments handled without panic, so that path replacement races and unusual filenames cannot crash or redirect the open flow.
61. As a user regenerating the demo database, I want all pool, cancellation, and related per-connection state reset with it, so that later actions cannot address stale handles.

### Import, persistence, and everyday UI correctness

62. As a user importing CSV/JSON, I want source columns tracked by position, duplicate source headers handled explicitly, and duplicate target-column mappings rejected, so that values cannot be copied into the wrong targets.
63. As a user importing text identifiers, phone numbers, large integers, booleans, empty strings, nulls, or nested JSON, I want conversion driven by declared column type and JSON structure rather than numeric-looking text, so that every type-valid value retains leading zeros, precision, empty-string/null distinctions, and nested structure, while an invalid value reports its row and column without staging the batch.
64. As a user importing a malformed or oversized file, I want unbalanced quotes, inconsistent row widths, and byte-limit violations reported before staging, with byte size checked before full buffering, so that truncated or padded data is never imported silently.
65. As a user moving connections between machines, I want the app's versioned export to import successfully and legacy bare-array imports to remain supported, with every non-secret connection setting and every resolvable organization link preserved, so that round trips do not fail or silently discard database, environment, favorite, SSH, TLS, or valid folder/tag metadata.
66. As a user importing connections whose folder/tag IDs do not exist locally, I want the connections imported without those unresolved links and a per-record warning report, so that valid settings survive without violating referential integrity or blocking unrelated records.
67. As a user deleting a connection, I want confirmation copy to state that its query history, recent records, and connection-specific saved queries will also be permanently deleted, so that sensitive connection-owned data is actually removed and global saved queries survive.
68. As an existing user upgrading Gridline, I want a transactional local-store migration that enables referential enforcement on every store connection and removes pre-existing orphaned connection/tag data, so that old unreachable history and dangling joins do not remain indefinitely.
69. As a local user, I want the Gridline data directory, store, and store sidecar files restricted to the current OS account, including existing installations, so that connection metadata and query history are not exposed through permissive filesystem modes.
70. As a user whose home-screen mutation fails, I want visible per-action and per-item errors with failed selections retained, so that a locked store or keychain failure never looks like a successful or unexplained delete.
71. As a grid user copying NULL or exporting typed values, I want plain NULL copy to use an explicit uppercase NULL marker and Excel/format writers to preserve supported numeric, boolean, date, null, and escaping semantics, so that pasted and exported values are not accidentally textual or misleading.
72. As a user dropping a table with dependencies, I want one coherent acknowledgement/confirmation flow whose final action stages the drop, so that Proceed cannot dismiss both dialogs without doing anything.
73. As a user switching tabs with row detail open, I want the drawer closed on any tab, origin, page, filter, sort, or dataset change, so that another row or table is never shown under stale context; I can explicitly reopen the desired row afterward.
74. As a user relying on autocomplete and expanded table metadata, I want caches scoped by Change Origin and invalidated after relevant DDL/reconnects, so that suggestions and edit forms never leak stale columns across environments.
75. As a user opening tabs with similar names, I want deduplication to include tab kind and origin, so that a query, object, and table with the same label remain distinct.
76. As a keyboard user, I want configurable shortcuts and Commit All shortcuts suppressed while editing text or modal context makes them unsafe, with no duplicate listeners, so that typing or closing a tab cannot trigger unrelated writes.
77. As a user encountering empty, loading, expired-grant, unknown-host, migration-failure, or job-failure states, I want a specific visible state and recovery action, so that no flow fails only in logs or spins indefinitely.

### Linux, website, dependencies, and release

78. As a Fedora AppImage user encountering a black screen, I want a documented diagnostic checklist covering exact OS, session, GPU/driver, terminal output, and documented graphics workarounds, so that #62 can be reproduced and resolved from evidence.
79. As a Linux user choosing a download, I want support language and troubleshooting to describe tested behavior without claiming every distro works, so that I can select AppImage, RPM, or DEB with accurate expectations.
80. As a maintainer, I want the actual AppImage launched through its normal startup path on a headless display with window, pixel-diversity, and fatal-diagnostic assertions, so that a black or unpainted artifact is caught without treating a live process as proof of rendering.
81. As a maintainer, I want Fedora compatibility runs labeled as cross-distro coverage rather than a #62 reproduction, so that green software-rendered CI never closes the issue without reporter or equivalent-environment confirmation.
82. As a desktop user, I want a restrictive production CSP, least-privilege webview capabilities, no renderer access to unused plaintext-keyring export or unused opener powers, and local-only command exposure, so that a future renderer compromise has a constrained blast radius.
83. As a maintainer, I want Gitea to remain a code mirror without tag-triggered release builds, so that there is only one release pipeline and its controls need to be maintained only on GitHub.
84. As a release maintainer, I want release tags restricted to reviewed `prod` history with required checks and immutable release refs, so that an arbitrary or moved tag cannot receive signed release artifacts.
85. As a Homebrew user, I want release versions and cask inputs validated before rendering, so that tag metadata cannot alter the cask's Ruby structure or redirect release lookups.
86. As a release maintainer, I want third-party actions pinned to immutable revisions, workflow permissions scoped to the jobs that need them, and tag values passed as data rather than embedded query/program text, so that build dependencies and metadata receive least trust.
87. As a release maintainer, I want PostgreSQL and MariaDB source inputs pinned and cryptographically verified and packaged tool manifests checked before upload, so that bundled executables have an auditable integrity chain.
88. As a macOS user, I want release signing, notarization, stapling, and artifact verification to fail the build when credentials or verification are absent, so that an ad-hoc artifact cannot be uploaded under a claim of Developer-ID notarization.
89. As a maintainer, I want all patched JavaScript/Rust vulnerabilities and reachable unsound or yanked dependencies remediated, with each no-fix or not-applicable warning assigned an owner, rationale, and review date, so that the release contains no unreviewed advisory and CI fails on new ones.
90. As a maintainer, I want automated dependency update/audit coverage and cross-platform compile/test checks before release, so that platform divergence and known advisories are discovered during the cycle rather than at tag time.
91. As a maintainer preparing a release, I want the root manifest included in version consistency checks alongside desktop, backend, website, README, and changelog versions, so that no package reports a stale release.
92. As a website visitor, I want macOS architecture and Linux package choices presented explicitly when they cannot be detected reliably, so that Intel Macs do not receive Apple Silicon-only downloads and Linux users are not defaulted to RPM regardless of distro.
93. As a maintainer publishing the comprehensive cycle, I want all focused pull requests, regression tests, targeted E2E, live-database cases, dependency exceptions, release checks, and documentation completed before tagging, so that the release gate represents the whole destination rather than a green unit-test subset.

### Object-definition fidelity

94. As a PostgreSQL object editor, I want routine and trigger definitions containing quotes, dollar delimiters, semicolons, or unusual identifiers to round-trip unambiguously, so that object editing neither rejects valid definitions nor changes their meaning.

## Constraints & Non-Negotiables

- Never log, persist, or expose database passwords, SSH passwords, private keys, passphrases, session secrets, or secret-bearing URLs outside the approved keychain/session flow. Passwords must not appear in process arguments.
- The destructive-query dialog is a UX safety net, not authorization. Database permissions remain authoritative; backend read-only checks are still mandatory for operations that promise read-only behavior.
- Unknown SQL, TLS modes, host-key conflicts, unsafe rebuilds, invalid file grants, and uncertain file identity fail closed. No fail-closed path may be weakened to make a test pass.
- Do not introduce Electron, a Node.js server, a new production database driver, or a runtime container dependency. Do not implement PostgreSQL dump-format parsers; continue using resolved external tools.
- Large results remain virtualized and page-bounded. Streaming exports and dumps must not materialize complete results. Existing import limits of 100,000 rows and 100 MB remain, with byte size enforced before full buffering.
- Commit All provides per-change atomicity and explicit partial success, not universal queue-wide atomicity. MySQL DDL and explicitly accepted non-atomic restores must state their actual guarantees.
- Pending queues remain session state; persisting uncommitted work across application restarts is not introduced by this cycle. General full-row optimistic versioning is not introduced; original-row predicates for physical-locator operations are a targeted wrong-row safeguard.
- No unconditional WebKit/graphics workaround is shipped for #62 without evidence. Generic CI success does not authorize closing #62.
- All remediation lands through focused pull requests into `prod`; no direct trunk commits. No release is tagged until the complete release gate passes.
- Pure lint/style/refactor-only cleanup is excluded unless required by a behavioral fix. Existing public behavior not implicated by the audit remains compatible.
- Unfixed vulnerability details, exploit steps, and sensitive evidence must not appear in public issues, pull requests, release notes, or this specification.
- macOS signing/notarization claims, Linux support claims, dependency status, and test claims must describe verified reality rather than aspirations.

## Boundaries

### In scope

- Every confirmed behavioral, security, reliability, data-integrity, UI-correctness, persistence, tooling, dependency, and release finding from the baseline audit, including low-severity user-facing findings.
- The additional connection export/import envelope mismatch found during verification.
- Targeted regression, integration, UI E2E, packaged AppImage startup/paint, migration, release, and dependency-audit coverage needed to prove the fixes.
- Issue #62 diagnostics, truthful documentation, compatibility coverage, and follow-up through reporter/equivalent-environment confirmation.
- Private advisory handling for security-sensitive findings and public-safe acceptance requirements.
- Repository settings required to enforce the release-ref and required-check guarantees.

### Out of scope

- New database engines, Redis browsing, visual query building, AI features, onboarding, session restoration, or other roadmap features unrelated to the audit.
- A universal all-or-nothing Commit All transaction, persistent pending queues across restarts, or full-row optimistic versioning.
- Pure style cleanup or a zero-warning Clippy campaign unrelated to behavior.
- Treating unconfirmed platform/live-service hypotheses as fixed without reproduction.
- A blanket production graphics-environment override or a claim that headless Fedora/Ubuntu CI reproduces the reporter's hardware.
- A full cross-platform E2E suite for every screen; E2E is targeted to the named critical flows.
- Publishing Gitea releases, adding a second release channel, weakening the private disclosure policy, or disclosing sensitive remediation details publicly.
- Universal atomic restore for engines/dumps that cannot provide it; those cases require explicit risk confirmation instead.
- Removing all dependency-audit warnings regardless of feasibility. The requirement is patched fixes plus governed, reviewable exceptions.

## Implementation Decisions

### Delivery and ownership

- The comprehensive cycle is one release gate but not one monolithic diff. Focused pull requests cover data editing, query execution, connection trust/lifecycle, tool jobs/file authorization, persistence/import/UI correctness, and Linux/release/dependencies.
- Existing Tauri commands remain thin; database behavior belongs to the database services, persistence behavior to the local store, and interaction state to the viewer stores/components.
- The frontend owns editor/tab interaction state. Origin-scoped pending work is owned by the viewer state. The backend remains authoritative for target validation, SQL read-only enforcement, File Grants, process ownership, and filesystem effects.
- No production automation plugin is added solely for tests. Desktop UI E2E uses Tauri's supported WebDriver path on a non-AppImage binary; AppImage verification exercises the packaged artifact through its normal launcher.

### Data and schema editing

- Row Identity contains all primary-key columns in stable metadata order. A physical locator is used only when no primary key exists and is never part of user-visible/exported columns.
- Every queued item carries an immutable Change Origin. The active origin exposes only its own pending queue. Commit resolves and validates the origin rather than trusting only the currently active connection identifier.
- Updates include the original value of the edited column as an optimistic predicate. Update/delete execution runs inside a transaction and commits only when exactly one intended row matches; zero/multiple matches roll back. When a physical locator is used, original row values also guard against a moved or reused locator.
- Selection, row detail, and destructive confirmation are bound to stable identity and origin rather than array indices or whichever tab happens to be active. Selection and row detail clear on every tab, origin, page, filter, sort, or dataset change.
- Column Identity survives reorder. Rename is an explicit intent; add/drop/reorder operations never invoke positional rename heuristics. SQLite rebuild copy lists map old names to new positions explicitly. Routine and trigger definitions use unambiguous body/identifier quoting and reject definitions that cannot be represented faithfully.
- SQLite rebuild is one transaction and reconstructs every supported schema feature. Unsupported shapes are rejected before the first mutating statement.
- Metadata retrieval is separate from paginated row retrieval. Pagination accepts positive pages and page sizes from 1 through 500; query pagination goes through the guarded Execution Entry Point. MySQL total counts use exactly the same filters as their data query, and an empty SQLite insert uses the native default-values operation.
- Table editing loads the live column/schema snapshot when the editor opens, independent of whether the tree item was previously expanded.
- Filter/sort/introspection uses bound values and correct dialect identifier quoting for all legal names. Invalid rules return errors rather than disappearing.
- Foreign-key metadata retains referenced schema. FK option search is server-side and not capped to the first fifty referenced rows.

### SQL execution

- A shared behavioral classification corpus covers TypeScript analysis and Rust splitting/validation, including comments, executable comments, CTEs, EXPLAIN forms, dollar/backtick quoting, delimiter handling, unknown verbs, and multi-statement scripts.
- The frontend uses analysis for confirmation; the backend independently enforces the read-only contract for export. Export uses an allowlist of engine-appropriate read-only operations, with a read-only cursor transaction for PostgreSQL, a read-only transaction for MySQL, and query-only enforcement for SQLite.
- Ad-hoc query tabs do not participate in table auto-refresh. Re-run, history/saved run, pagination, and refresh all use the same guarded request path.
- A destructive request captures origin, tab, exact SQL revision, and intent. Confirmation is valid only for that unchanged request and is cancelled by tab/origin/SQL changes.
- Query execution occurs once per accepted run/page request. Exact totals are optional when obtaining one would repeat side effects. Empty results and wrapping failures cannot trigger a second execution of a side-effecting statement.
- Request generations or cancellation ensure the latest page/filter/sort intent wins. Errors and cancellation resolve loading state, produce a visible query-workspace error, and mark previous results stale.

### Connections and secrets

- SSH Host Trust follows ADR 0001: known-hosts matching, explicit first-use fingerprint enrollment, persistent non-secret trust records, and hard failure on mismatch with separate re-enrollment.
- TLS mode parsing accepts only supported values. Unknown nonempty values are errors. Through SSH tunnels, verification uses the original database hostname rather than silently downgrading to encryption-only.
- Pool/tunnel/cancellation resources have one lifecycle. Disconnect closes all of them. Reconnect retains the old working session until the replacement succeeds.
- Session-only credentials live in backend memory keyed by Change Origin and are available to tool jobs; absent credentials trigger a prompt. They are never written to the local store or logs.
- Long operations clone/acquire the required handle and release the global pool registry before waiting. Only the minimum same-connection serialization remains.
- SQLite Test never creates a missing file. New-database creation is a distinct explicit action. Redis and MySQL probes preserve credential correctness and tunnel lifetime.

### Tool jobs and file authorization

- Native open/save selection is brokered in Rust. It returns an intent-scoped, single-job File Grant plus display metadata. A grant expires five minutes after selection and is consumed on first use. Custom file-touching commands require and consume a matching grant; raw paths are not authorization.
- File identity is resolved safely before use. For output, a temporary sibling is written, flushed, and closed successfully before atomic publication. Source and destination identity must differ, and an existing destination survives failed output.
- Managed job state owns child processes, cancellation, connection/lock/inactivity deadlines, progress, bounded diagnostics, and exit cleanup. A continuously progressing large backup is not killed by an arbitrary total-duration limit. All tool probes use bounded execution.
- Error redaction is a bounded single-pass operation and all truncation is Unicode-safe. DDL is payload, not an error, and is returned verbatim.
- PostgreSQL restore/sync uses transactional execution when compatible. Otherwise the user must explicitly approve a clearly identified non-atomic operation. MySQL's non-atomic DDL limitation remains visible. When target restore failure closes the source pipe, the target error is primary and the resulting source broken-pipe diagnostic is secondary.
- SQLite dump reads one snapshot, propagates every row/metadata error, and uses lossless representations or explicit rejection for unusual values. Schema-affecting metadata needed for round trips is preserved without blindly replaying connection-local PRAGMA settings.
- MySQL restore remains native, stops at the first error with statement position, handles dialect escapes/quoted dots, and streams under its existing size limit. Its clean planner drops only objects recreated by the dump and preserves quoted object names containing dots.
- SQL open-with validates and reads the same opened file, retains its existing size/extension/no-auto-execution guarantees, and handles OS arguments without Unicode panics.
- Demo regeneration removes the pool, cancellation, and related per-origin state for the old demo handle before the replacement becomes active.

### Persistence, import, and UI

- Local-store connections enable foreign-key enforcement consistently. A transactional migration removes orphaned history, saved queries, recents, and tag/folder joins while preserving global saved queries. Deletion copy explicitly describes Connection-owned Data removal.
- Store directory/file permissions are restricted to the current account on platforms with Unix-style modes, including existing files and sidecars; platform-equivalent ACL behavior is retained elsewhere.
- Connection transfer reads both the existing versioned envelope and legacy bare arrays. It writes a versioned envelope, round-trips all non-secret settings, regenerates local record identity as needed, and drops unresolved folder/tag links with warnings.
- Data import uses positional source-column identities, forbids duplicate targets, validates malformed CSV/JSON before staging, and performs column-type-driven conversion without lossy number coercion or nested-object stringification.
- Home mutations surface errors and retain failed selections. Connection URL copy never silently downgrades after keychain/clipboard failure.
- Caches include origin and invalidate after relevant DDL/reconnects. Tab identity includes kind and origin. Every affected tab refreshes after commit and clears its optimistic markers; a failed refresh is visibly stale rather than presented as fresh.
- Format writers project declared columns, quote identifiers/cells correctly, preserve supported Excel types, and use explicit NULL semantics.
- Dialogs, shortcuts, row detail, table dependency acknowledgement, view actions, and async loading states expose one coherent safe action path. Views and materialized views remain read-only, and object operations use the correct object kind. Unknown-host, expired-grant, migration-failure, empty, loading, and job-failure states have visible recovery actions; no failure is logged without a user-visible outcome.

### Linux, dependencies, and release

- #62 documentation requests exact Fedora release, session type, GPU/driver, terminal diagnostics, and results from Tauri's documented workaround ladder. Support copy states tested expectations rather than universal compatibility.
- AppImage smoke uses the normal AppRun/extract-and-run path, a bounded headless software-rendered display, mapped-window/geometry checks, pixel diversity/bright-content checks appropriate to Gridline's dark theme, and fatal-log signatures. The pristine default-environment run is informational; the blocking software-rendered compatibility run may use documented graphics flags inside the test harness only. A FUSE-mount problem is reported separately from application rendering. The lane runs nightly, manually, and on release artifacts; targeted UI E2E runs on every pull request that changes desktop frontend, viewer/SQL state, Tauri command behavior, or their dependencies.
- Fedora scheduled/manual runs are compatibility coverage only. #62 remains open until reporter/equivalent-environment confirmation.
- Production CSP permits only required local assets, workers, inline Monaco styling, and Tauri IPC. No unnecessary remote network access, renderer plaintext-keyring export, or unused opener capability remains. Packaged-build tests verify CSP behavior because development mode is not sufficient evidence.
- The Gitea release workflow is retired; mirroring remains. GitHub release refs must be protected, immutable, reachable from reviewed `prod`, and gated on required checks.
- Third-party actions use immutable revisions. Workflow tokens receive job-level least privilege. Release metadata is validated and passed as data to query/template tooling, and secrets reach scripts through environment variables rather than expression interpolation.
- Downloaded/built database tools have pinned, verified inputs and checked output manifests before artifacts are uploaded.
- Missing Apple signing/notarization credentials or failed signature/notarization/staple verification fails the release rather than producing a purported signed artifact.
- Patched dependency vulnerabilities and reachable unsound/yanked packages are upgraded. Every remaining no-fix/not-applicable warning has a written owner, rationale, and review date; CI fails on unreviewed additions. Both root and standalone website lockfiles are regenerated by the established workspace procedure when website dependencies change.
- Dependency update automation, advisory scanning, cross-platform compile/test coverage, version consistency including the root manifest, and website production build checks join the release gate.
- Website download calls to action offer explicit macOS architecture and Linux package choices whenever reliable detection is unavailable.

## Testing Decisions

### Approved seams

1. **Viewer interaction contract**
   - Public Zustand actions and React viewer behavior, replacing only the typed Tauri IPC boundary.
   - **Catches:** queue origin, selection lifecycle, guard routing, dialog binding, cache identity, loading/error states, and import mapping behavior.
   - **Misses:** real SQL execution and native webview behavior; covered by the change-application and built-product seams.

2. **Change-application command/service**
   - Public execute-change behavior exercised headlessly against temporary SQLite and opt-in live PostgreSQL/MySQL.
   - **Catches:** composite-key identity, original-value checks, zero/multiple-match rollback, default inserts, filtered edits, rebuild atomicity, and metadata preservation.
   - **Misses:** frontend staging and navigation; covered by viewer interaction and E2E.

3. **SQL safety contract**
   - Public script analysis plus backend export/execution validation, with shared cross-language behavioral vectors.
   - **Catches:** comments, executable comments, CTEs, EXPLAIN forms, delimiter/quote handling, multi-statement drift, unknown verbs, and non-read-only export.
   - **Misses:** undocumented vendor grammar and live engine differences; targeted live integration supplies those cases.

4. **Connection trust/lifecycle commands**
   - Test/connect/disconnect behavior with a fake SSH transport and opt-in live servers.
   - **Catches:** known/unknown/mismatched host policy, TLS decisions, tunnel/pool cleanup, reconnect behavior, and session-credential use.
   - **Misses:** real OS keychain dialogs, hardware/network variability, and secret-service integration; platform tests and manual acceptance cover them.

5. **Tool-job commands/services**
   - Headless backup/restore/sync/export behavior using temporary files and real or controlled external tools.
   - **Catches:** snapshots, lossless output, error precedence, cancellation, timeouts, lock contention, source/destination protection, and partial-file cleanup.
   - **Misses:** native-picker authorization and some OS process-tree differences; File Grant tests and platform CI cover those.

6. **File Grant command boundary**
   - Rust-brokered picker with an injectable picker and public grant-consuming commands.
   - **Catches:** raw-path rejection, wrong intent, replay, expiry, cross-job use, and grant/operation mismatch.
   - **Misses:** the visual OS dialog itself; a manual/platform smoke confirms native presentation.

7. **Persistence and connection transfer**
   - Public store CRUD/migrations and connection import/export round trips.
   - **Catches:** orphan cleanup, cascades, global-query preservation, file permissions, envelope compatibility, non-secret field fidelity, and unresolved-link warnings.
   - **Misses:** arbitrary real-user stores; representative legacy/corrupt/pre-fix fixtures are required.

8. **Built-product and release artifacts**
   - Targeted Tauri WebDriver flows on a non-AppImage binary, AppImage window/pixel/fatal-log smoke, release workflow/script checks, and website production build.
   - **Catches:** integrated critical flows, CSP/asset behavior, packaged startup, release metadata/tool verification, and download-link correctness.
   - **Misses:** the reporter's hardware/session and cannot replace signing/notarization/tag checks on the actual release.

### What makes a good test here

- Exercise the highest reasonable public interface and assert observable behavior, not private helper calls or implementation-specific mocks.
- Calculate expected rows, keys, schema, files, and statuses independently from the operation under test. Do not derive expectations using the same generator being tested.
- Use regression-first cases for composite keys, cross-origin queues, add-in-the-middle versus rename, SQLite reorder plus metadata, every Execution Entry Point, malformed imports, unusual identifiers, Unicode boundaries, and failed writes.
- Mock only external boundaries such as IPC, a picker, an SSH transport, or a controlled child process. Use real temporary SQLite databases and opt-in live PostgreSQL/MySQL for behavior those engines own.
- Assert the absence of unintended effects after failure: unchanged sibling rows, intact source/destination files, preserved old sessions, no orphan processes, no lingering tunnels, and no partial schema.
- Keep security fixtures non-secret and synthetic. Tests must not print credentials, sensitive query contents, or real user-store contents.

### Prior art in this repository

- The auto-seeded demo SQLite database already includes composite-PK, no-PK, JSON, BLOB, view, and pagination cases suitable for regression and E2E fixtures.
- Backup/restore/sync already expose headless-testable cores and behavioral regression tests.
- SQL splitting already has shared cross-language vectors; frontend analysis and backend validation must extend rather than diverge from that practice.
- Baseline verification after frozen-lockfile installation: 1,236 frontend tests passed across 136 files; 508 Rust tests passed and 31 were ignored; desktop and website production builds passed.
- Ignored live PostgreSQL/MySQL/SSH/keychain tests are explicit coverage gaps. They must be run in an approved live matrix for affected workstreams rather than counted as passing coverage.
- Existing PR CI uses read-only permissions and frozen lockfiles; those controls remain while audit, E2E, platform, and release checks are added.

### E2E

**OPTED-IN.**

Required critical flows:
- Composite-key edit and delete, proving sibling rows remain unchanged.
- Origin-scoped queue navigation across two targets, proving mismatched commit is impossible and returning restores the correct pending work.
- Destructive query edit followed by toolbar re-run, proving confirmation is required and confirmation remains bound to the exact request.
- SQLite rebuild/reorder, proving values and supported schema metadata survive atomically.
- Packaged AppImage startup, mapped window, non-black painted content, and absence of known-fatal renderer diagnostics.

Targeted desktop UI E2E runs on every pull request that changes desktop frontend, viewer/SQL state, Tauri command behavior, or their dependencies, using a non-AppImage binary. AppImage smoke runs nightly, manually, and as a mandatory release-artifact check. Fedora scheduled/manual runs are compatibility nets, not proof of #62 resolution.

## Migration & Rollback

- Local-store migration is transactional, idempotent, and tested from a representative pre-fix store containing valid rows and every orphan kind. Foreign-key enforcement is enabled for every opened store connection, not only during migration.
- Successful migration intentionally deletes unreachable Connection-owned Data and dangling organization joins; global saved queries and valid rows remain unchanged. This intentional deletion is not presented as recoverable by an application downgrade.
- New SSH Host Trust metadata is additive and contains no credentials. Existing known-hosts entries remain authoritative where present; first-use records can be deliberately re-enrolled.
- Store permission tightening applies to existing installations as well as new ones and fails visibly if permissions cannot be secured; it does not silently continue with a known permissive store.
- Connection import accepts existing versioned exports and legacy bare arrays. Export remains versioned and excludes passwords/SSH secrets. No migration moves session credentials into persistent storage.
- No managed remote database schema migration is introduced. Database mutations remain user-reviewed changes with the per-change and non-atomic guarantees stated above.
- Failed local migrations leave the prior store unchanged. Failed dependency/workstream pull requests are reverted or corrected independently without requiring a monolithic cycle rollback.
- A release is not tagged until the full checklist passes. If a released regression nevertheless requires rollback, revert the focused pull request and publish a corrective release; do not rewrite or move an existing public release tag.
- #62 remains open across documentation/CI merges and is closed only after environment-specific confirmation, regardless of other release rollback decisions.

## Domain Model

The glossary now defines **Changes Queue**, **Change Origin**, **Commit All**, **Row Identity**, **Column Identity**, **Connection-owned Data**, **Execution Entry Point**, **File Grant**, and **SSH Host Trust**, with prohibited near-synonyms and relationships.

Resolved ambiguities include current versus originating connection, physical locator versus complete composite key, positional column matching versus identity, and whole-queue atomicity versus per-change atomicity.

**ADR 0001: Verify SSH host trust with known hosts and explicit first-use enrollment** records the persistent trust-model trade-off. Other decisions are reversible implementation or product-policy choices and do not require ADRs.

## Open Questions

- **#62 root cause and environment-specific resolution:** owned by the reporter together with the maintainer. Required before closing #62 or shipping any unconditional graphics override; not required before merging diagnostics, truthful documentation, or generic compatibility coverage.
- **Private advisory references for security-sensitive findings:** owned by the maintainer. Required before opening detailed public security issues or publicly describing exploit mechanics; this public-safe specification does not contain them.
- **No-fix/not-applicable dependency exceptions:** owned by the maintainer, with each rationale and review date recorded in the dependency workstream. Required before the release gate can pass; new unreviewed advisories remain blocking.
- **Live PostgreSQL/MySQL/SSH/keychain validation environments and credentials:** owned by the maintainer. Required before marking live-only acceptance cases verified; synthetic/unit tests cannot substitute for them.
- **Linux build-runner baseline migration:** owned by the release maintainer. Must be settled before the hosted Ubuntu 22.04 image is retired or the Linux build baseline changes; any migration must preserve the oldest supported glibc/distribution contract and rerun AppImage/Fedora compatibility checks.
- **Final release version and release-note wording:** owned by the maintainer. Decided after all focused pull requests merge and before tagging; version choice does not alter the behavioral acceptance requirements in this specification.
