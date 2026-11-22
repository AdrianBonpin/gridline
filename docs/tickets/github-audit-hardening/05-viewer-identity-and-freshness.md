# 05: Viewer identity and freshness

**What to build:** Tabs, caches, and refresh behavior stay attached to the connection and database they belong to. Opening Edit Table always shows live columns, committed changes refresh every affected tab, and stale metadata never leaks between environments.

**Blocked by:** 04

**Seams:** Viewer interaction seam: catches tab identity, cache scoping and invalidation, and post-commit refresh; misses engine-side metadata correctness.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/105
**Status:** done

- [x] A tab opened on one database re-queries that database after the user switches the database selector.
- [x] Edit Table opened directly from an unexpanded tree item shows the live column list.
- [x] Autocomplete and expanded-table columns never present another origin's columns and refresh after relevant DDL.
- [x] A query, an object, and a table sharing a label can be open at the same time.
- [x] Committing changes refreshes every affected tab and clears optimistic markers; a failed refresh is visibly marked stale.
