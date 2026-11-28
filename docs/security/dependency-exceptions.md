# Dependency advisory exceptions

Gridline's dependency trees are audited in CI by [`scripts/check-advisories.py`](../../scripts/check-advisories.py),
which runs three audits on every pull request:

| Tree | Lockfile | Audit |
| :--- | :--- | :--- |
| Desktop + website workspace (Bun) | `bun.lock` | `bun audit` — this is also the graph the website deploy installs (the site is built from the repository root) |
| Website standalone (an isolated `www/` build) | `www/bun.lock` | `bun audit` in an isolated install of `www/package.json` |
| Rust backend | `desktop/src-tauri/Cargo.lock` | `cargo audit` |

The check **fails** when an advisory is reported that is not listed below, so a new
unreviewed finding cannot land. It also fails when a listed exception has passed its
review date, or when a listed exception no longer matches any finding (the list must
not accumulate entries that hide nothing).

Nothing here suppresses an advisory in the audit itself: the audits run unmodified and
their raw output is what the check compares against. An entry below means "a human
looked at this specific advisory for this specific package and decided the risk is
acceptable for a stated reason, until a stated date".

## How updates arrive

[`.github/dependabot.yml`](../../.github/dependabot.yml) opens weekly update pull requests
against `prod`, one entry per graph above, and every entry groups its updates —
minor/patch into one pull request and majors into another (Dependabot runs each
`update-types` bucket as its own group). A week's majors therefore arrive as one
reviewable pull request per graph instead of one per package, so a fix upstream reaches
the repository as a reviewed change rather than as a tag-time surprise. Two gaps are
deliberate and handled elsewhere:

- **`overrides` are not updated by Dependabot.** The root `dompurify` / `fflate` floors and
the website's `fflate` floor are bumped by hand when a review or this gate says so.
- **A legacy binary `bun.lockb` cannot be updated at all.** `scripts/check-lockfiles.sh`, in
the same required `checks` job, fails if either JavaScript lockfile stops being a text
`bun.lock` or stops describing its manifest.

Independently of Dependabot, this check also runs on the nightly CI schedule: an advisory
published after a green pull request still fails the next run, which is why a night on the
schedule is part of the release gate rather than a report.

## Exception discipline

- Every entry names an **owner** (a GitHub handle) and a **review date** no more than
  six months out. The check fails on the first day after `review_by`.
- Every entry states **why it is not exploitable or not fixable now**, in terms of
  Gridline's actual dependency graph — "upstream has no fixed release", "the crate is
  build-time only on a platform we ship", "the vulnerable API is never called".
- An entry is removed as soon as the dependency is upgraded or replaced; leaving it in
  place fails the check, which is deliberate.
- Reviewing an entry means: re-read the advisory, re-check whether upstream has
  published a fix or a replacement, re-check whether the dependency is still in the
  graph, then either delete the entry or update `review_by` with a fresh rationale.
- Vulnerability details that are not public yet must not be written here. This file is
  public; it records dependency risk decisions, not exploit research.

## Current exceptions

At the time of writing the **JavaScript** trees (workspace and standalone website) have
**no** open advisories, so there are no JavaScript exceptions. The entries below are
all Rust warnings that `cargo audit` reports with **no fixed upgrade available** or
that cannot be upgraded without an upstream release Gridline does not control.

| Advisory | Crate | Kind | Blocks on |
| :--- | :--- | :--- | :--- |
| RUSTSEC-2024-0370 | `proc-macro-error` 1.0.4 | unmaintained | gtk-rs 0.18 (Linux, Tauri) |
| RUSTSEC-2024-0429 | `glib` 0.18.5 | unsound | gtk-rs 0.18 (Linux, Tauri) |
| RUSTSEC-2025-0134 | `rustls-pemfile` 2.2.0 | unmaintained | our own PEM parsing + `rustls-native-certs` 0.7 |
| RUSTSEC-2026-0370 | `zvariant` 5.15.1 | unmaintained | zbus 5.x (Linux, Tauri plugins) |
| RUSTSEC-2026-0371 | `zbus_names` 4.3.5 | unmaintained | zbus 5.x (Linux, Tauri plugins) |
| RUSTSEC-2026-0372 | `zvariant_derive` 5.15.1 | unmaintained | zbus 5.x (Linux, Tauri plugins) |
| RUSTSEC-2026-0543 | `chrono` 0.4.45 | unmaintained | our own timestamps + `tokio-postgres` + `sqlx` |

Two clusters dominate: the **gtk-rs 0.18 stack** that Tauri 2.12 pins for Linux
(`glib`, `glib-macros` → `proc-macro-error`), and the **zbus 5.x stack** pulled by
`tauri-plugin-opener` / `tauri-plugin-single-instance` / the Linux secret-service
keyring for the same platform. Neither can be moved by editing Gridline's manifest:
their versions are selected by the Tauri release, and the current Tauri release is the
newest published one.

<!-- advisories:exceptions
     Canonical machine-readable list. scripts/check-advisories.py reads the JSON block
     below and nothing else. Keep the prose above and this list in step.
-->
```json
{
  "exceptions": [
    {
      "advisory": "RUSTSEC-2024-0370",
      "ecosystem": "cargo",
      "package": "proc-macro-error",
      "kind": "unmaintained",
      "owner": "AdrianBonpin",
      "review_by": "2027-05-21",
      "rationale": "Build-time proc-macro reached only through glib-macros 0.18 -> glib 0.18 as part of the gtk-rs stack Tauri 2.12 pins for Linux. The advisory records that the crate is unmaintained; it describes no vulnerability. It disappears when Tauri moves to gtk-rs 0.20, which no published Tauri release does yet, and it is compiled only for Linux builds."
    },
    {
      "advisory": "RUSTSEC-2024-0429",
      "ecosystem": "cargo",
      "package": "glib",
      "kind": "unsound",
      "owner": "AdrianBonpin",
      "review_by": "2027-05-21",
      "rationale": "Linux-only: glib 0.18.5 arrives through gtk 0.18 (tauri, tao, muda, webkit2gtk). The fixed release is glib 0.20, which the gtk-rs 0.18 crates Tauri 2.12 requires cannot use, so no upgrade exists for us. The unsoundness is in glib's Iterator/DoubleEndedIterator impls for VariantStrIter; Gridline's Rust code never calls glib (no glib item is referenced under desktop/src-tauri/src), so the affected API is unreachable."
    },
    {
      "advisory": "RUSTSEC-2025-0134",
      "ecosystem": "cargo",
      "package": "rustls-pemfile",
      "kind": "unmaintained",
      "owner": "AdrianBonpin",
      "review_by": "2027-02-21",
      "rationale": "Reached twice: directly from db/tls.rs (CA bundle, client certificate and client key PEM parsing) and transitively from rustls-native-certs 0.7. The advisory records that the crate is unmaintained and names rustls-pki-types' pem feature as the replacement; there is no fixed version of rustls-pemfile itself. The replacement plus rustls-native-certs 0.8 is a scoped follow-up that rewrites the TLS client-auth path, which the current release cycle deliberately leaves to the TLS workstream rather than mixing into the dependency upgrade. No vulnerability is described by this advisory."
    },
    {
      "advisory": "RUSTSEC-2026-0370",
      "ecosystem": "cargo",
      "package": "zvariant",
      "kind": "unmaintained",
      "owner": "AdrianBonpin",
      "review_by": "2027-05-21",
      "rationale": "Linux-only D-Bus serialisation reached through zbus 5.x, pulled by tauri-plugin-opener, tauri-plugin-single-instance and the Linux secret-service keyring. The advisory records that the crate is unmaintained; it describes no vulnerability. The version is selected by the newest published Tauri plugin releases, so Gridline cannot move it."
    },
    {
      "advisory": "RUSTSEC-2026-0371",
      "ecosystem": "cargo",
      "package": "zbus_names",
      "kind": "unmaintained",
      "owner": "AdrianBonpin",
      "review_by": "2027-05-21",
      "rationale": "Part of the same Linux-only zbus 5.x stack as RUSTSEC-2026-0370 (tauri-plugin-opener / tauri-plugin-single-instance / secret-service keyring). Unmaintained notice with no vulnerability described and no fixed release; the version follows the Tauri plugin releases."
    },
    {
      "advisory": "RUSTSEC-2026-0372",
      "ecosystem": "cargo",
      "package": "zvariant_derive",
      "kind": "unmaintained",
      "owner": "AdrianBonpin",
      "review_by": "2027-05-21",
      "rationale": "Proc-macro half of the same Linux-only zbus 5.x stack as RUSTSEC-2026-0370 and RUSTSEC-2026-0371. Unmaintained notice with no vulnerability described and no fixed release; the version follows the Tauri plugin releases."
    },
    {
      "advisory": "RUSTSEC-2026-0543",
      "ecosystem": "cargo",
      "package": "chrono",
      "kind": "unmaintained",
      "owner": "AdrianBonpin",
      "review_by": "2027-05-21",
      "rationale": "chrono is a direct dependency (local-store timestamps, query history, demo data) and is also required by postgres-types (via tokio-postgres) and sqlx, so it cannot leave the dependency graph by editing Gridline's manifest. The advisory records that the crate is unmaintained and has no fixed release. Gridline uses only DateTime/Utc formatting and serde derives, not the APIs that would need a security review. Follow-up: move our own uses to the driver-supported replacement once sqlx and tokio-postgres do."
    }
  ]
}
```

## Adding an entry

1. Confirm the finding is real for this repository (`./scripts/check-advisories.py`
   prints the exact advisory, package and tree).
2. Check whether a patched version, a replacement crate, or an upstream release that
   would carry one exists. If a fix exists, fix it — an exception is not a fix.
3. Add the entry to the JSON block with an owner, a review date at most six months out,
   and a rationale tied to Gridline's graph.
4. Add the row to the table above.
