# 41: AppImage startup and paint smoke

**What to build:** The real AppImage is launched through its normal startup path on a headless display, and a window that fails to map, fails to paint, or logs a known-fatal renderer error fails the check.

**Blocked by:** None (can start immediately)

**Seams:** Built-product seam: catches packaged startup and painting; misses the reporter's hardware, session compositor, and vendor drivers, so it can never close #62.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/86
**Status:** done

- [x] The packaged AppImage launches through its normal launcher path, not by executing an inner binary directly.
- [x] The check asserts a mapped window at the expected size.
- [x] The check asserts painted content using color diversity and bright pixels rather than assuming black is failure, given the dark theme.
- [x] Known-fatal renderer and web-process diagnostics fail the check; a container-mount problem is reported separately.
- [x] The check runs nightly, manually, and against release artifacts; Fedora runs are labelled cross-distribution compatibility only.

**Verification:** `desktop/e2e/appimage{Analysis,Smoke,Window,Wiring}.test.ts` (86 tests) cover the launcher guard, window/geometry parsing, paint thresholds and outcome wiring. The paint distinction is proven against synthetic frames: a flat `#0a0a0b` canvas, a pure-black frame and a near-blank frame all fail (1–2 distinct colours, 0.00–0.01% bright, ~100% dominant); a painted dark UI passes with 13 distinct colours, 68.36% dominant and 13.07% bright — so dark is not treated as failure. `scripts/check-workflows.sh` asserts the new workflow's SHA pins, job-scoped permissions and `env:`-only metadata (verified by a negative run that broke all three and failed naming `appimage-smoke.yml`). **Not exercised here:** the real `.AppImage` launch, Xvfb window mapping and pixel capture — those need a Linux host with FUSE/`xvfb`/`xdotool`/`imagemagick`, so the lane's first real run is the CI workflow itself. No criterion claims a local AppImage run.
