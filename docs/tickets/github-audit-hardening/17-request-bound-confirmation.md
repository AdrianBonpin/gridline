# 17: Destructive confirmation is bound to its request

**What to build:** A destructive confirmation applies only to the exact origin, tab, SQL revision, and intent it was raised for. Changing tabs, editing the SQL, switching origin, or closing the tab cancels it, and the dialog behaves like a modal.

**Blocked by:** 04, 14, 15

**Seams:** Viewer interaction seam: catches request identity and cancellation; built-product seam: catches keyboard behavior in a real window.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/107
**Status:** done

- [x] Switching tabs, editing the SQL, or changing origin invalidates a pending confirmation.
- [x] A keyboard shortcut cannot execute or relocate a pending confirmation.
- [x] The dialog traps focus, Escape cancels, and the editor behind cannot receive typing.
- [x] The dialog names the offending statement and its position in the script.
- [x] Confirming executes exactly the reviewed text once.
