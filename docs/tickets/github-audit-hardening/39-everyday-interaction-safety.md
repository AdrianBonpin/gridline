# 39: Everyday interaction never misfires

**What to build:** Failures in everyday actions are visible, stale UI context cannot show another table's data, and keyboard shortcuts cannot fire while typing or inside a modal.

**Blocked by:** None (can start immediately)

**Seams:** Viewer interaction seam: catches error surfacing, row-detail lifecycle, and shortcut suppression; built-product seam: catches real keyboard behavior.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/84
**Status:** done

- [x] A failed home-screen delete or duplicate reports the failure and retains the failed selection.
- [x] No failure path is silently logged to the console only.
- [x] Row detail closes when tab, origin, page, filter, sort, or dataset changes.
- [x] Configurable shortcuts and the commit shortcut are suppressed while editing text or when a modal is open.
- [x] Shortcut listeners are not duplicated across re-renders.
