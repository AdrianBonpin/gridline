# 01: New SQLite databases are created through an OS-selected, grant-authorised destination

**What to build:** Creating a new SQLite database is authorised the same way every other file operation already is. The destination comes from the operating system's own save dialog, brokered by the backend, and the webview never names a path. A user picks a destination, a real database file appears there, and the form continues to a usable connection. Any attempt to create a database at a path the webview supplied is refused before a file is touched.

**Type:** bug

**Blocked by:** None (can start immediately)

**Seams:**
- The create-database command boundary — catches an unknown, expired, already-consumed or wrong-intent grant, a cancelled dialog, and an existing destination, each refused by name; misses whether the interface actually routes through the grant selector.
- The connections form — catches that the form requests a grant instead of opening its own dialog and that the created destination reaches the path field; misses everything downstream. The real native dialog is not drivable, so no seam observes it.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/153
**Tracker state:** done
**Status:** done

- [x] The create-database operation accepts only a File Grant identifier; no path supplied by the webview can reach it.
- [x] The destination is chosen in the operating system's save dialog, brokered by the backend rather than opened by the webview.
- [x] A grant that is unknown, expired, already consumed, or minted for a different intent is refused, and each case is distinguishable from the others by its message.
- [x] A refused or expired selection offers a recovery action that picks the file again.
- [x] Cancelling the dialog creates nothing and reports nothing.
- [x] An existing destination is still refused before any file is touched, and a missing parent directory is still refused.
- [x] A created file is a real database that a connection can open immediately.
- [x] The form displays the created destination and continues to a connection.
- [x] The selected destination is never written to a log or diagnostic output.
- [x] Tests cover refusal of a renderer-supplied path, each of the four grant failures, cancellation, an existing destination, and successful creation.
- [ ] The pull-request description states that opening an *existing* SQLite database still accepts a webview-named path and that this ticket does not change that.
