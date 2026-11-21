# 26: Connection status and credential copy tell the truth

**What to build:** Connection tests and credential copies report reality: a missing SQLite file fails rather than being created silently, probe credentials and tunnels are correct, and a failed password copy is never presented as success.

**Blocked by:** None (can start immediately)

**Seams:** Connection trust seam: catches probe outcomes and credential handling; viewer seam: catches what the copy action reports.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/76
**Status:** ready

- [ ] Testing a SQLite connection whose file is missing fails, with creation available as a separate explicit action.
- [ ] A Redis probe handles passwords containing reserved characters.
- [ ] A tunnelled MySQL probe reports the server version from the real target.
- [ ] Copying a connection URL with a password reports keychain or clipboard failure and never silently produces a password-less URL.
