# 12: Cross-schema foreign keys resolve and search

**What to build:** Following a foreign key that points into another schema opens a row from that schema, and choosing a referenced value can search the whole referenced table rather than the first small page.

**Blocked by:** 11

**Seams:** Viewer interaction seam: catches which schema and rows the foreign-key affordance requests; change-application seam: catches the referenced row lookup.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/95
**Status:** done

- [x] A foreign-key preview from one schema opens the referenced schema's row.
- [x] A same-named table in the current schema is never substituted for the referenced one.
- [x] Foreign-key option search returns matches beyond an initial small page.
- [x] Editing a foreign-key value selects the intended referenced row and stages that value.
