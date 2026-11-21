# 15: SQL classification fails closed

**What to build:** Statements whose surface syntax looks read-only but can write are classified by their real effect, and anything uncertain asks for confirmation. Frontend and backend share one behavioral vector corpus so the two views cannot drift.

**Blocked by:** None (can start immediately)

**Seams:** SQL safety seam: catches classification of comments, executable comments, CTE bodies, EXPLAIN forms, delimiters, quoting, and unknown verbs; misses vendor grammar not represented in the corpus until a live case is added.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/69
**Status:** ready

- [ ] EXPLAIN ANALYZE over a writing statement requires confirmation.
- [ ] A MySQL executable comment containing a write requires confirmation.
- [ ] A leading comment before a writing statement requires confirmation.
- [ ] A data-modifying CTE requires confirmation, while a read-only CTE does not.
- [ ] An unknown verb asks for confirmation, and a write keyword inside a string literal does not.
- [ ] Both languages read the same vector corpus and a drift between them fails a test.
