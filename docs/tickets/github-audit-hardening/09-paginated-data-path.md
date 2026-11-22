# 09: Paginated reads describe the rows they return

**What to build:** Browsing a table describes exactly the rows it shows: filtered totals match the filter, page and page-size input cannot escape bounds, metadata is fetched separately from row pages, and an all-defaults insert is valid.

**Blocked by:** None (can start immediately)

**Seams:** Change-application seam: catches count, page, and insert statements; viewer seam: catches the totals and pages the toolbar presents.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/66
**Status:** done

- [x] A filtered MySQL browse reports the filtered total and page count, not the whole-table count.
- [x] Page numbers must be positive and page sizes are limited to a bounded range; out-of-range input is rejected rather than altering the query limit.
- [x] Fetching column or object metadata does not paginate or truncate row data, and does not wedge a loading state.
- [x] Inserting a row with every editable field left at its default succeeds on SQLite as well as PostgreSQL.
- [x] Table data and metadata retrieval remain available for views and materialized views without attempting edits.
