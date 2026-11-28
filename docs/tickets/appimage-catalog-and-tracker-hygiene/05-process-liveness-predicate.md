# 05: One process-liveness predicate distinguishes a zombie from a running process

**What to build:** A single shared test-support predicate answers whether a given process is running, distinguishing a process that has exited but has not been reaped from one still executing, on both Unix and Windows. Cancellation tests that wait for a process to die stop reporting an exited process as still alive, so they no longer depend on an init process reaping orphans. A process that is alive but not exiting still reads as alive.

**Type:** bug

**Blocked by:** None (can start immediately)

**Seams:**
- The shared liveness predicate — catches an exited-but-unreaped process reading as not running, a running process reading as alive, and identical verdicts on Unix and Windows; misses real container init behaviour, which cannot be simulated without a container.
- The existing cancellation tests, which are the behaviour that was flaky — they catch the observable symptom end to end; they miss why the platform reaped or did not reap.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/156
**Tracker state:** in_progress
**Status:** in_progress

- [ ] A single shared predicate decides process liveness; the two verbatim copies no longer exist.
- [ ] A process that has exited but is not yet reaped reads as not running on Unix.
- [ ] A process that is running reads as alive, including one that is alive and not exiting.
- [ ] The predicate has defined behaviour on Windows and the cross-platform test matrix exercises it.
- [ ] Cancellation tests that wait for a process to die no longer depend on an init process to reap orphans.
- [ ] The port-reachability helper is unchanged, and the reason it is unrelated is recorded where the predicate is defined.
- [ ] A test asserts that a deliberately created zombie reads as not running.
- [ ] The closing comment on the issue states the corrected cause and records that the loopback tests spawn no child processes.
