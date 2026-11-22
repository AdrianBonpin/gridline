# 18: Query workspace tells the truth

**What to build:** A query tab always shows what actually happened: failures and cancellation are visible, prior results are marked stale, and the newest page, filter, or sort intent wins instead of an older response.

**Blocked by:** 14

**Seams:** Viewer interaction seam: catches error surfacing, stale marking, and request ordering; misses engine-side cancellation mechanics, covered by the execution and tool-job seams.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/108
**Status:** done

- [x] A thrown execution, cancellation, budget, or connection error appears in the query workspace.
- [x] Previous results are visibly marked stale after a failed run.
- [x] Changing page, filter, or sort during an in-flight request shows the newest intent's data, never older data under newer controls.
- [x] Pagination always resolves its loading and cancel state and never wedges the tab.
- [x] Cancellation is final and triggers no fallback or re-run.
