//! SSH Host Trust — the ordering and policy that decides whether an SSH server
//! may receive credentials (ADR 0001).
//!
//! Trust comes from two sources, in this order:
//!
//! 1. the user's system known-hosts files (`~/.ssh/known_hosts`,
//!    `/etc/ssh/ssh_known_hosts`), which stay authoritative where present;
//! 2. first-use enrollments Gridline remembers after the user explicitly
//!    accepted a fingerprint.
//!
//! [`establish_trusted_session`] is the only path from a handshake to an
//! authentication attempt: the host key is read and evaluated first, and an
//! unknown or conflicting key returns before any password, private key or
//! passphrase is touched. The [`SshTransport`] seam exists so that ordering is
//! testable with a fake transport, without a live SSH server.
//!
//! Deliberately out of scope for this module: certificate-authority markers
//! (`@cert-authority`) and revocation markers (`@revoked`) in known-hosts
//! files. Marker lines are not treated as trust records, so a server key they
//! cover falls back to an explicit first-use enrollment prompt.

use crate::models::ssh_trust::{
    HostKey, HostKeyFingerprint, HostTrustRecord, SshHostTrustState, TrustSource,
};
use crate::models::SshConfig;
use crate::store::Store;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// The SSH port that known-hosts writes without a port qualifier.
const SSH_DEFAULT_PORT: u16 = 22;

pub fn b64_encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn b64_decode(text: &str) -> Option<Vec<u8>> {
    base64::engine::general_purpose::STANDARD.decode(text).ok()
}

/// The name an endpoint is keyed by, in known-hosts syntax.
///
/// Non-default ports are bracketed so an entry for `host:22` can never
/// authorize `host:2222` (or the reverse).
pub fn known_hosts_name(host: &str, port: u16) -> String {
    if port == SSH_DEFAULT_PORT {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

/// OpenSSH-style `SHA256:<base64, unpadded>` fingerprint of a key blob.
pub fn fingerprint_of(blob: &[u8]) -> String {
    let digest = Sha256::digest(blob);
    format!(
        "SHA256:{}",
        base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest)
    )
}

/// Read the algorithm name out of a key blob.
///
/// The SSH wire format starts a key (or a certificate) with `u32 length` +
/// ASCII algorithm name, which is exactly what known-hosts stores in its second
/// column. Malformed blobs are rejected rather than guessed at.
pub fn host_key_from_blob(blob: &[u8]) -> Result<HostKey, String> {
    if blob.len() < 4 {
        return Err("host key blob is too short".to_string());
    }
    let len = u32::from_be_bytes([blob[0], blob[1], blob[2], blob[3]]) as usize;
    if len == 0 || len > 64 || blob.len() < 4 + len {
        return Err("host key blob has an invalid algorithm name".to_string());
    }
    let name = std::str::from_utf8(&blob[4..4 + len])
        .map_err(|_| "host key algorithm name is not UTF-8".to_string())?;
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '@' | '_' | '+'))
    {
        return Err("host key algorithm name is malformed".to_string());
    }
    Ok(HostKey {
        key_type: name.to_string(),
        blob: blob.to_vec(),
    })
}

/// One trust entry from a known-hosts file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnownHostsEntry {
    /// Host patterns this entry applies to (`host`, `host,ip`, `*.example.com`,
    /// `[host]:port`, or a `|1|salt|hash` hashed name).
    pub patterns: Vec<String>,
    pub key: HostKey,
}

/// Parse known-hosts content.
///
/// Comments, blank lines, malformed lines and `@`-marker lines are skipped:
/// only plain `host[,host] keytype base64key` records establish trust here.
pub fn parse_known_hosts(content: &str) -> Vec<KnownHostsEntry> {
    let mut entries = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        let mut fields = line.split_whitespace();
        let (Some(hosts), Some(key_type), Some(key_b64)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let Some(blob) = b64_decode(key_b64) else {
            continue;
        };
        let Ok(key) = host_key_from_blob(&blob) else {
            continue;
        };
        // The text column must agree with the blob it claims to describe.
        if key.key_type != key_type {
            continue;
        }
        entries.push(KnownHostsEntry {
            patterns: hosts.split(',').map(str::to_string).collect(),
            key,
        });
    }
    entries
}

/// Does any of `patterns` match the endpoint `name` (`host` or `[host]:port`)?
pub fn patterns_match(patterns: &[String], name: &str) -> bool {
    patterns.iter().any(|p| pattern_matches(p, name))
}

fn pattern_matches(pattern: &str, name: &str) -> bool {
    if let Some(hashed) = pattern.strip_prefix("|1|") {
        return hashed_pattern_matches(hashed, name);
    }
    glob_matches(pattern.as_bytes(), name.as_bytes())
}

/// `HashKnownHosts` entries: `|1|<base64 salt>|<base64 HMAC-SHA1(name)>`.
fn hashed_pattern_matches(rest: &str, name: &str) -> bool {
    let mut parts = rest.splitn(2, '|');
    let (Some(salt), Some(expected)) = (parts.next(), parts.next()) else {
        return false;
    };
    let (Some(salt), Some(expected)) = (b64_decode(salt), b64_decode(expected)) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(&salt) else {
        return false;
    };
    mac.update(name.as_bytes());
    mac.verify_slice(&expected).is_ok()
}

/// Shell-style `*` / `?` glob match, case-insensitive (host names are).
fn glob_matches(pattern: &[u8], name: &[u8]) -> bool {
    let (mut p, mut n) = (0usize, 0usize);
    let (mut star, mut mark) = (None, 0usize);
    while n < name.len() {
        if p < pattern.len() && (pattern[p] == b'?' || pattern[p].eq_ignore_ascii_case(&name[n])) {
            p += 1;
            n += 1;
        } else if p < pattern.len() && pattern[p] == b'*' {
            star = Some(p);
            p += 1;
            mark = n;
        } else if let Some(star_pos) = star {
            p = star_pos + 1;
            mark += 1;
            n = mark;
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == b'*' {
        p += 1;
    }
    p == pattern.len()
}

/// Evaluate the offered host key against known hosts and enrolled records.
///
/// Precedence matters: a known-hosts entry for this endpoint and key type is
/// authoritative, so a first-use record can never quietly override the user's
/// own SSH configuration.
pub fn evaluate_host_trust(
    host: &str,
    port: u16,
    offered: &HostKey,
    known_hosts: &[KnownHostsEntry],
    record: Option<&HostTrustRecord>,
) -> SshHostTrustState {
    let name = known_hosts_name(host, port);
    let offered_fingerprint = fingerprint_of(&offered.blob);

    let matching: Vec<&KnownHostsEntry> = known_hosts
        .iter()
        .filter(|entry| {
            entry.key.key_type == offered.key_type && patterns_match(&entry.patterns, &name)
        })
        .collect();

    if matching.iter().any(|entry| entry.key.blob == offered.blob) {
        return SshHostTrustState::Trusted {
            host: host.to_string(),
            port,
            key_type: offered.key_type.clone(),
            fingerprint: offered_fingerprint,
            source: TrustSource::KnownHosts,
        };
    }
    if let Some(entry) = matching.first() {
        return SshHostTrustState::Mismatch {
            host: host.to_string(),
            port,
            key_type: offered.key_type.clone(),
            fingerprint: offered_fingerprint,
            expected_key_type: entry.key.key_type.clone(),
            expected_fingerprint: fingerprint_of(&entry.key.blob),
            source: TrustSource::KnownHosts,
        };
    }

    if let Some(record) = record {
        if record.key.key_type == offered.key_type && record.key.blob == offered.blob {
            return SshHostTrustState::Trusted {
                host: host.to_string(),
                port,
                key_type: offered.key_type.clone(),
                fingerprint: offered_fingerprint,
                source: TrustSource::Enrolled,
            };
        }
        return SshHostTrustState::Mismatch {
            host: host.to_string(),
            port,
            key_type: offered.key_type.clone(),
            fingerprint: offered_fingerprint,
            expected_key_type: record.key.key_type.clone(),
            expected_fingerprint: record.fingerprint.clone(),
            source: TrustSource::Enrolled,
        };
    }

    SshHostTrustState::Unknown {
        host: host.to_string(),
        port,
        key_type: offered.key_type.clone(),
        fingerprint: offered_fingerprint,
    }
}

/// Persistence and system known-hosts access for host trust.
///
/// Faked in tests; the real implementation is [`StoreHostTrust`].
pub trait HostTrustProvider: Send + Sync {
    fn known_hosts(&self) -> Vec<KnownHostsEntry>;
    fn lookup(&self, host: &str, port: u16) -> Result<Option<HostTrustRecord>, String>;
    fn remember(&self, record: &HostTrustRecord) -> Result<(), String>;
    /// Forget a record so the next connection re-enrolls. Used by deliberate
    /// re-enrollment, never by an authentication attempt.
    fn forget(&self, host: &str, port: u16) -> Result<(), String>;
}

/// The trust store backed by the local SQLite store + system known-hosts files.
pub struct StoreHostTrust {
    store: Arc<Mutex<Store>>,
    known_hosts_paths: Vec<PathBuf>,
}

impl StoreHostTrust {
    pub fn new(store: Arc<Mutex<Store>>) -> Self {
        StoreHostTrust {
            store,
            known_hosts_paths: default_known_hosts_paths(),
        }
    }

    /// Override the known-hosts files (tests, and platforms without `$HOME`).
    pub fn with_known_hosts_paths(store: Arc<Mutex<Store>>, paths: Vec<PathBuf>) -> Self {
        StoreHostTrust {
            store,
            known_hosts_paths: paths,
        }
    }
}

impl HostTrustProvider for StoreHostTrust {
    fn known_hosts(&self) -> Vec<KnownHostsEntry> {
        read_known_hosts_files(&self.known_hosts_paths)
    }

    fn lookup(&self, host: &str, port: u16) -> Result<Option<HostTrustRecord>, String> {
        let store = self.store.lock().map_err(|e| e.to_string())?;
        store.get_ssh_host_trust(host, port)
    }

    fn remember(&self, record: &HostTrustRecord) -> Result<(), String> {
        let store = self.store.lock().map_err(|e| e.to_string())?;
        store.remember_ssh_host_trust(record)
    }

    fn forget(&self, host: &str, port: u16) -> Result<(), String> {
        let store = self.store.lock().map_err(|e| e.to_string())?;
        store.forget_ssh_host_trust(host, port)
    }
}

/// `~/.ssh/known_hosts` plus `/etc/ssh/ssh_known_hosts` on Unix.
pub fn default_known_hosts_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    if let Some(home) = home {
        paths.push(PathBuf::from(home).join(".ssh").join("known_hosts"));
    }
    #[cfg(unix)]
    paths.push(PathBuf::from("/etc/ssh/ssh_known_hosts"));
    paths
}

/// Read and parse every readable known-hosts file. Missing files are normal.
pub fn read_known_hosts_files(paths: &[PathBuf]) -> Vec<KnownHostsEntry> {
    let mut entries = Vec::new();
    for path in paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            entries.extend(parse_known_hosts(&content));
        }
    }
    entries
}

/// The pre-authentication operations of an SSH session.
///
/// Kept deliberately small: handshake, host key, authentication. The real
/// implementation wraps `ssh2::Session`; tests use a fake that records the
/// order of operations, which is how "nothing is sent before verification" is
/// asserted.
pub trait SshTransport {
    /// Complete the key exchange. Sends no credentials.
    fn handshake(&mut self) -> Result<(), String>;
    /// The host key offered by the server. Only meaningful after `handshake`.
    fn host_key(&mut self) -> Result<HostKey, String>;
    fn authenticate_password(&mut self, user: &str, password: &str) -> Result<(), String>;
    fn authenticate_key(
        &mut self,
        user: &str,
        private_key_path: &Path,
        passphrase: Option<&str>,
    ) -> Result<(), String>;
    /// Whether the session now considers itself authenticated.
    fn authenticated(&self) -> bool;
}

/// Why an SSH tunnel could not be opened.
///
/// The host-trust variants carry the full state so a caller can show the
/// fingerprint and offer enrollment instead of a dead end.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SshTunnelError {
    /// Handshake, key read or authentication failed.
    Failed(String),
    /// The host key is not trusted yet: authentication was not attempted.
    HostKeyUnknown(SshHostTrustState),
    /// The host key conflicts with the trusted one: authentication was not
    /// attempted, and an in-authentication override is not offered.
    HostKeyMismatch(SshHostTrustState),
}

impl SshTunnelError {
    /// Display-safe text for the connect path.
    pub fn message(&self) -> String {
        match self {
            SshTunnelError::Failed(message) => message.clone(),
            SshTunnelError::HostKeyUnknown(state) | SshTunnelError::HostKeyMismatch(state) => {
                state.message()
            }
        }
    }

    /// The trust state that stopped the connection, if that is why it stopped.
    pub fn host_trust(&self) -> Option<&SshHostTrustState> {
        match self {
            SshTunnelError::Failed(_) => None,
            SshTunnelError::HostKeyUnknown(state) | SshTunnelError::HostKeyMismatch(state) => {
                Some(state)
            }
        }
    }
}

impl std::fmt::Display for SshTunnelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

/// Handshake, read the offered host key, and evaluate its trust.
///
/// The one ordering path shared by probing, enrollment and connection setup, so
/// nothing can authenticate without passing through [`evaluate_host_trust`].
/// Sends no credentials.
fn read_and_evaluate(
    transport: &mut dyn SshTransport,
    trust: &dyn HostTrustProvider,
    host: &str,
    port: u16,
) -> Result<(SshHostTrustState, HostKey), String> {
    transport.handshake()?;
    let key = transport.host_key()?;
    let known_hosts = trust.known_hosts();
    let record = trust.lookup(host, port)?;
    let state = evaluate_host_trust(host, port, &key, &known_hosts, record.as_ref());
    Ok((state, key))
}

/// Read the offered host key and report its trust. Sends no credentials.
pub fn probe_host_trust(
    transport: &mut dyn SshTransport,
    trust: &dyn HostTrustProvider,
    host: &str,
    port: u16,
) -> Result<SshHostTrustState, String> {
    Ok(read_and_evaluate(transport, trust, host, port)?.0)
}

/// Remember an explicitly accepted fingerprint for one endpoint.
///
/// Re-reads the offered key instead of trusting the caller's copy: a server
/// that switched keys between the prompt and the acceptance is refused, and a
/// key that conflicts with existing trust is never replaced here (ADR 0001
/// makes replacing trust a separate re-enrollment action).
pub fn enroll_host_trust(
    transport: &mut dyn SshTransport,
    trust: &dyn HostTrustProvider,
    host: &str,
    port: u16,
    accepted: &HostKeyFingerprint,
) -> Result<SshHostTrustState, String> {
    let (state, key) = read_and_evaluate(transport, trust, host, port)?;
    if let SshHostTrustState::Mismatch { .. } = &state {
        return Err(format!("{} Nothing was trusted.", state.message()));
    }
    if state.is_trusted() {
        // Already trusted (e.g. by known_hosts): nothing to remember.
        return Ok(state);
    }
    let offered = HostKeyFingerprint {
        key_type: key.key_type.clone(),
        fingerprint: fingerprint_of(&key.blob),
    };
    if offered.key_type != accepted.key_type || offered.fingerprint != accepted.fingerprint {
        return Err(format!(
            "the SSH server now offers a different host key ({} {}) than the accepted {} {}. \
             Nothing was trusted.",
            offered.key_type, offered.fingerprint, accepted.key_type, accepted.fingerprint
        ));
    }
    let record = HostTrustRecord {
        host: host.to_string(),
        port,
        key,
        fingerprint: offered.fingerprint.clone(),
        enrolled_at: chrono::Utc::now().to_rfc3339(),
    };
    trust.remember(&record)?;
    Ok(SshHostTrustState::Trusted {
        host: host.to_string(),
        port,
        key_type: record.key.key_type,
        fingerprint: record.fingerprint,
        source: TrustSource::Enrolled,
    })
}

/// Handshake, verify the host key, and only then authenticate.
///
/// This is the whole point of ticket 21: no password, private key or passphrase
/// is touched until [`evaluate_host_trust`] reports `Trusted`.
pub fn establish_trusted_session(
    transport: &mut dyn SshTransport,
    trust: &dyn HostTrustProvider,
    cfg: &SshConfig,
    password: Option<&str>,
    passphrase: Option<&str>,
) -> Result<SshHostTrustState, SshTunnelError> {
    let (state, _key) =
        read_and_evaluate(transport, trust, &cfg.host, cfg.port).map_err(SshTunnelError::Failed)?;

    if let SshHostTrustState::Unknown { .. } = &state {
        return Err(SshTunnelError::HostKeyUnknown(state));
    }
    if let SshHostTrustState::Mismatch { .. } = &state {
        return Err(SshTunnelError::HostKeyMismatch(state));
    }

    // Trusted from here on: credentials may leave the machine.
    match cfg.auth_method.as_str() {
        "key" => {
            let path = cfg.private_key_path.as_deref().ok_or_else(|| {
                SshTunnelError::Failed("private_key_path required for key auth".to_string())
            })?;
            transport
                .authenticate_key(&cfg.user, Path::new(path), passphrase)
                .map_err(SshTunnelError::Failed)?;
        }
        _ => transport
            .authenticate_password(&cfg.user, password.unwrap_or(""))
            .map_err(SshTunnelError::Failed)?,
    }
    if !transport.authenticated() {
        return Err(SshTunnelError::Failed(
            "SSH authentication failed".to_string(),
        ));
    }
    Ok(state)
}

/// Test doubles for the host-trust seam: a transport that records the order of
/// operations and a trust provider with in-memory known hosts and records.
#[cfg(test)]
pub mod fake {
    use super::*;
    use std::sync::Mutex;

    /// One recorded transport operation, in call order.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum TransportOp {
        Handshake,
        HostKey,
        PasswordAuth {
            user: String,
            password: String,
        },
        KeyAuth {
            user: String,
            path: String,
            passphrase: Option<String>,
        },
    }

    /// A fake SSH session: no network, records what happened in what order.
    pub struct FakeTransport {
        key: Option<HostKey>,
        pub ops: Vec<TransportOp>,
        handshake_error: Option<String>,
        authenticated: bool,
    }

    impl FakeTransport {
        pub fn offering(key: HostKey) -> Self {
            FakeTransport {
                key: Some(key),
                ops: Vec::new(),
                handshake_error: None,
                authenticated: false,
            }
        }

        pub fn fail_handshake(&mut self, message: &str) {
            self.handshake_error = Some(message.to_string());
        }

        /// Did any credential-bearing operation happen?
        pub fn saw_credentials(&self) -> bool {
            self.ops.iter().any(|op| {
                matches!(
                    op,
                    TransportOp::PasswordAuth { .. } | TransportOp::KeyAuth { .. }
                )
            })
        }
    }

    impl SshTransport for FakeTransport {
        fn handshake(&mut self) -> Result<(), String> {
            self.ops.push(TransportOp::Handshake);
            match &self.handshake_error {
                Some(message) => Err(message.clone()),
                None => Ok(()),
            }
        }

        fn host_key(&mut self) -> Result<HostKey, String> {
            self.ops.push(TransportOp::HostKey);
            self.key
                .clone()
                .ok_or_else(|| "no host key was offered".to_string())
        }

        fn authenticate_password(&mut self, user: &str, password: &str) -> Result<(), String> {
            self.ops.push(TransportOp::PasswordAuth {
                user: user.to_string(),
                password: password.to_string(),
            });
            self.authenticated = true;
            Ok(())
        }

        fn authenticate_key(
            &mut self,
            user: &str,
            private_key_path: &Path,
            passphrase: Option<&str>,
        ) -> Result<(), String> {
            self.ops.push(TransportOp::KeyAuth {
                user: user.to_string(),
                path: private_key_path.to_string_lossy().to_string(),
                passphrase: passphrase.map(str::to_string),
            });
            self.authenticated = true;
            Ok(())
        }

        fn authenticated(&self) -> bool {
            self.authenticated
        }
    }

    /// A fake trust provider: known-hosts content plus enrolled records.
    #[derive(Default)]
    pub struct FakeHostTrust {
        known_hosts: Mutex<Vec<KnownHostsEntry>>,
        records: Mutex<Vec<HostTrustRecord>>,
    }

    impl FakeHostTrust {
        pub fn add_known_hosts(&mut self, content: &str) {
            self.known_hosts
                .lock()
                .unwrap()
                .extend(parse_known_hosts(content));
        }

        pub fn add_record(&mut self, record: HostTrustRecord) {
            self.records.lock().unwrap().push(record);
        }

        pub fn records(&self) -> Vec<HostTrustRecord> {
            self.records.lock().unwrap().clone()
        }
    }

    impl HostTrustProvider for FakeHostTrust {
        fn known_hosts(&self) -> Vec<KnownHostsEntry> {
            self.known_hosts.lock().unwrap().clone()
        }

        fn lookup(&self, host: &str, port: u16) -> Result<Option<HostTrustRecord>, String> {
            Ok(self
                .records
                .lock()
                .unwrap()
                .iter()
                .find(|r| r.host == host && r.port == port)
                .cloned())
        }

        fn remember(&self, record: &HostTrustRecord) -> Result<(), String> {
            let mut records = self.records.lock().unwrap();
            records.retain(|r| !(r.host == record.host && r.port == record.port));
            records.push(record.clone());
            Ok(())
        }

        fn forget(&self, host: &str, port: u16) -> Result<(), String> {
            self.records
                .lock()
                .unwrap()
                .retain(|r| !(r.host == host && r.port == port));
            Ok(())
        }
    }
}

#[cfg(test)]
#[path = "ssh_trust.test.rs"]
mod tests;
