# 23: TLS modes fail closed and verify the real host

**What to build:** An unrecognized TLS mode is rejected instead of silently connecting in plaintext, and certificate verification through an SSH tunnel validates the chain and the original database hostname.

**Blocked by:** None (can start immediately)

**Seams:** Connection trust seam: catches mode resolution and tunnel verification decisions; misses real certificate chains until a live case runs.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/73
**Status:** done

- [x] Saving, importing, or connecting with an unknown TLS mode is rejected with the valid set named.
- [x] An empty mode keeps the documented managed-provider and engine defaults.
- [x] Verify-full or verify-ca through a tunnel verifies against the original database hostname, not the loopback address.
- [x] A tunnel never silently downgrades verification to encryption-only.
- [x] Each mode has a behavioral test.
