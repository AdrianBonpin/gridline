# 37: Connection transfer round-trips

**What to build:** Moving connections between machines works: the app's own export imports, legacy bare-array files still import, every non-secret setting survives, and links that cannot be resolved locally are dropped with warnings.

**Blocked by:** 36

**Seams:** Persistence seam: catches the envelope, legacy shape, field fidelity, and unresolved-link reporting; misses secrets, which are intentionally excluded.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/100
**Status:** done

- [x] An export produced by the app imports successfully on a clean store.
- [x] A legacy bare-array file still imports.
- [x] Database, environment, favorite, SSH, and TLS settings survive a round trip.
- [x] Valid folder and tag links are preserved; unresolved ones are dropped with a per-record warning.
- [x] No password or SSH secret is written to the export or the local store.
