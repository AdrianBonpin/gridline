# 25: No application-wide head-of-line blocking

**What to build:** A slow query, export, or schema read on one connection leaves other connections and tabs usable.

**Blocked by:** None (can start immediately)

**Seams:** Tool-job seam and change-application seam: catch concurrent operations; misses some driver-specific concurrency limits.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/75
**Status:** ready

- [ ] A long-running export on one connection does not block browsing or editing on another.
- [ ] A slow query on one connection does not block another connection's commands.
- [ ] Cancellation remains available while a long operation runs.
- [ ] Any remaining same-connection serialization is limited to what the driver requires.
