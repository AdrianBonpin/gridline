# 43: One release pipeline with least trust

**What to build:** There is exactly one release pipeline, its refs are protected, and the trust granted to its build inputs and metadata is minimal.

**Blocked by:** None (can start immediately)

**Seams:** Built-product seam: catches workflow and repository configuration; the protection rules themselves are repository settings that must be verified in the tracker.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/88
**Status:** ready

- [ ] The mirror release workflow is removed while code mirroring keeps working.
- [ ] Release refs are protected, immutable, reachable from reviewed default-branch history, and gated on required checks.
- [ ] Third-party actions are pinned to immutable revisions.
- [ ] Workflow tokens are scoped to the jobs that need them.
- [ ] Tag metadata is passed as data or environment values, never interpolated into query programs or template bodies.
