# 41: AppImage startup and paint smoke

**What to build:** The real AppImage is launched through its normal startup path on a headless display, and a window that fails to map, fails to paint, or logs a known-fatal renderer error fails the check.

**Blocked by:** None (can start immediately)

**Seams:** Built-product seam: catches packaged startup and painting; misses the reporter's hardware, session compositor, and vendor drivers, so it can never close #62.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/86
**Status:** ready

- [ ] The packaged AppImage launches through its normal launcher path, not by executing an inner binary directly.
- [ ] The check asserts a mapped window at the expected size.
- [ ] The check asserts painted content using color diversity and bright pixels rather than assuming black is failure, given the dark theme.
- [ ] Known-fatal renderer and web-process diagnostics fail the check; a container-mount problem is reported separately.
- [ ] The check runs nightly, manually, and against release artifacts; Fedora runs are labelled cross-distribution compatibility only.
