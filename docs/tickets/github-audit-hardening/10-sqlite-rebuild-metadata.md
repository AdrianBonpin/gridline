# 10: SQLite rebuild preserves schema metadata

**What to build:** After a SQLite rebuild, the table still carries its keys, checks, uniques, indexes, triggers, generated columns, table options, and sequences, and values land in the columns they came from.

**Blocked by:** 08

**Seams:** Change-application seam: catches preserved objects and value mapping after reorder; misses engine features SQLite cannot express, which must be refused instead.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/106
**Status:** ready

- [ ] Reordering columns moves each value to its own column rather than by position.
- [ ] Primary keys, foreign keys, checks, uniques, indexes, triggers, and generated columns survive a rebuild.
- [ ] Table options and owned sequences survive where the engine exposes them.
- [ ] A shape whose metadata cannot be preserved is refused by the rebuild guard rather than silently degraded.
- [ ] A round-trip check compares schema before and after the rebuild.
