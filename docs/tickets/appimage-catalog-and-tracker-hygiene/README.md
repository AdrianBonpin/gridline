# AppImage Catalog Listing and Tracker Hygiene

**Spec:** docs/superpowers/specs/2026-11-28-appimage-catalog-and-tracker-hygiene.md
**Baseline:** 69312c8a76fb416292706c468710ad039c57b9e2
**Branch:** docs/appimage-catalog-and-tracker-hygiene
**Spec issue:** https://github.com/AdrianBonpin/gridline/issues/152

## Graph

| Ticket | Blocked by | Delivers |
| :--- | :--- | :--- |
| 01 | None | A new SQLite database is created through a backend-brokered OS save dialog; a webview-supplied path cannot reach the operation |
| 02 | None | Settings are validated at the store by one declared rule per key; unknown keys and invalid values are refused, read-back normalises |
| 03 | 02 | A settings import is validated as a whole and refused entirely on any bad entry, leaving settings untouched |
| 04 | None | An E2E run starts from a pristine app-data directory and its fixtures re-run in a reused artifacts directory |
| 05 | None | One shared process-liveness predicate distinguishes an exited-but-unreaped process from a running one, on Unix and Windows |
| 06 | None | The catalog pull request is re-tested and the black-window issue receives one evidence request; nothing else external is touched |
| 07 | 01, 02, 03, 04, 05, 06 | The roadmap records this cycle as merged but unreleased, including why the catalog listing exists |

## Shape

Two pull requests carry the code, as the spec requires: `01` alone, because removing a webview-supplied file path deserves a review that can judge the grant boundary without unrelated diffs, and `02`, `03`, `04` and `05` together as internal hygiene with no security surface. `06` is external actions and produces no pull request. `07` is documentation and lands once everything else has merged.

The initial frontier is `01, 02, 04, 05, 06` — five tickets with no shared module that can run concurrently in separate worktrees.
