# 24: Connection lifecycle closes everything

**What to build:** Disconnecting or leaving the viewer closes the pool, tunnel, cancellation state, and related resources together. A failed reconnect leaves the working session intact, and regenerating the demo database clears stale handles.

**Blocked by:** None (can start immediately)

**Seams:** Connection trust seam: catches teardown and reconnect behavior; misses operating-system listener inspection, which a platform check covers.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/74
**Status:** ready

- [ ] Disconnect closes the pool, the SSH tunnel, and cancellation handles together.
- [ ] No loopback listener remains reachable after a viewer is closed or disconnected.
- [ ] A failed reconnect preserves the previously working session and reports the failure.
- [ ] Regenerating the demo database leaves no stale pool or cancellation state.
- [ ] Deleting a connection closes its resources and removes its secrets.
