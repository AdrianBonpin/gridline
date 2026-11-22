# 36: Local store integrity and permissions

**What to build:** The local store enforces referential integrity on every connection, migrates away pre-existing orphaned data transactionally, restricts its files to the current account, and its deletion copy states what is destroyed.

**Blocked by:** None (can start immediately)

**Seams:** Persistence seam: catches enforcement, migration, orphan cleanup, and permissions; misses arbitrary real user stores, so representative fixtures are required.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/82
**Status:** done

- [x] Referential enforcement is active for every opened store, not only during migration.
- [x] Migration removes unreachable history, recent records, and connection-specific saved queries, and dangling tag or folder joins, while keeping global saved queries.
- [x] Migration is transactional and idempotent; a failure leaves the prior store unchanged and is reported visibly.
- [x] Store directory, store file, and sidecar files are restricted to the current account, including for existing installations.
- [x] Deleting a connection reports that its history, recents, and connection-specific saved queries are removed.
