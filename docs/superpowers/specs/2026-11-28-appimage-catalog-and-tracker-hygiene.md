# AppImage Catalog Listing and Tracker Hygiene

**Baseline:** 69312c8a76fb416292706c468710ad039c57b9e2   **Branch:** docs/appimage-catalog-and-tracker-hygiene   **Date:** 2026-11-28

## Problem Statement

Gridline is not in the AppImage community catalog. A pull request proposing it (`AppImage/appimage.github.io#6518`) has been open and red since 2026-09-29, and nobody has established why — so the project has neither a listing nor a decision, only a stale failing PR that a visitor can read as "this app does not work".

The tracker has the reciprocal problem. Five issues are open and every one of them is stalled:

- **#62** reports a black window on Fedora. It was opened a week ago with `Fedora 4x` as the OS version and the template's `(paste logs here)` placeholder still in the logs section. It has **zero comments** — the diagnostic checklist written for it in a previous cycle was merged into the README and never posted to the reporter, so a user who did exactly what the issue template asked was told nothing and never returned.
- **#115** reports that creating a SQLite database is the one file operation in the app that still accepts a path named by the webview.
- **#116** reports that the settings store accepts any key and any value, with validation scattered across three layers that have already drifted.
- **#117** reports that the built-product E2E harness cannot be run twice into the same artifacts directory, which makes local reproduction of a CI failure fail for a reason unrelated to the failure.
- **#119** reports a flaky loopback-listener test and blames a liveness probe that ignores zombies. The loopback tests contain no child processes.

Three Dependabot major-version PRs are also red. They are not part of this problem and this cycle deliberately does not touch them.

## Solution

Make the catalog listing an outcome rather than an open question, and close the tracker down to the one issue that genuinely cannot be closed from here.

For the catalog, the diagnosis is already complete and requires no code change. The failing asset was **v0.8.1**, whose `AppRun.wrapped` was packaged with mode `0770 root:root` — the sole file in the entire payload without world-execute — because Tauri 2.11.5's bundler wrote the cached launcher that way. `AppRun` is a script whose twelfth line is `exec "$this_dir"/AppRun.wrapped "$@"`, which is exactly where the catalog's log dies. **v0.9.2**, built with Tauri 2.12.7, is `0755` throughout. The entry names the repository rather than a pinned asset, so re-running the catalog's test evaluates the current release. The resolution is therefore to re-run that test and let its own merge rule apply.

For the tracker, four of the five issues are answerable with small, independent changes, and the fifth is answerable only with a reply. Gridline will state, for the first time in public, what evidence #62 needs and that nothing has been fixed — rather than leaving the reporter to infer silence as dismissal.

Nothing in this cycle claims that #62 is fixed, and nothing claims the SQLite file-access class is closed. #115 closes database *creation*; opening an *existing* SQLite file still accepts a renderer-supplied path, and that is a separate decision with a separate owner.

## User Stories

### Catalog listing

1. As a Linux user browsing the AppImage catalog, I want Gridline to appear there with a working entry, so that I can find it where I already look for AppImage software.
2. As a maintainer, I want the catalog PR resolved by re-running its test against the current release, so that a defect already fixed in v0.9.2 is not "fixed" a second time by editing code that is no longer wrong.
3. As a maintainer, I want the reason for the original failure recorded in our own repository, so that a future reader does not have to re-derive it from a stranger's CI log.
4. As a maintainer, I want the repository to describe the listing as third-party indexing of one verified build, so that nobody later reads it as per-distribution certification.
5. As a reader of our roadmap, I want unreleased-but-merged work to have a home other than a "Shipped" section, so that neither this file nor the changelog has to lie about what has been released.

### Issue #62 — black window on Fedora

6. As the reporter of #62, I want a reply that names exactly which facts are missing and how to collect each one, so that I can supply evidence instead of guessing what was wanted.
7. As the reporter of #62, I want the reply to say plainly that no fix has shipped, so that I am not told a bug is fixed when it is not.
8. As the reporter of #62, I want the reply to say plainly that a green CI run proves nothing about my machine, so that I understand why the issue stays open despite passing builds.
9. As a future maintainer, I want #62 to stay open until the reporter or an equivalent Fedora environment confirms a result, so that a closed issue never stands in for an unverified fix.
10. As a maintainer, I want the reply to be one message a human reads, not a link to a checklist three sections deep in a README, so that the person who filed the bug has the same information we do.

### #115 — SQLite database creation authorisation

11. As a user creating a new SQLite database, I want to choose the destination in the operating system's own save dialog, so that the destination comes from a deliberate system selection.
12. As a user creating a new SQLite database, I want the result to be a real database rather than an empty placeholder, so that connecting to it works immediately.
13. As a user, I want creation to refuse a destination that already exists, so that creating a database can never truncate or replace one.
14. As a user, I want cancelling the dialog to create nothing and report nothing, so that an abandoned action leaves no side effect.
15. As a security reviewer, I want the create command to be structurally unable to honour a path named by the webview, so that a compromised or buggy renderer cannot create files at destinations of its choosing.
16. As a user whose selection expired while I was away from the dialog, I want a message naming the expiry and a way to pick again, so that I am not shown a bare failure.
17. As a user, I want a selection presented for the wrong operation, or one already used, to be refused by name, so that the failure explains itself.
18. As a user, I want the form to display the created path and let me continue to a connection, so that creating the database completes the task I started.
19. As a reviewer, I want the change to state that opening an *existing* SQLite file still accepts a renderer-supplied path, so that a closed issue is not mistaken for a closed class of defect.

### #116 — settings validation

20. As any caller, I want a setting written through the store to be validated at the store, so that a future path which bypasses the IPC layer cannot persist an invalid value.
21. As a user, I want an out-of-range or malformed value refused with the key name and the valid range, so that the message tells me what to correct.
22. As a user, I want an unrecognised settings key refused rather than silently stored, so that the store cannot accumulate keys nothing reads.
23. As a user importing a settings file, I want the entire file validated before anything is applied, so that a bad file never leaves my settings half-changed.
24. As a user, I want values read back to be within their documented ranges even when an older build wrote them, so that the interface never receives an impossible value.
25. As a user, I want every setting the interface offers to be governed by the same rules the interface enforces, so that the two cannot drift.
26. As a developer, I want one declared validator table instead of three layers of ad-hoc clamping, so that adding a setting means adding one entry.

### #117 — E2E re-run

27. As a developer re-running a flow locally into the same artifacts directory, I want the second run to behave like the first, so that reproducing a CI failure does not require remembering to delete a directory first.
28. As a developer, I want the app-data directory to hold nothing from a previous run, so that the demo database and local store are always created by the application itself.
29. As a developer, I want the harness to delete only the directories it owns and never the artifacts directory itself, so that pointing it at a directory containing other things is not destructive.
30. As a developer, I want a fixture to survive a directory reused after a killed run, so that an interrupted run does not wedge the next one.
31. As a reviewer, I want the documented pristine-app-data guarantee to be true by construction rather than by convention, so that documentation and behaviour cannot drift apart again.

### #119 — process liveness

32. As a maintainer, I want the process-liveness probe to distinguish a zombie from a live process, so that a cancellation test stops reporting "still alive" for a process that has already exited.
33. As a maintainer, I want a single liveness helper instead of two verbatim copies, so that a fix applies everywhere by existing once.
34. As a maintainer, I want the helper's behaviour to be defined on Windows as well, so that the cross-platform matrix is not left with the old semantics.
35. As a maintainer, I want the issue's stated cause corrected when it closes, so that the record does not teach the wrong lesson about which helper was broken.
36. As a maintainer, I want the port-reachability helper left unchanged, so that code with no evidence against it is not modified in the name of a fix.

## Constraints & Non-Negotiables

- **A renderer-supplied path authorises nothing.** After this cycle, no command that creates, replaces, or writes a database file may accept a path from the webview. This is the rule #115 exists to repair.
- **The catalog entry carries no support promise.** Neither the README nor the landing page may present the catalog as a download route or as evidence of per-distribution support. Only `ROADMAP.md` records it, described as third-party indexing.
- **Issue #62's closure criteria do not move.** It closes only on confirmation from the reporter or from an equivalent Fedora environment reproducing the same behaviour. A green build, a passing AppImage smoke run, or a workaround that happens to work is not confirmation. No unconditional graphics workaround is added.
- **Fail closed.** An unrecognised grant, key, intent, or value is an error naming what was wrong — never a silent fallback to a raw path, a default, or plaintext.
- **The build is not modified.** No change to `tauri.conf.json`, the AppImage packaging, the CSP, the capability set, or `appimage-smoke.yml`. The catalog failure is a historical artifact, not a current build defect, and this cycle does not touch the build to "fix" it.
- **`version.test.ts` stays green without being modified.** It asserts that the newest changelog entry and the newest `## ✅ Shipped (x.y.z)` roadmap heading both equal the canonical manifest version. A changelog entry or a version-stamped roadmap section for unreleased work would fail it, so neither is added here.
- **No version bump, no tag, no release.** This cycle ends at merged-into-`prod`.
- **The dependency majors are out of scope.** Dependabot PRs #146, #147 and #148 stay untouched; they need their own cycle and their own gate.
- **No secrets in logs.** The new grant-based flow must not log the selected path at a level that reaches a log file, mirroring the existing rule for connection strings.
- **Deletion stays inside the artifacts directory.** The harness may remove only the subdirectories it created, resolved strictly beneath the artifacts root, and must refuse rather than proceed if resolution would escape it.

## Boundaries

**In scope**

- Commenting `/retest` on `AppImage/appimage.github.io#6518` and reporting the outcome.
- Posting one diagnostic comment on Gridline issue #62.
- Issue #115: SQLite database creation consumes a File Grant.
- Issue #116: one validator table governing every settings write and read-back.
- Issue #117: the E2E harness owns a genuinely pristine app-data directory, and its fixtures become re-runnable.
- Issue #119: one zombie-aware process-liveness helper with defined Windows behaviour.
- `ROADMAP.md` gains an `In development` section recording the merged-unreleased work and the listing.
- `GLOSSARY.md` gains the resolved terms; `docs/adr/0003-strict-settings-validation.md` records the settings decision.
- Closing #115, #116, #117 and #119 through the two pull requests that fix them.

**Out of scope**

- Closing #62, or any claim that it is fixed.
- Opening an *existing* SQLite database at a renderer-supplied path (see Open Questions).
- Any change to the AppImage build, bundler version, packaging, or smoke lane.
- Any change to README support copy, the landing page, or the changelog.
- Dependabot PRs #146–#148 and the Rust API migrations they require.
- New built-product E2E flows.
- Editing #119's title or body on GitHub; its corrected cause travels in the closing comment instead, so no external edit beyond the two comments named above is required.
- Reaching out to the #62 reporter by any channel other than the issue comment.

## Implementation Decisions

### Catalog listing

No code changes. The action is the single comment `/retest` on PR #6518, which that repository's own workflow implements by closing and reopening the PR so `Test` re-runs under current workflows. A passing run is auto-squash-merged by their `merge-labeled` automation — this is deliberately not a dry run, and it is chosen knowingly: the defect is diagnosed, fixed in the current release, and the entry is a one-line repository URL from which the catalog generates everything else.

The listing's permanent rollback is one-way and worth recording before it is used: `/remove` deletes the entry and labels the application `opt-out`, after which auto-discovery never proposes it again. There is no "un-opt-out".

### Issue #62 — one reply, and no claim

A single comment is posted to the issue. It restates the diagnostic checklist from the README in the comment itself rather than linking to it, because the person who filed the report should not have to navigate a documentation tree to learn what was asked of them. It names the specific missing facts — the exact Fedora release, `XDG_SESSION_TYPE` and desktop environment, GPU and driver, the terminal output of a direct run, and the result of each documented workaround — and says explicitly that no fix has shipped and that a passing CI run is not evidence about the reporter's machine.

The comment commits to nothing it cannot keep: it does not promise a fix date, and it does not request the issue be closed. #62 stays open and assigned as it is.

### #115 — creation consumes a Write grant

`create_sqlite_database` stops taking a path and starts taking a grant identifier. The webview no longer opens a save dialog itself; it requests one through the existing grant-selector command, receives only an opaque identifier, and hands that identifier to the create command. The backend mints the grant during the native dialog, consumes it at creation time, and resolves the path itself.

This reuses the existing **`Write`** intent rather than adding a new one. `FileIntent` deliberately has exactly two variants and five other save flows already share `Write`; introducing a first exception would trade a coarse, auditable boundary for a finer one nobody else needs.

The existing refusal semantics are preserved unchanged: an empty path, an existing file, or a missing parent directory still fails before anything is created, and the file is still initialised with a real database header. What changes is only who is allowed to name the destination.

Cancellation, expiry, wrong intent, and reuse each surface as their own message with a recovery action, matching the vocabulary the other grant-consuming flows already use rather than inventing new wording.

### #116 — one validator table at the store

A single declared table maps each known settings key to its validity rule. The store consults it on **write**, on **bulk import**, and on **read-back**; the IPC-layer check that today special-cases one key is deleted in favour of the table, and the ad-hoc clamps currently applied only during read-back are replaced by it.

The decision that needs justifying is what happens to a key the table does not know: it is **refused**, not skipped, and a settings import validates the entire file before applying any of it. This is fail-closed at the cost of forward compatibility between versions, and it is recorded in [ADR 0003](../../adr/0003-strict-settings-validation.md).

Read-back never errors. A value written by an older build that no longer satisfies its rule is normalised to a valid one rather than refused, so a stricter write path can never make existing installations unreadable.

### #117 — the harness owns the pristine guarantee

Before launch, the harness removes the application-data locations it configures — `app-data` and `home` on Unix, the corresponding local-app-data location on Windows — from the artifacts directory — never the artifacts directory itself — and only after resolving them strictly beneath it. This makes the documented pristine-app-data guarantee true by construction instead of by convention, which is the actual defect: three separate places asserted the guarantee and nothing enforced it.

Fixtures additionally gain create-if-missing and drop-if-exists handling, so a directory reused after a killed run, or one deliberately preserved for debugging, cannot wedge a flow. The guarantee and the fixture hygiene are complementary; neither alone covers the other's failure mode.

The README sentence asserting the guarantee is corrected only if its wording still overclaims after the change — the claim becomes true, so it may not need editing at all.

### #119 — one liveness predicate, and an honest record

The defect is `kill(pid, 0)`, which succeeds for a zombie as readily as for a running process. The two verbatim copies of that helper collapse into one shared test-support helper that inspects the process's actual state on Unix and uses the platform's own query on Windows, so the cross-platform matrix is not silently left with the old semantics.

The distinction the helper must make is **exited-but-unreaped** versus **running** — not "unreaped" versus "dead". A process that is alive but not exiting must still read as alive; otherwise a genuine hang would be reported as a successful termination, which is a worse failure than the flake being fixed.

The port-reachability helper is untouched. Those tests bind in-process listeners and spawn no children, so they cannot exhibit a zombie symptom; changing them would be a change justified by nothing observed.

The corrected cause travels in #119's closing comment, because the issue as written attributes the defect to the wrong helper and closing it silently would preserve a false explanation in the public record.

## Testing Decisions

Five seams, each the highest public interface that can observe the behaviour.

**S1 — the `create_sqlite_database` command boundary.** Catches: a grant identifier that is unknown, expired, already consumed, or minted for the wrong intent, each refused with its own named error; a cancelled dialog creating nothing; an existing destination refused before any file is touched; the created file being a valid database. Misses: whether the interface actually routes through the grant selector (covered by S2), and the behaviour of the real native dialog, which is not drivable.

**S2 — the connections form component.** Catches: the form requesting a grant instead of opening its own dialog, the created path reaching the input, and cancellation producing no notification. Misses: everything downstream of the picker.

**S3 — the settings store boundary (`write`, `import`, `read-back`).** Catches: an unknown key refused with the key named; each known key's range enforced identically on write and import; a malformed value refused rather than stored; an out-of-range value written by an older build normalised on read rather than erroring; a bulk import rejected as a whole when any entry is invalid, with nothing applied. Misses: whether the interface offers only valid options (component tests), and whether a caller holds the store's raw connection handle directly.

**S4 — the E2E harness run contract**, observed by running a registered flow twice into the same `--artifacts` directory. Catches: the second run seeding its own database and store; the pristine-app-data guarantee actually holding; a fixture surviving a reused directory; the harness refusing an artifacts path it cannot safely scope. Misses: real AppImage behaviour (a different lane), and anything the reporter's Fedora session would show.

**S5 — the shared process-liveness predicate.** Catches: a deliberately created zombie reading as not-running; a running process reading as alive; identical verdicts on Unix and Windows. Misses: real container init behaviour, which cannot be simulated without a container.

**What makes a good test here.** Each seam asserts public behaviour — a returned error variant, a stored value read back, a file that does or does not exist, a process verdict — against an expected value derived independently of the implementation, never against a value the implementation computed. No internals are mocked: the grant store is real, the SQLite store is real, the processes are real. Prior art in this repository is the existing grant tests and the store tests, both of which construct the real store and assert on the error they get back.

**E2E: OPTED-OUT.** No new built-product flow is added. #117 repairs the existing lanes rather than extending coverage, and #115's guarantee is not observable through the webview: a native save dialog is not drivable through `tauri-driver`, so a flow claiming to prove it would either be skipped in practice or would have to fake the grant — turning the security proof into a mock of the mechanism under test. The property is testable only where the path is refused, which is S1.

## Migration & Rollback

**No schema migration.** The SQLite settings tables keep their shape; only the rules applied to their contents change. Values written by older builds continue to read back because read-back normalises instead of erroring, so an upgrade cannot make an existing installation unreadable.

**No IPC migration burden.** The create command's signature changes from a path to a grant identifier, but nothing persists that identifier across a session, so there is no stored state to migrate. A renderer and backend from different versions cannot coexist inside one shipped binary.

**Settings import compatibility.** After ADR 0003, a settings file exported by a newer build is refused by an older one rather than partially applied. This is the accepted cost and is stated in the ADR's consequences.

**Rollback.** Each of the two pull requests reverts independently and completely; neither leaves state behind. The harness change is inert outside the harness.

**Catalog rollback is one-way.** `/remove` permanently labels the application `opt-out` and no future auto-discovery will propose it again. This is recorded so that using it is a decision, not a convenience.

## Docs & Communication

- **`ROADMAP.md`** — a new `## 🏗️ In development` section, placed above `In the queue`, recording the four fixes as merged-but-unreleased and the catalog listing as third-party indexing. The listing entry carries the cause of the original failure (v0.8.1's launcher packaged without world-execute by Tauri 2.11, corrected in 2.12) so the diagnosis survives in this repository rather than only in a stranger's CI log, and it states that the catalog promises nothing about any distribution. This uses a state the file's own legend already declares but which had no section. Consumed by maintainers and by anyone asking "why is there a catalog page for us".
- **`GLOSSARY.md`** — the resolved terms below. Consumed by every future session and by the ticket wording in the next phase.
- **`docs/adr/0003-strict-settings-validation.md`** — the settings fail-closed decision. Consumed by whoever next adds a setting or imports settings.
- **`README.md` — none.** The catalog is not added as a download route, per the `Constraints` rule; the Linux support copy and the #62 checklist are already accurate.
- **`www/src/data/changelog.ts` — deferred.** A changelog entry is written when a version is cut, alongside the bump that makes it legal.
- **Landing page — none.**
- **External, and only these:** the `/retest` comment on the catalog PR; one diagnostic comment on issue #62; closing comments carried by the two pull requests for #115–#119.
- **`desktop/e2e/README.md`** — updated only where it currently overclaims; the pristine guarantee becomes true, so any overclaim inverts into an accurate statement.

## Domain Model

**`GLOSSARY.md` gains four terms and resolves one flagged ambiguity.**

- **Catalog Listing** — the third-party AppImage catalog's page for Gridline, generated by that project's own test from a release asset. It indexes AppImage-format compatibility for one verified build and promises nothing about any other distribution. _Avoid_: distribution support, certified platform, official download channel.
- **Pristine App-Data** — the guarantee that an E2E run's app-data directory contains nothing from a previous run, so the demo database and local store are created by the application under test. _Avoid_: clean state, fresh directory, wiped store.
- **Port Reachability** — whether something accepts a TCP connection on a loopback port. Involves no child process and says nothing about process state. _Avoid_: liveness, health.
- **Process Liveness** — whether a given process is running, distinguishing an exited-but-unreaped process from a running one. _Avoid_: liveness, reachability, alive.

**Resolved ambiguity.** "liveness probe" was used for both *Port Reachability* and *Process Liveness* in issue #119, which is the direct cause of that issue naming the wrong helper. The two share no code and no failure mode.

**ADR.** `0003-strict-settings-validation.md` — strictly refusing unknown settings keys, at the cost of cross-version import compatibility. Hard to reverse once settings files are in circulation, surprising to a future reader who wonders why a newer export will not import, and a real trade-off against skip-and-report.

## Open Questions

- **Opening an existing SQLite database at a renderer-supplied path.** `test_sqlite_connection` reads its file from the same webview-named field the create path used to, and unlike creation it can read and modify the file. This is a larger surface than #115 and needs its own design — the File Grant boundary applies to connecting, which changes when the connection is created rather than when a file is chosen. Owner: maintainer. Must be resolved before any statement that SQLite file access is authorised.
- **Dependabot majors #146, #147 and #148.** Rust API migration (`ConnectionInfo` private fields, `hmac` and `rustls` signature changes) plus regenerating both Bun lockfiles. Owner: maintainer. Needs its own cycle; it must not be folded into a hygiene cycle, because a red gate there would block unrelated fixes.
- **Catalog page staleness after future releases.** The catalog re-tests on its own schedule and its screenshot and metadata are generated once. If the listing ever misrepresents the current release, the only lever is `/remove`, which is permanent. Owner: maintainer. Resolved if and when it is observed.
- **Whether the original #62 failure was ever a build defect.** The reporter's version, session type, GPU and driver are still unknown, and this cycle does not change that. Owner: the reporter. Resolved when evidence arrives.
- **Changelog entry and version bump for these fixes.** Deferred by design. Owner: whoever cuts the next release. Must be resolved before a tag, since the four fixes will otherwise ship without a user-facing statement.
