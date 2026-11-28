# 06: External follow-ups — the catalog retest and the black-window evidence request

**What to build:** The catalog pull request is re-tested against the current release and its outcome recorded, and the black-window report receives one reply naming exactly which evidence is missing. Both are pre-approved external actions. Nothing else outside this repository is modified, and the black-window issue stays open.

**Type:** chore

**Blocked by:** None (can start immediately)

**Seams:** None — these are external actions with no code seam. Verification is the catalog's own reported test result and the text of the posted comment.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/157
**Tracker state:** ready
**Status:** in_progress

- [ ] The catalog pull request is re-tested against the current release.
- [ ] The outcome is recorded — merged and the listing reachable, or the new failure quoted in full.
- [ ] If it fails again, the failure is diagnosed against the current release and the next step is stated; the listing is not reported as successful.
- [ ] One comment is posted on the black-window issue, restating the diagnostic checklist inside the comment rather than linking to documentation.
- [ ] That comment names each missing fact: the exact distribution release, the session type and desktop environment, the GPU and driver, the terminal output of a direct run, and the result of each documented workaround.
- [ ] That comment states plainly that no fix has shipped and that a passing automated run is not evidence about the reporter's machine.
- [ ] That comment promises no fix date and does not request that the issue be closed.
- [ ] The black-window issue remains open.
- [ ] No other external repository, issue, or pull request is modified, and no issue is closed by hand.
