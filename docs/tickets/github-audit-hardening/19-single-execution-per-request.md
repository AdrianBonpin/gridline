# 19: One execution per request

**What to build:** Each accepted run or page request executes the statement once. Counting, metadata discovery, empty results, and fallback paths never replay a side-effecting statement, and an exact total that cannot be obtained safely is reported as unknown.

**Blocked by:** None (can start immediately)

**Seams:** SQL safety seam and change-application seam: catch repeat executions and total reporting; live cases catch engine-specific wrapping behavior.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/70
**Status:** done

- [x] A side-effecting SELECT runs once per request, not once for counting and again for data.
- [x] An empty result set does not trigger a second execution to discover columns.
- [x] A wrapping failure does not trigger an additional execution of a side-effecting statement.
- [x] When an exact total is unavailable, the UI reports it as unknown rather than recomputing.
- [x] Cancellation does not cause a raw fallback execution.
