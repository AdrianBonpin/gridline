# 47: Dependency advisories remediated with governed exceptions

**What to build:** Patched JavaScript and Rust advisories are upgraded, reachable unsound or yanked packages are addressed, and what remains is a governed, reviewed exception list rather than a suppressed report.

**Blocked by:** None (can start immediately)

**Seams:** Built-product seam: catches audits, production builds, and both test suites; sensitive details stay in the private advisory channel.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/90
**Status:** ready

- [ ] Every patched advisory in the JavaScript and Rust trees is upgraded.
- [ ] Reachable unsound or yanked dependencies are upgraded or replaced.
- [ ] Each remaining warning has an owner, a rationale, and a review date.
- [ ] Unreviewed new advisories fail the check.
- [ ] Desktop and website production builds and test suites pass after the upgrades.
