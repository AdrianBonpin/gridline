# 22: Deliberate SSH key re-enrollment

**What to build:** When a server key legitimately changes, the user can replace stale trust through a separate deliberate flow, without an override that weakens normal authentication.

**Blocked by:** 21

**Seams:** Connection trust seam: catches the re-enrollment action and its effect on later connections; misses operating-system trust-store presentation details.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/98
**Status:** ready

- [ ] Re-enrollment is reachable from the connection's trust state, not from the authentication error path.
- [ ] Completing re-enrollment lets later connections verify the new key.
- [ ] Normal authentication offers no path to ignore a mismatch.
- [ ] Trust records contain no credentials.
