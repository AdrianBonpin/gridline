# 50: Release gate verification

**What to build:** The comprehensive cycle is releasable: every acceptance behavior is verified, live-only cases have run, exceptions are reviewed, and the release checks pass before a tag is created.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49

**Seams:** All approved seams, exercised together: catches the integrated destination rather than isolated green tests; cannot substitute for reporter confirmation of #62.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/113
**Status:** done

**Gate run:** v0.9.2 (`8ae386b` + the two follow-ups below), against the published release artifact.

- [x] Every preceding ticket's acceptance criteria are verified as done.
- [x] Live database, SSH, and keychain cases have run in an approved environment.
- [x] Dependency exceptions are reviewed and current.
- [x] Packaged checks pass for the policy, cask, signing, AppImage startup, and targeted E2E flows.
- [x] Issue #62 remains open until reporter or equivalent-environment confirmation, and release notes describe verified behavior only.

## Evidence

### 1. Every preceding ticket is done

`grep '^\*\*Status:\*\*' docs/tickets/github-audit-hardening/*.md` → **49 done, 1 ready**
(this file, before this change). No `done` ticket has an unticked criterion
(`grep -c '^- \[ \]'` is 0 for every one of the 49).

The integrated destination was exercised, not just the isolated tickets: all 49 landed
through `feat/github-audit-hardening` → PR #114 (`d9cc842`), and every one of their
tracker issues was closed against that commit.

Running the gate **found three defects the ticket-level tests could not see**, each
fixed in this cycle rather than waved through:

| Finding | Where | Fixed in |
| :-- | :-- | :-- |
| An atomic plain `pg_dump` was reported **non-atomic** whenever a sequence had a non-default start value (`START WITH 100` on a continuation line read as transaction control), so the restore refused to run without a bogus risk acceptance. | `scan_plain_dump`, ticket 33's invariant | #143 |
| The packaged AppImage lane could not launch its artifact at all (cwd/artifact path), could not install Bun in its Fedora container, and rejected a genuinely painted light-theme window as blank. | `.github/workflows/appimage-smoke.yml`, `desktop/e2e/appimageAnalysis.mjs` | #142 |
| Four ignored live tests could not do what they claim: a fresh-sequence delta that is always 0 (+ PostgreSQL 18's cached `last_value`), `ANALYZE` on a system catalog that needs superuser, a target cleanup that was not idempotent, and a role-grant assertion for a role nobody seeded. | `query.test.rs`, `maintenance.test.rs`, `backup.test.rs`, `scripts/seed-pg-test.sql` | #143 |

### 2. Live database, SSH and keychain cases

The approved environment: macOS host, **PostgreSQL 18.6** (Homebrew, local), **MariaDB
11.8.9** (Docker, source and target as separate servers), **OpenSSH** in a container
forwarding to a PostgreSQL 18 in the same Docker network, and the real **login
keychain**.

**All 42 `#[ignore]`d live tests pass** — 41 in one serialized run, plus the SSH tunnel
test, which needs a different `GRIDLINE_TEST_PG_HOST` (its forward *target*):

```bash
cd desktop/src-tauri
env GRIDLINE_TEST_PG_HOST=localhost GRIDLINE_TEST_PG_PORT=5432 \
    GRIDLINE_TEST_PG_USER=gridline_verify GRIDLINE_TEST_PG_PASSWORD=... \
    GRIDLINE_TEST_PG_DB=gridline_vsrc \
    GRIDLINE_TEST_SRC_{HOST,PORT,USER,PASSWORD,DB}=...  GRIDLINE_TEST_TGT_{HOST,PORT,USER,PASSWORD,DB}=... \
    GRIDLINE_TEST_PG_DUMP=pg_dump GRIDLINE_TEST_PG_RESTORE=pg_restore GRIDLINE_TEST_PSQL=psql \
    GRIDLINE_TEST_MYSQL_{HOST,PORT,USER,PASS,PASSWORD,DB,URL}=... \
    GRIDLINE_TEST_MYSQL_SRC_*, GRIDLINE_TEST_MYSQL_TGT_*, GRIDLINE_TEST_MARIADB_* \
    GRIDLINE_TEST_MARIADB_DUMP=resources/mysql_tools/mariadb-dump \
  cargo test --lib -- --ignored --test-threads=1   # 41 passed

env GRIDLINE_TEST_SSH_HOST=127.0.0.1 GRIDLINE_TEST_SSH_PORT=2222 \
    GRIDLINE_TEST_SSH_USER=root GRIDLINE_TEST_SSH_KEY=<key> \
    GRIDLINE_TEST_PG_HOST=<pg host visible to the sshd> GRIDLINE_TEST_PG_PORT=5432 \
  cargo test --lib -- --ignored ssh_live          # 1 passed

cargo test --lib -- --ignored keychain_acl        # 1 passed (real login keychain)
```

What the passing tests actually exercise:

- **PostgreSQL (34):** browse/paginate/sort/filter, row identity and single-row writes
  (atomic, conflict-aware), identifier edge cases, schema diff, object DDL + dependency
  walking, role grants across object classes, maintenance, query single-execution
  (a side-effecting `SELECT` advances a sequence exactly once), and the backup/restore
  set — plain and custom dump, in-process plain restore stopping at the first error,
  `--single-transaction` rollback on a partial archive restore, DB-to-DB sync.
- **MySQL/MariaDB (10):** browse/edit/ident, single-row writes, cancel, export, query
  single-execution, native in-process restore with `clean`, dump via the **bundled**
  `mariadb-dump` and via the resolved system tool, and sync confined to the selected
  database (checked against a **separate** target server, where the assertion is
  meaningful).
- **SSH (1):** host-key probe → explicit enrolment → key-auth tunnel → two concurrent
  clients each receive PostgreSQL's SSLRequest reply through the tunnel → dropping the
  tunnel closes them.
- **Keychain (1):** create a generic-password item the way the store does, assert a
  fresh item already trusts this build, repair the ACL, assert the repair is idempotent,
  read the secret back, clean up.

**Method note (needed to reproduce):** the MySQL live cases must run
`--test-threads=1`. Several share one scratch database and one of them creates
unusual-named tables, so the default parallel schedule makes a concurrent
`mariadb-dump` fail with `Error 1412: Table definition has changed` — an apparent
failure with no product cause. Nothing is claimed that was not executed: every case
above passed in this environment.

### 3. Dependency exceptions

`python3 scripts/check-advisories.py` → `all advisories are either fixed or reviewed`
across all three resolved graphs (workspace `bun.lock`, standalone `www/bun.lock`,
`desktop/src-tauri/Cargo.lock`). The seven Rust exceptions in
[`docs/security/dependency-exceptions.md`](../../security/dependency-exceptions.md) each
carry an owner (`AdrianBonpin`), a rationale tied to Gridline's own graph, and
`review_by: 2027-05-21`. The gate fails on an unreviewed advisory, an **expired**
entry, or an entry that no longer matches a finding.

### 4. Packaged checks

| Check | Evidence |
| :-- | :-- |
| Production policy | `desktop/src/lib/production-policy.test.ts` (CSP + capability list pinned) and the built-policy e2e check both run in CI. |
| Cask | `render-cask.sh` renders `Casks/gridline.rb` from the published DMGs. The live cask carries `version "0.9.2"` and both digests match the published files byte for byte: `3c1d47b4…d798a6` (arm) and `a62c2586…1bf5b4` (intel), re-checked with `shasum -a 256` against the downloaded DMGs. |
| Signing | Release run [45027070699](https://github.com/AdrianBonpin/gridline/actions/runs/45027070699): `gate` and all four `publish` jobs succeeded, and on both macOS architectures `scripts/verify-macos-artifacts.sh` ran `stapler validate` on the `.app` and `spctl --assess --type execute`/`--type open`, both reporting `source=Notarized Developer ID` before any asset was uploaded. |
| **AppImage startup** | **Run [45042668581](https://github.com/AdrianBonpin/gridline/actions/runs/45042668581) — success on all four jobs**, against the published `Gridline_0.9.2_amd64.AppImage`: software-rendered (blocking), pristine, and the Fedora container. Each launched the real image through its launcher (`direct` on the Ubuntu runners, `extract-and-run` in the container), mapped a `1200x800 "Gridline"` window, and measured painted content — 120 / 113 / 108 distinct colours, 2.36% / 2.36% / 2.32% content over 75 of 267 rows. Screenshots show the full home screen. |
| Targeted E2E flows | All four registered WebDriver flows green in CI on the PR that fixed the lane (`desktop e2e (every registered flow)`, 11m07s). |

### 5. Issue #62

[#62](https://github.com/AdrianBonpin/gridline/issues/62) is **open**: no root cause, no
shipped fix, and no workaround baked into the package. The v0.9.2 release notes say so
explicitly, and the README's Linux section describes verified behaviour only — Ubuntu
22.04 x86_64 is the tested baseline, the `.rpm`/`.AppImage` are repackagings of that one
build, and the Fedora container lane is labelled cross-distribution compatibility
coverage everywhere it appears.

**What this gate cannot ever prove:** #62 needs its reporter, or an equivalent Fedora
environment reproducing the same behaviour. A green CI lane, an AppImage that starts
under Xvfb, or a workaround that happens to help are not that evidence, which is why the
criterion is worded as "remains open".

## What the gate changed

| PR | Commit | What it fixed |
| :-- | :-- | :-- |
| #142 | `db8af7b` | The packaged AppImage lane now finds its artifact, installs its tools before Bun, launches the image, and judges paint by content instead of background share. |
| #143 | `f5c94bf` | Plain-dump continuation lines are no longer statements (the atomicity false positive), and four ignored live tests were made honest. |
| #144 | `e6de527` | The AppImage's host GL contract and the content-based paint gate are documented in the README troubleshooting section and `desktop/e2e/README.md`. |

One process note for whoever reads this next: the `desktop e2e` job hung once on #143
(26 minutes in the flow step, no output) and passed on a re-run in 10m28s — the
runner-side flake tracked by #119. It is not a required check (`fmt + tests + build` is),
so it never blocked a merge; the re-run was done instead of bypassing anything.
