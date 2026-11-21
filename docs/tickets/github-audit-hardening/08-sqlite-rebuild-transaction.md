# 08: SQLite rebuild is one transaction and refuses unsafe shapes

**What to build:** A SQLite table rebuild either completes as a single atomic change or leaves the database exactly as it was. Shapes that cannot be rebuilt faithfully are refused with a specific reason before any mutation.

**Blocked by:** 01, 07

**Seams:** Change-application seam: catches atomicity and refusal ordering; built-product seam: catches the refusal being reachable and legible from the editor.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/94
**Status:** ready

- [ ] A rebuild succeeds as one transaction.
- [ ] A failure injected mid-rebuild leaves the original table intact, with no temporary table and no dropped data.
- [ ] An unsupported shape is refused before the first mutating statement with a reason naming the blocker.
- [ ] The refusal is surfaced in the table editor rather than only in a queue error.
- [ ] An E2E flow in the harness proves a rebuild either completes or changes nothing.
