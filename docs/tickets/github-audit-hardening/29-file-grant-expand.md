# 29: File Grants: expand and secure backup output

**What to build:** Choosing a file for backup output produces a backend-issued, intent-scoped, single-use grant that expires after five minutes and authorizes exactly that write. A path supplied by the renderer authorizes nothing.

**Blocked by:** None (can start immediately)

**Seams:** File Grant seam with an injectable picker: catches intent, expiry, replay, and cross-job use; misses the native dialog's visuals, which a platform smoke covers.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/79
**Status:** ready

- [ ] A native selection yields a grant that the backup write consumes successfully.
- [ ] A raw renderer-supplied path is rejected for the same operation.
- [ ] A grant cannot be reused for a second job or a different intent.
- [ ] A grant older than five minutes is rejected with an expired-grant state.
- [ ] The prior user-visible file-selection flow is unchanged.
