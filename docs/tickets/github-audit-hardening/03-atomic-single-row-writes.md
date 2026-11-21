# 03: Single-row writes are atomic and conflict-aware

**What to build:** A row update or delete either changes exactly the one intended row or changes nothing. Zero matches, multiple matches, and a concurrently changed original value are reported as failures with no durable write.

**Blocked by:** 02

**Seams:** Change-application seam: catches transactional rollback and the value-conflict predicate; misses how the conflict is presented. Viewer seam: catches the surfaced conflict message.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/104
**Status:** done

- [x] A write matching zero rows commits nothing and reports a stale-row error.
- [x] A write matching more than one row rolls back before reporting an ambiguous match.
- [x] Changing a value another session has already changed reports a conflict and writes nothing.
- [x] A physical-locator write whose row has moved cannot modify a different row.
- [x] Behavior is verified for PostgreSQL, MySQL, and SQLite through headless or live cases as available.
