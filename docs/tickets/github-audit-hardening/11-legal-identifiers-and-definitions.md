# 11: Legal identifiers and definitions round-trip faithfully

**What to build:** Tables, schemas, and columns whose legal names contain quotes, spaces, or other specials can be browsed, filtered, sorted, edited, introspected, and exported. Routine and trigger definitions containing quotes, dollar delimiters, and semicolons round-trip without changing meaning.

**Blocked by:** None (can start immediately)

**Seams:** Change-application seam and SQL safety seam: catch correct quoting and binding in generated SQL; viewer seam: catches invalid filter or sort requests being reported rather than ignored.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/67
**Status:** ready

- [ ] Browsing, editing, filtering, sorting, and DDL copy work for legal names containing quotes or spaces.
- [ ] A filter or sort request whose column cannot be represented safely fails visibly instead of returning unfiltered rows.
- [ ] Introspection works for such names across supported engines.
- [ ] Routine and trigger definitions containing quotes, dollar delimiters, or semicolons are saved unchanged.
- [ ] A definition that cannot be represented faithfully is rejected with a reason rather than altered.
