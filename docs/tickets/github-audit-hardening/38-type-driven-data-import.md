# 38: Data import is type-driven and validated

**What to build:** Imported CSV and JSON map to the intended columns, convert by declared column type rather than by appearance, and reject malformed or oversized input before anything is staged.

**Blocked by:** None (can start immediately)

**Seams:** Viewer interaction seam: catches mapping, conversion, and pre-staging validation; misses server-side insert behavior, covered by exact row identity and the change-application seam.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/83
**Status:** done

- [x] Source columns are tracked by position, so duplicate headers cannot duplicate one column's values.
- [x] Mapping the same target column twice is rejected.
- [x] Typed conversion preserves leading zeros, large-integer precision, empty-string versus null, and nested JSON.
- [x] An invalid value reports its row and column and stages nothing.
- [x] Unbalanced quotes, inconsistent widths, and byte-limit violations are reported before staging, with the byte limit checked before full buffering.
