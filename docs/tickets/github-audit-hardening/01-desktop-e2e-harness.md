# 01: Desktop E2E harness with a demo-database smoke flow

**What to build:** A reproducible desktop build of Gridline launches under the supported WebDriver path, opens the seeded demo database, and asserts one visible result on screen. This is the harness the later critical-flow tickets extend; it must fail loudly when the app does not actually render.

**Blocked by:** None (can start immediately)

**Seams:** Built-product seam: catches integrated launch, webview automation, and demo data flowing into the grid; misses packaged AppImage behavior (ticket 41) and the reporter's hardware.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/64
**Status:** done

- [x] One documented command launches the built non-AppImage desktop binary headlessly and reaches the demo database.
- [x] The smoke flow asserts visible grid content for a demo table, not merely a live process or window.
- [x] A failed launch, missing window, or absent grid content fails the job and retains launch logs and a screenshot.
- [x] The harness is wired into pull-request CI for changes to the desktop frontend, viewer state, Tauri command behavior, or their dependencies.
