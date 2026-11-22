# 35: OS file open is race-safe and Unicode-safe

**What to build:** An OS-delivered SQL file is validated and read as the same file, and unusual process arguments cannot crash startup.

**Blocked by:** None (can start immediately)

**Seams:** Built-product seam: catches startup and open-with behavior; unit-level validation covers the race and encoding rules.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/81
**Status:** done

- [x] Validation and reading refer to the same already-opened file, with no re-resolution window.
- [x] A non-Unicode process argument does not panic startup.
- [x] The existing size limit, extension rule, and no-auto-execution behavior remain.
- [x] An invalid open request is ignored without crashing or reading an unintended file.
