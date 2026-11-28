# 0003: Settings are validated by one table at the store, and unknown keys are refused

**Status:** Accepted
**Date:** 2026-11-28

## Context

Gridline persists settings as `key`/`value` rows in its local SQLite store. `Store::update_setting` is a blind upsert: it inserts any key with any value, and `apply_settings` (used by settings import) is equally unconstrained. Validation had accumulated in three unrelated places instead, and they had already drifted apart:

- The IPC layer checked **one** key (`table_page_size`, range 1–500).
- Read-back re-clamped **two** more (`editor_font_size` 8–24, `editor_tab_size` 2–8) and filtered one against an allowlist (`editor_font_family`).
- The TypeScript import validator clamped a partly overlapping set, and the settings interface constrained the rest only through its dropdown options.

The gaps were real, not theoretical: `table_refresh_rate` could be stored as `-1`, `theme` as an arbitrary string, and `default_ports` as a port above 65535, all of which then read back unmodified. Every consumer trusted a value that nothing had checked.

Two shapes were possible. Validation could be added where each gap was found, keeping the three-layer arrangement; or the store could become the single place a setting is known to be valid, with the other layers delegating to it. The second is more disruptive — it changes what an unknown key means — which is why it needs recording.

## Decision

The store holds one declared table mapping each known settings key to its validity rule. It is consulted on write, on bulk import, and on read-back, replacing the ad-hoc clamps and the single-key IPC special case.

A key the table does not know is **refused**, not stored and not skipped. A bulk import validates the entire file before applying any of it, so a rejected file leaves settings untouched rather than half-updated.

Read-back never errors: a stored value that no longer satisfies its rule is normalised to a valid one. This keeps a stricter write path from making existing installations unreadable.

## Consequences

**Easier.** Adding a setting means adding one table entry. Every consumer — IPC, import, read-back, and any future caller holding the store directly — is governed by the same rule, so the drift that produced this decision cannot recur by omission. The store's contents are trustworthy by construction rather than by convention.

**Harder.** A settings file exported by a newer build is refused by an older build instead of importing what it recognises. Users who copy settings between machines running different versions will meet an error where they previously got a partial import. That is the accepted cost: a silent partial import leaves a settings set that is neither the old one nor the new one, and the user has no way to tell which.

**Committed to.** Every new setting arrives with an explicit validity rule and a test for it. There is no "accept anything" escape hatch, and the alternative — skip-and-report on import — would have to reverse this decision rather than extend it.
