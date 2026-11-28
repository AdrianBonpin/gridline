# 07: The cycle is recorded in the roadmap as merged but unreleased

**What to build:** The repository records this cycle as merged-but-unreleased, so a later reader can see why a third-party catalog page for Gridline exists, what has actually shipped, and what has not. A new development section uses a state the roadmap's own legend already declares. No version statement is added anywhere, so the release-consistency check is untouched.

**Type:** docs

**Blocked by:** 01, 02, 03, 04, 05, 06

**Seams:** None — documentation. Verification is the version-consistency suite staying green and the section reading correctly against what actually merged.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/159
**Tracker state:** done
**Status:** done

- [x] A development section exists above the queue, using the state the roadmap's legend already declares but which previously had no section. — `## 🏗️ In development` (legend: `🏗️ In development`) sits between `## ✅ Shipped (0.9.2)` and `## 📋 In the queue`.
- [x] It records the four fixes as merged but not yet released, naming each issue. — four bullets, one per fix, naming #153, #154 (with #158), #155 and #156.
- [x] It records the catalog listing as third-party indexing that indexes one verified build and promises nothing about any distribution. — `### Third-party catalog listing (pending — not a download route)` says it is a **Catalog Listing**, third-party indexing of one verified build, and not a download route or per-distribution support.
- [x] It carries the cause of the original catalog failure, so the diagnosis survives in this repository rather than only in another project's test log. — the v0.8.1 `AppRun.wrapped` bullet records the `0770 root:root` packaging, the `exec "$this_dir"/AppRun.wrapped` line the catalog's log died on, and 0.9.2 being `0755`.
- [x] It states that the black-window issue remains open, with no root cause identified and no fix shipped. — the `Issue #62` bullet states it remains open with no root cause and no shipped fix, and names what closes it.
- [x] No version-stamped shipped heading and no changelog entry are added. — the roadmap diff adds only the `## 🏗️ In development` section; `www/src/data/changelog.ts` is untouched.
- [x] The version-consistency suite passes without being modified. — `desktop/src/lib/version.test.ts` is unmodified in this cycle's diff and the frontend suite passes.
