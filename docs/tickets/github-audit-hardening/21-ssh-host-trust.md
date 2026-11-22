# 21: SSH host trust before authentication

**What to build:** Gridline verifies the SSH server's host key before sending any credential. Known hosts verify silently, unknown hosts require explicit fingerprint acceptance that is remembered, and a conflicting key fails closed with a visible state and recovery path.

**Blocked by:** None (can start immediately)

**Seams:** Connection trust seam with a fake transport: catches known, unknown, and mismatched host policy and the pre-authentication ordering; misses real keychain and network behavior, covered by platform checks.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/72
**Status:** done

- [x] A host matching a known-hosts entry connects without prompting.
- [x] An unknown host blocks authentication until the user explicitly accepts its fingerprint, and accepts non-standard ports correctly.
- [x] A conflicting key fails with expected and actual fingerprints and no bypass during authentication.
- [x] No password, key, or passphrase is sent before verification succeeds.
- [x] An unknown-host state is visible in the UI with a recovery action.
