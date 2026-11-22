# 31: Tool jobs are owned, bounded, and cancellable

**What to build:** Backup, restore, and sync runs can be cancelled, are terminated when the app exits, never hang on a tool probe, and clean up deterministically.

**Blocked by:** None (can start immediately)

**Seams:** Tool-job seam: catches job ownership, cancellation, deadlines, and cleanup; misses some operating-system process-tree differences.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/80
**Status:** done

- [x] A running backup or restore can be cancelled from the UI and stops promptly.
- [x] Cancelling terminates the child process tree, leaving no orphan process.
- [x] Quitting during a job terminates its children instead of leaving them running.
- [x] Tool availability and version probes are bounded and fail visibly.
- [x] A failed job surfaces a visible failure state with a recovery action.
- [x] A continuously progressing large job is not killed by an arbitrary total-duration limit.
