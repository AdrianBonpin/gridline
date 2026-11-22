# 49: Version consistency across manifests

**What to build:** Every place the project states its version agrees and is enforced by a test, so no package or page reports a stale release.

**Blocked by:** None (can start immediately)

**Seams:** Built-product seam: catches manifests, documentation, and landing-page version strings together.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/91
**Status:** done

- [x] The root manifest participates in version consistency.
- [x] Desktop, backend, website, README, and changelog versions agree.
- [x] A mismatch fails a test rather than shipping.
- [x] Any currently stale version statement is corrected.
