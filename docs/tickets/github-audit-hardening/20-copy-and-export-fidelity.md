# 20: Copy and export fidelity

**What to build:** Copying and exporting produce exactly the declared columns, with correct quoting and preserved typed values, so a hidden locator or unusual cell cannot corrupt the output.

**Blocked by:** None (can start immediately)

**Seams:** Viewer interaction seam: catches every writer's column projection and cell encoding; misses server-streamed export paths (file-grant tickets onward).

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/71
**Status:** ready

- [ ] Every writer emits exactly the declared columns for a table with no primary key.
- [ ] SQL export output can be replayed without a column and value count mismatch.
- [ ] Identifiers and cell content are quoted correctly for each format.
- [ ] Copying a NULL yields an explicit uppercase NULL marker.
- [ ] Excel export preserves supported numeric, boolean, date, and null semantics.
