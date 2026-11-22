# 33: PostgreSQL restore is transactional or explicitly non-atomic

**What to build:** A compatible dump restores all-or-nothing, an incompatible one requires explicit risk acceptance, and a target failure is reported as the primary error.

**Blocked by:** 30, 31

**Seams:** Tool-job seam: catches transactional restore, incompatibility detection, and error precedence; misses dumps whose incompatibility only appears at execution time.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/110
**Status:** done

- [x] A compatible dump that fails partway leaves the target unchanged.
- [x] An incompatible dump is identified, and running it non-atomically requires explicit confirmation naming the risk.
- [x] The target's failure is reported as primary when the source pipe closes as a consequence.
- [x] The remaining non-atomic guarantee is stated in the UI.
