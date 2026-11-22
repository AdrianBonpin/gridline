# 32: SQLite dump is snapshot-consistent and lossless

**What to build:** A SQLite dump never destroys its source or a prior destination, reads one consistent snapshot, and preserves or explicitly refuses values it cannot represent.

**Blocked by:** 30, 31

**Seams:** Tool-job seam: catches file identity, atomic publication, snapshot reads, and value preservation; misses concurrent writers outside the application.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/109
**Status:** done

- [x] Choosing the connection's own file as the dump destination is refused.
- [x] A failed dump leaves any existing destination file intact and publishes no partial output.
- [x] All tables in one dump come from a single consistent snapshot.
- [x] A row or metadata decode failure fails the backup instead of dropping rows.
- [x] Invalid-UTF8 text, blobs, non-finite reals, sequences, user-version, and application-id survive a round trip or are refused explicitly.
