# 02: Exact Row Identity for edits and deletes

**What to build:** Editing one cell in a table with a composite primary key changes exactly that row, and deleting one selected row removes exactly that row. A table with no primary key can be edited and deleted by a backend locator that never appears as a visible or exported column.

**Blocked by:** 01

**Seams:** Viewer interaction seam: catches how identity is constructed during staging and selection; misses the SQL actually sent. Change-application seam: catches the addressed row; misses navigation and display.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/92
**Status:** done

- [x] Editing a cell in the composite-key demo table leaves every sibling row unchanged when committed.
- [x] Deleting one row from a composite-key table removes exactly one row.
- [x] Editing and deleting a row in a no-primary-key table affect only the displayed row.
- [x] The no-primary-key locator never renders as a grid column and never appears in CSV, JSON, SQL, Markdown, or Excel output.
- [x] Bulk delete on a composite-key table stages one change per selected row carrying the complete key.
- [x] An E2E flow in the harness proves sibling rows survive a composite-key edit.
