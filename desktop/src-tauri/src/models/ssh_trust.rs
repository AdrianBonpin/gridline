use serde::{Deserialize, Serialize};

/// A host key offered by an SSH server, or recorded in a known-hosts entry.
///
/// `blob` is the key exactly as it travels on the wire — the same bytes a
/// known-hosts entry carries in base64 — so identity is a byte comparison
/// rather than a hash comparison.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostKey {
    /// Algorithm name taken from the blob (`ssh-ed25519`, `rsa-sha2-256`, …).
    pub key_type: String,
    /// Raw key blob, base64-decoded.
    pub blob: Vec<u8>,
}

/// The displayable identity of a host key.
///
/// Carries no credentials and no key material, so it is safe to cross the IPC
/// boundary and to show in an enrollment prompt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostKeyFingerprint {
    pub key_type: String,
    /// OpenSSH-style digest: `SHA256:<base64, unpadded>`.
    pub fingerprint: String,
}

/// Where a trusted host key was learned from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustSource {
    /// The user's system known-hosts files, which stay authoritative.
    KnownHosts,
    /// A first-use enrollment Gridline remembered after explicit acceptance.
    Enrolled,
}

/// The trust relationship between Gridline and one SSH endpoint (host + port).
///
/// Three distinct states rather than a boolean: an unknown host needs explicit
/// first-use enrollment, a conflicting key needs deliberate re-enrollment, and
/// only a trusted host may receive credentials.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SshHostTrustState {
    /// The offered key matches a known-hosts entry or an enrolled record.
    Trusted {
        host: String,
        port: u16,
        key_type: String,
        fingerprint: String,
        source: TrustSource,
    },
    /// No trust record exists for this endpoint; authentication is blocked
    /// until the user accepts the fingerprint.
    Unknown {
        host: String,
        port: u16,
        key_type: String,
        fingerprint: String,
    },
    /// The offered key conflicts with the trusted one; authentication is
    /// blocked and re-enrollment is a separate, deliberate action.
    Mismatch {
        host: String,
        port: u16,
        key_type: String,
        fingerprint: String,
        expected_key_type: String,
        expected_fingerprint: String,
        source: TrustSource,
    },
}

impl SshHostTrustState {
    pub fn is_trusted(&self) -> bool {
        matches!(self, SshHostTrustState::Trusted { .. })
    }

    pub fn host(&self) -> &str {
        match self {
            SshHostTrustState::Trusted { host, .. }
            | SshHostTrustState::Unknown { host, .. }
            | SshHostTrustState::Mismatch { host, .. } => host,
        }
    }

    pub fn port(&self) -> u16 {
        match self {
            SshHostTrustState::Trusted { port, .. }
            | SshHostTrustState::Unknown { port, .. }
            | SshHostTrustState::Mismatch { port, .. } => *port,
        }
    }

    /// A display-safe explanation for the connect path. Never contains
    /// credentials — only the endpoint, the key types and the fingerprints.
    pub fn message(&self) -> String {
        match self {
            SshHostTrustState::Trusted {
                host,
                port,
                key_type,
                fingerprint,
                ..
            } => format!("SSH host {host}:{port} is trusted ({key_type} {fingerprint})"),
            SshHostTrustState::Unknown {
                host,
                port,
                key_type,
                fingerprint,
            } => format!(
                "SSH host {host}:{port} is not trusted yet: it offers {key_type} {fingerprint}. \
                 Review and accept its fingerprint before connecting."
            ),
            SshHostTrustState::Mismatch {
                host,
                port,
                key_type,
                fingerprint,
                expected_key_type,
                expected_fingerprint,
                ..
            } => format!(
                "SSH host {host}:{port} presented {key_type} {fingerprint}, but the trusted key is \
                 {expected_key_type} {expected_fingerprint}. Re-enrollment is required before \
                 connecting."
            ),
        }
    }
}

/// A first-use enrollment Gridline remembers.
///
/// Non-secret metadata only: the endpoint, the key identity and when it was
/// accepted. Passwords, private keys and passphrases are never part of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostTrustRecord {
    pub host: String,
    pub port: u16,
    pub key: HostKey,
    pub fingerprint: String,
    pub enrolled_at: String,
}
