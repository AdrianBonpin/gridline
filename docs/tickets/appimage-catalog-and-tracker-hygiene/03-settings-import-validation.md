# 03: A settings import is validated as a whole before anything is applied

**What to build:** Importing a settings file validates the entire file before any of it is applied. A file containing an unknown key or one invalid value leaves the current settings completely untouched and reports every problem it found, rather than importing what it recognised and dropping the rest. The interface stops restating numeric ranges that the store already declares, so the two cannot drift apart.

**Type:** bug

**Blocked by:** 02

**Seams:**
- The settings store's import boundary — catches a wholly invalid file, a partially invalid file, and a valid file, and asserts settings are unchanged in the first two cases; misses whether the interface surfaces the report legibly, which the settings page component covers.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/158
**Tracker state:** done
**Status:** done

- [x] A settings import validates every entry before applying any of them.
- [x] A file containing an unknown key or an invalid value is refused as a whole, and the report names each offending key.
- [x] Settings are unchanged after a refused import.
- [x] A valid file imports completely, every accepted key reaching the same rule the store enforces on a direct write.
- [x] The import validator no longer restates numeric ranges the store declares; it consults the shared rules.
- [x] An import refuses rather than clamps a value that is out of range.
- [x] Tests cover a wholly invalid file, a file with exactly one invalid entry, and a valid file, asserting untouched settings in the first two.
- [x] The settings page surfaces the refusal with the offending keys visible, and offers no partial-import affordance.
