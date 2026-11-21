# 46: Cask rendering validates inputs

**What to build:** Homebrew cask rendering validates every input, so release metadata cannot alter the cask's structure or redirect where it looks for artifacts.

**Blocked by:** None (can start immediately)

**Seams:** Built-product seam: catches rendering with hostile and valid inputs; the tap repository publish is verified separately.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/89
**Status:** ready

- [ ] Version and checksum inputs are validated before rendering.
- [ ] A malformed version or checksum fails rendering with a clear error.
- [ ] Rendered cask structure is unaffected by metadata content.
- [ ] The published cask version and checksums match the published artifacts.
