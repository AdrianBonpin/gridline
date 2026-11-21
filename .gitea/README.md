# Gitea mirror (code only)

This directory is intentionally empty of workflows.

Gitea (`git.ranio.xyz/adrianbonpin/gridline`, remote `origin`) is a
**just-in-case copy of the code**, not a release channel:

- `scripts/mirror-gitea.sh` mirrors the `prod` branch and every tag there, and
  `scripts/hooks/{pre-push,post-merge}` (installed by
  `scripts/install-git-hooks.sh`) run it automatically.
- There is **no** Gitea Actions workflow. GitHub Actions
  (`.github/workflows/release.yml`) is the single release pipeline, so the
  release controls (pinned actions, scoped tokens, tag protection, signing)
  have exactly one place to hold.

Do not add a workflow here that builds, signs or publishes anything: a second
pipeline would double the trusted surface and let an artifact ship outside the
GitHub release gate. `scripts/check-workflows.sh` fails if a workflow reappears
under this directory.
