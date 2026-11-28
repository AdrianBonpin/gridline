# 04: An E2E run starts from a pristine app-data directory and its fixtures re-run

**What to build:** An end-to-end run begins from an application-data directory containing nothing from a previous run, and its fixtures can run again. Running the same registered flow twice into the same artifacts directory produces the same result both times, so reproducing a continuous-integration failure locally does not require remembering to delete a directory first. The harness refuses to proceed rather than deleting anything it did not create.

**Type:** bug

**Blocked by:** None (can start immediately)

**Seams:**
- The harness run contract, observed by running a registered flow twice into one artifacts directory — catches a second run seeding its own database and store, the pristine guarantee actually holding, a fixture surviving reuse after a killed run, and the harness refusing an artifacts path it cannot safely scope; misses real packaged-AppImage behaviour, which is a different lane.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/155
**Tracker state:** done
**Status:** done

- [x] Before launch the harness removes its own application-data locations, resolved strictly beneath the artifacts directory.
- [x] The harness refuses to proceed, with a clear message, when those locations do not resolve beneath the artifacts directory.
- [x] The artifacts directory itself is never removed, and nothing outside it is touched.
- [x] Two consecutive runs of the same registered flow into one artifacts directory both pass.
- [x] A run following a killed run into the same directory passes.
- [x] Fixtures create their tables only when absent and remove them before creating, so a stale directory cannot wedge a flow.
- [x] Both the WebDriver lane and the packaged-AppImage lane receive the same guarantee.
- [x] The documented pristine-app-data guarantee is accurate after the change; any statement that still overclaims is corrected rather than left standing.
- [x] Tests cover the pristine guarantee and the refusal for an unscopable artifacts path.
