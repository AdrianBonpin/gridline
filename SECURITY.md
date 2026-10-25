# Security Policy

## Supported versions

Gridline is a desktop database client distributed as a GitHub release. Security fixes land on the latest release line and ship in the next release; only the newest published version is supported.

| Version | Supported |
| :--- | :--- |
| Latest published release (`v0.8.x` at time of writing) | ✅ |
| Anything older | ❌ — please reproduce on the latest release first |

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security problem.** A public report puts every Gridline user at risk before a fix exists. The repository's issue templates and auto-assignment are for ordinary bugs.

### Preferred channel: GitHub private vulnerability reporting

[**Report a vulnerability privately →**](https://github.com/AdrianBonpin/gridline/security/advisories/new)

This opens a private advisory only the maintainer can see. It supports back-and-forth discussion, attaching proof-of-concept files, and crediting you in the published advisory if you want that.

### Fallback channel: email

If you cannot use GitHub, email **adrianbonpin@gmail.com** with `SECURITY` in the subject line. Plain email is not encrypted: send only enough detail to establish contact, and we will move to a private channel before you share an exploit.

### What to include

- The Gridline version and your OS.
- The database engine and version involved (PostgreSQL / MySQL / MariaDB / SQLite).
- Step-by-step reproduction, with the smallest input that triggers it.
- The impact you believe it has, and any proof of concept you can share.

## What to expect

Gridline is maintained by a single developer on a best-effort basis. There is no paid support tier and no formal SLA. In practice:

| Stage | Target |
| :--- | :--- |
| Acknowledgement of your report | within 5 business days |
| Initial assessment (accepted / needs info / out of scope) | within 10 business days |
| Fix released | as soon as practical; you will be told the plan |

We follow **coordinated disclosure**: please give us up to 90 days from acknowledgement before publishing details, and we will publish an advisory (crediting you if you wish) once a fixed release is available. If a fix is taking longer we will say why and agree a new date rather than going silent.

## Scope

**In scope**

- The Gridline desktop application (`desktop/`): the Rust backend, the React frontend, the Tauri configuration, and the bundled `pg_dump` / `pg_restore` / `psql` / `mariadb-dump` / `mariadb` client binaries.
- Credential handling: OS keychain usage, the SSH tunnel, and TLS configuration.
- The release pipeline in `.github/workflows/` — artifact integrity, signing, notarization.
- Anything that lets a malicious database server, dump file, or opened `.sql` file affect the user's machine beyond what the user asked for.

**Out of scope**

- **The destructive-query confirmation dialog is a UX safety net, not an authorization boundary.** Gridline connects with credentials you supply; a user who can run SQL can run SQL. A script that bypasses the *prompt* while the database still enforces its own permissions is a usability bug, not a vulnerability — report it as a normal issue.
- Vulnerabilities that require an already-compromised machine, a malicious local administrator, or physical access.
- Denial of service through intentionally expensive queries, enormous result sets, or a database the user configured to be unreachable.
- Missing hardening with no demonstrated exploit path.
- Vulnerabilities in third-party databases, drivers, or client tools themselves — report those upstream.
- The Gitea mirror at `git.ranio.xyz` is a convenience copy with **no** private reporting facility. Report against GitHub only.

## Safe harbour

We will not pursue or support legal action against researchers who test against their own Gridline installation and their own databases, avoid accessing or exfiltrating other people's data, stop as soon as they have established that a vulnerability exists, and give us a reasonable opportunity to fix the issue before public disclosure.

## Verifying a release

macOS builds are Developer-ID signed and notarized in CI. Verify a downloaded DMG with:

```bash
xcrun stapler validate Gridline_<version>_aarch64.dmg
spctl --assess --type execute /Applications/Gridline.app
```

Windows and Linux installers are currently unsigned, so prefer the official GitHub release page over any mirror.
