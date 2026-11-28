# 06: External follow-ups — the catalog retest and the black-window evidence request

**What to build:** The catalog pull request is re-tested against the current release and its outcome recorded, and the black-window report receives one reply naming exactly which evidence is missing. Both are pre-approved external actions. Nothing else outside this repository is modified, and the black-window issue stays open.

**Type:** chore

**Blocked by:** None (can start immediately)

**Seams:** None — these are external actions with no code seam. Verification is the catalog's own reported test result and the text of the posted comment.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/157
**Tracker state:** in_progress
**Status:** in_progress

- [x] The catalog pull request is re-tested against the current release. — `/retest` posted; `Test` run 46122257331 re-ran and its own comment names `Gridline_0.9.2_amd64.AppImage` from v0.9.2.
- [ ] The outcome is recorded — merged and the listing reachable, or the new failure quoted in full. — _Neither named outcome occurred: the test now passes, but the PR is unmerged and the listing is 404. The actual outcome is recorded under `## Outcome`._
- [ ] If it fails again, the failure is diagnosed against the current release and the next step is stated; the listing is not reported as successful. — _Condition not triggered (the test passed, so there is no failure to diagnose); the listing is nevertheless not reported as successful._
- [x] One comment is posted on the black-window issue, restating the diagnostic checklist inside the comment rather than linking to documentation. — comment 7236112760 carries the commands inline and links no documentation.
- [x] That comment names each missing fact: the exact distribution release, the session type and desktop environment, the GPU and driver, the terminal output of a direct run, and the result of each documented workaround. — items 1–5 of the comment.
- [x] That comment states plainly that no fix has shipped and that a passing automated run is not evidence about the reporter's machine.
- [x] That comment promises no fix date and does not request that the issue be closed. — it states the issue will be left open.
- [x] The black-window issue remains open. — verified after posting: `state: OPEN`, `stateReason: ""`, `closedAt: null`, labels `["bug"]`, one comment.
- [x] No other external repository, issue, or pull request is modified, and no issue is closed by hand. — the only writes were the `/retest` comment on PR #6518 and one comment on issue #62.

## Outcome

- **Catalog PR** `AppImage/appimage.github.io#6518` — state **OPEN**, `mergedAt: null`, labels exactly `screenshot-ok` + `auto-discovered`. `/retest` comment: https://github.com/AppImage/appimage.github.io/pull/6518#issuecomment-7236083586
- **Run URL** — `Test` re-run: https://github.com/AppImage/appimage.github.io/actions/runs/46122257331 (pass, 1m28s, job https://github.com/AppImage/appimage.github.io/actions/runs/46122257331/job/140909117640). The catalog's own comment then read `### :white_check_mark: Test passed` and named `Gridline_0.9.2_amd64.AppImage` as tested — so the v0.8.1 launcher defect does not reproduce on v0.9.2.
- **Listing** — **not reachable**: `https://appimage.github.io/Gridline/` returns **404** (expected while the entry is unmerged). Not reported as successful anywhere.
- **Why unmerged** — `.github/workflows/publish-pr-screenshot.yml` skips auto-merge for `discover/*` branches by design (`skip "discovered automatically; a maintainer reviews it"`); the only automation that merges an `auto-discovered` + `screenshot-ok` PR is `merge-labeled.yml`, which is hand-dispatched or a `nightly.yml` step and last ran 2026-11-07. The merge is therefore pending the catalog maintainers, not on a further Gridline change.
- **Next step** — nothing further from this repository: the ball is with the catalog maintainers' merge step. Re-check `https://appimage.github.io/Gridline/` after that merge; do **not** open another PR or comment again on #6518.
- **Black-window issue** — `AdrianBonpin/gridline#62`: one comment posted (https://github.com/AdrianBonpin/gridline/issues/62#issuecomment-7236112760), issue still **OPEN** with no state change.
- Raw findings: `/tmp/gridline-ticket-06/catalog-outcome.md`.
