# 0001: Verify SSH host trust with known hosts and explicit first-use enrollment

**Status:** Accepted
**Date:** 2026-11-21

## Context

Gridline's SSH tunnels carry database traffic and may use password or private-key authentication. Encryption alone does not establish that the intended SSH server received those credentials. Strict reliance on a pre-populated known-hosts file is safe but makes legitimate first-time connections difficult; accepting every unknown or changed key is convenient but fails to establish server identity. The trust decision must be consistent across interactive connection tests and long-lived tunnels, and it must survive application restarts without storing credentials in Gridline's local database.

## Decision

Gridline verifies the SSH host key before authentication. It honors matching system known-hosts entries, including entries for non-standard ports. For an unknown host, Gridline displays the host and key fingerprint and requires explicit user acceptance before remembering that trust decision. A key that conflicts with an existing trusted entry fails closed; changing trust requires a deliberate re-enrollment action rather than an override during authentication. Gridline may supplement system known hosts with per-connection trust records for hosts the user accepts through this flow.

## Consequences

Users receive a clear first-use enrollment step and can safely connect without manually editing known-hosts files. Repeated connections can verify the same identity, and unexpected key changes become visible instead of silently succeeding. The application must persist non-secret host-trust metadata, keep fingerprint presentation consistent across platforms, and provide a deliberate way to replace stale trust after a legitimate server-key rotation. Unknown or mismatched hosts require user intervention, so setup is less automatic than implicit trust. No password, private key, or passphrase becomes part of the trust record.
