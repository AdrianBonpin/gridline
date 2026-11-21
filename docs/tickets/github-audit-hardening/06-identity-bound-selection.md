# 06: Selection follows Row Identity

**What to build:** Row selection is tied to row identity inside its tab and context, so bulk copy and bulk delete act only on rows the user currently selected.

**Blocked by:** 02, 05

**Seams:** Viewer interaction seam: catches selection lifecycle and the rows handed to bulk actions; misses the SQL sent for those rows (covered by exact row identity).

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/112
**Status:** ready

- [ ] Selection clears on page, filter, sort, tab, origin, and dataset changes.
- [ ] Bulk delete after a page change stages only currently visible, currently selected rows.
- [ ] Bulk copy and copy-as-SQL use selected row identity rather than stale positions.
- [ ] A selected-count display never claims rows that are no longer selected.
