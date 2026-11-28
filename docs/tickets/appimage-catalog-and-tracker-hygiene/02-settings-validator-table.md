# 02: Settings written through the store are validated there

**What to build:** Every setting written through the local store is validated at the store against one declared rule per key, and a key the store does not know is refused rather than stored. A caller that bypasses the command layer cannot persist an invalid value. An out-of-range or malformed value is refused with the key named and the valid range stated. A value written by an older build reads back normalised instead of raising an error, so a stricter write path can never make an existing installation unreadable.

**Type:** bug

**Blocked by:** None (can start immediately)

**Seams:**
- The settings store boundary — catches an unknown key, each known key's range, a malformed value, and read-back normalisation of a bad stored value; misses whether the interface offers only valid options, and misses a caller that holds the store's raw connection directly.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/154
**Tracker state:** done
**Status:** done

- [x] One declared rule exists per known settings key, and it is the single source of validity for both writes and read-backs.
- [x] A write of an unknown key is refused with the key named.
- [x] A write of an out-of-range value is refused with the key named and the valid range stated.
- [x] A write of a malformed value is refused rather than stored.
- [x] Every setting the interface can write has a rule; no key relies on a dropdown's options for its validity.
- [x] Read-back normalises an out-of-range stored value to a valid one and never errors.
- [x] The one-off command-layer check for a single key is replaced by the shared rule.
- [x] Tests cover an unknown key, the boundary values of every ranged key, a malformed value, and read-back normalisation of a value a previous build could have stored.
- [ ] The pull-request description cites the ADR recording that unknown keys are refused rather than skipped.
