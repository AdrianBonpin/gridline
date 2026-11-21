# 44: Release inputs are verified

**What to build:** Bundled database tools come from pinned sources with checked integrity, so the shipped executables have an auditable chain.

**Blocked by:** 43

**Seams:** Built-product seam: catches the build workflow and scripts; misses an attacker who controls both source and digest, which the pinning review addresses.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/101
**Status:** ready

- [ ] PostgreSQL and MariaDB source inputs are pinned and cryptographically verified.
- [ ] A digest or signature mismatch stops the build.
- [ ] Packaged tool manifests are checked before artifacts are uploaded.
- [ ] Any cached archive used by a build is verified rather than trusted.
