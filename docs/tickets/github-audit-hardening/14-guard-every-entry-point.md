# 14: Every Execution Entry Point is guarded

**What to build:** Every way SQL can reach a database — initial run, toolbar re-run, history or saved-query run, refresh, and pagination — applies the same destructive-script confirmation, and ad-hoc query tabs never execute on a table auto-refresh timer.

**Blocked by:** 01

**Seams:** Viewer interaction seam: catches routing for every entry point; SQL safety seam: catches the classification used by that routing.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/96
**Status:** ready

- [ ] A destructive script prompts from the run button, the toolbar re-run control, a history run, refresh, and paging.
- [ ] An ad-hoc query tab receives no auto-refresh timer and cannot execute unreviewed text on a timer.
- [ ] Editing query text and using any entry point re-evaluates the current text.
- [ ] An E2E flow proves the toolbar re-run requires confirmation.
