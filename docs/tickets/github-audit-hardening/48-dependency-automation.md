# 48: Dependency automation and cross-platform checks

**What to build:** New advisories and platform divergence are discovered during normal work rather than at tag time.

**Blocked by:** 47

**Seams:** Built-product seam: catches CI wiring and cross-platform builds; misses advisories published after a run, which scheduled checks cover.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/103
**Status:** done

- [x] Automated dependency updates are configured.
- [x] Advisory scanning runs in CI and fails on new unreviewed findings.
- [x] Compilation and tests run for the platforms the release targets before a release.
- [x] Both workspace and standalone website lockfiles are maintained by the documented procedure.
