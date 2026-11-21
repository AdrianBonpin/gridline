# 34: MySQL restore parses and cleans exactly

**What to build:** MySQL dumps containing dialect escapes and dotted quoted object names restore correctly under bounded memory, and a clean restore drops only the objects the dump recreates.

**Blocked by:** 30, 31

**Seams:** Tool-job seam: catches splitting, memory behavior, clean planning, and failure reporting; misses server behaviors that require a live instance.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/111
**Status:** done

- [x] Dumps containing backslash escapes and doubled quotes split and restore correctly.
- [x] A quoted object name containing a dot is treated as one name, not as schema plus table.
- [x] Processing stays within the documented size limit without copying the file multiple times in memory.
- [x] A clean restore drops only objects the dump recreates, leaving unrelated objects intact.
- [x] A failing statement is reported with its position.
