# 31: Tool jobs are owned, bounded, and cancellable

**What to build:** Backup, restore, and sync runs can be cancelled, are terminated when the app exits, never hang on a tool probe, and clean up deterministically.

**Blocked by:** None (can start immediately)

**Seams:** Tool-job seam: catches job ownership, cancellation, deadlines, and cleanup; misses some operating-system process-tree differences.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/80
**Status:** ready

- [ ] A running backup or restore can be cancelled from the UI and stops promptly.
- [ ] Cancelling terminates the child process tree, leaving no orphan process.
- [ ] Quitting during a job terminates its children instead of leaving them running.
- [ ] Tool availability and version probes are bounded and fail visibly.
- [ ] A failed job surfaces a visible failure state with a recovery action.
- [ ] A continuously progressing large job is not killed by an arbitrary total-duration limit.
