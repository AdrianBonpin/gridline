# 27: Session-only credentials reach tool jobs

**What to build:** With keychain persistence disabled, backup, restore, sync, and DDL copy authenticate with the matching session-only credential, or prompt when it is unavailable, without persisting or logging it.

**Blocked by:** None (can start immediately)

**Seams:** Tool-job seam: catches credential plumbing into subprocesses; misses real keychain prompts.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/77
**Status:** ready

- [ ] With keychain persistence off, a backup succeeds using the session credential.
- [ ] Restore, sync, and DDL copy behave the same way.
- [ ] A missing session credential prompts instead of failing with an empty password.
- [ ] The credential never appears in process arguments, logs, or the local store.
- [ ] Keychain-enabled connections keep their existing behavior.
