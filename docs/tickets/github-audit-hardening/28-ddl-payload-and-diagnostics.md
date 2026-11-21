# 28: DDL copy returns the payload verbatim

**What to build:** Copied table DDL is complete and unaltered, and error handling is bounded, linear, and Unicode-safe so it cannot panic, poison shared state, or stall on large output.

**Blocked by:** None (can start immediately)

**Seams:** Tool-job seam: catches returned DDL and diagnostic handling; misses platform-specific process behavior.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/78
**Status:** ready

- [ ] DDL longer than a few hundred characters is copied in full and remains valid SQL.
- [ ] DDL containing connection-string-like text is not redacted or truncated.
- [ ] An error message truncated at a multi-byte character boundary does not crash the app.
- [ ] Redaction of large subprocess output finishes in bounded time and memory.
- [ ] A shared-state lock is never poisoned by a failed diagnostic path.
