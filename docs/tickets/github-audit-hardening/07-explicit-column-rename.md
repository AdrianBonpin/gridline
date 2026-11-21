# 07: Explicit column rename intent

**What to build:** A column is renamed only when the user explicitly asks. Adding, removing, or reordering columns never produces an inferred rename, and every edit in one form submission is represented in the staged result.

**Blocked by:** None (can start immediately)

**Seams:** Change-application seam: catches the generated statements for add, rename, and combined edits; misses the editor affordance itself.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/65
**Status:** done

- [x] Adding a column in the middle of a table stages only an add, with no rename and no data movement.
- [x] An explicit rename stages only a rename.
- [x] Reordering columns never produces a rename statement.
- [x] A submission combining a rename with another change stages both, and nothing is silently dropped.
- [x] Regression cases cover the previously ambiguous shapes for PostgreSQL and SQLite.
