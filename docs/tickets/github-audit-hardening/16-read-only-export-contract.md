# 16: Backend export is provably read-only

**What to build:** Exporting results accepts only operations the backend can prove are read-only for the selected engine and runs them under that engine's read-only enforcement, so a bypassed frontend cannot turn export into a write.

**Blocked by:** 15

**Seams:** SQL safety seam: catches rejected shapes across engines; tool-job seam: catches the engine read-only mechanism actually being used.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/97
**Status:** ready

- [ ] Export rejects leading-comment writes, executable-comment writes, and CTE writes on PostgreSQL, MySQL, and SQLite.
- [ ] Export accepts genuine read queries for all three engines.
- [ ] Each engine runs the export inside its available read-only mechanism.
- [ ] A direct invocation that skips frontend analysis is still rejected.
- [ ] Rejections name why the statement is not exportable.
