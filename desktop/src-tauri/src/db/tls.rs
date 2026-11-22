//! TLS mode parsing, fail-closed mode resolution, and connection planning.
//!
//! Maps the user-facing SSL modes to rustls `ClientConfig` values:
//! - `disable` -> no TLS (returns `None`)
//! - `require` -> encrypt without verifying the server certificate (custom `NoVerifier`)
//! - `verify-ca` / `verify-full` -> standard rustls webpki verification (chain AND
//!   hostname; `verify-ca` is intentionally identical to `verify-full` in v1)
//!
//! Only the four modes above are accepted. An unrecognized non-empty mode is an
//! error naming the valid set — it never falls back to plaintext. An absent (or
//! blank) mode keeps the documented defaults: `disable`, except for managed
//! providers that refuse plaintext, which default to `require`.
//!
//! Client certificates are supported via optional `cert_path` / `key_path` pair.

use std::net::IpAddr;
use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsDecision {
    Disable,
    Require,
    Verify,
}

/// Every TLS mode Gridline accepts, in the spelling the UI, the store, and
/// transfer files use.
pub const VALID_SSL_MODES: [&str; 4] = ["disable", "require", "verify-ca", "verify-full"];

/// A validated TLS mode.
///
/// The only way to obtain one is [`SslMode::parse`] / [`parse_ssl_mode`], so an
/// unrecognized value cannot reach a connection attempt as "plaintext by
/// accident".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SslMode {
    Disable,
    Require,
    VerifyCa,
    VerifyFull,
}

impl SslMode {
    /// Parse one mode name exactly as Gridline spells it (`disable`, `require`,
    /// `verify-ca`, `verify-full`). Anything else is an error naming the set.
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "disable" => Ok(SslMode::Disable),
            "require" => Ok(SslMode::Require),
            "verify-ca" => Ok(SslMode::VerifyCa),
            "verify-full" => Ok(SslMode::VerifyFull),
            other => Err(unknown_ssl_mode(other)),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            SslMode::Disable => "disable",
            SslMode::Require => "require",
            SslMode::VerifyCa => "verify-ca",
            SslMode::VerifyFull => "verify-full",
        }
    }

    pub fn decision(self) -> TlsDecision {
        match self {
            SslMode::Disable => TlsDecision::Disable,
            SslMode::Require => TlsDecision::Require,
            SslMode::VerifyCa | SslMode::VerifyFull => TlsDecision::Verify,
        }
    }

    /// Whether this mode authenticates the server's certificate.
    pub fn verifies_certificate(self) -> bool {
        matches!(self, SslMode::VerifyCa | SslMode::VerifyFull)
    }
}

fn unknown_ssl_mode(raw: &str) -> String {
    format!(
        "unknown TLS mode \"{raw}\"; valid modes are: {}",
        VALID_SSL_MODES.join(", ")
    )
}

/// Parse an optional user-supplied mode.
///
/// `None` and blank strings mean "no explicit mode" and keep the documented
/// engine/managed-provider defaults; every other value must be one of
/// [`VALID_SSL_MODES`].
pub fn parse_ssl_mode(ssl_mode: Option<&str>) -> Result<Option<SslMode>, String> {
    match ssl_mode.map(str::trim).filter(|mode| !mode.is_empty()) {
        Some(raw) => SslMode::parse(raw).map(Some),
        None => Ok(None),
    }
}

/// Reject an unrecognized non-empty mode.
///
/// Every entry point a mode can arrive through — saving a connection,
/// importing a transfer file, and actually connecting — calls this (directly or
/// through [`resolve_ssl_mode`] / [`tls_decision_for`]) so the four modes are
/// the only ones that can ever reach a driver.
pub fn validate_ssl_mode(ssl_mode: Option<&str>) -> Result<(), String> {
    parse_ssl_mode(ssl_mode).map(|_| ())
}

/// Map a mode onto a [`TlsDecision`], failing closed on an unknown mode.
pub fn tls_decision(ssl_mode: Option<&str>) -> Result<TlsDecision, String> {
    Ok(parse_ssl_mode(ssl_mode)?
        .map(SslMode::decision)
        .unwrap_or(TlsDecision::Disable))
}

/// Host suffixes of managed providers that reject plaintext connections with
/// `connection is insecure (try using 'sslmode=require')`.
const MANAGED_SSL_HOST_SUFFIXES: [&str; 3] = [".neon.tech", ".supabase.co", ".psdb.cloud"];

/// Resolve the SSL mode to use for a connection, defaulting these managed
/// providers to `require` when the connection carries no explicit mode.
///
/// Connections saved before the UI persisted `ssl_mode` (or imported without
/// it) would otherwise connect with TLS disabled and be refused by the server.
/// An explicit mode always wins, so a deliberate `disable` is never overridden,
/// and the inferred mode only encrypts — it never verifies certificates.
pub fn resolve_ssl_mode(host: &str, ssl_mode: Option<&str>) -> Result<Option<String>, String> {
    if let Some(mode) = parse_ssl_mode(ssl_mode)? {
        return Ok(Some(mode.as_str().to_string()));
    }
    let host = host.to_ascii_lowercase();
    if MANAGED_SSL_HOST_SUFFIXES
        .iter()
        .any(|suffix| host.ends_with(suffix))
    {
        return Ok(Some("require".to_string()));
    }
    Ok(None)
}

/// TLS decision for a connection, applying the managed-provider default from
/// [`resolve_ssl_mode`] before mapping to a [`TlsDecision`].
///
/// An unrecognized mode is an error here too, so a connection can never be
/// attempted with a mode that was never validated.
pub fn tls_decision_for(host: &str, ssl_mode: Option<&str>) -> Result<TlsDecision, String> {
    tls_decision(resolve_ssl_mode(host, ssl_mode)?.as_deref())
}

/// How a PostgreSQL connection reaches and authenticates the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PgConnectPlan {
    /// The database's real hostname — also the name the server certificate is
    /// verified against. A tunnel never replaces this with loopback.
    pub host: String,
    /// Numeric address dialed instead of `host` when the TCP endpoint is a
    /// tunnel's loopback listener (`tokio-postgres`'s `hostaddr`).
    pub hostaddr: Option<IpAddr>,
    pub port: u16,
    pub decision: TlsDecision,
}

impl PgConnectPlan {
    /// Plan a connect from an already-validated decision.
    ///
    /// `tunnel_port` is an SSH tunnel's local listener when one is in use. The
    /// tunnel endpoint only ever becomes `hostaddr`; `host` stays the real
    /// database name so `verify-ca`/`verify-full` authenticate the certificate
    /// against the host the user asked for instead of `127.0.0.1`.
    pub fn new(
        host: &str,
        port: Option<i64>,
        decision: TlsDecision,
        tunnel_port: Option<u16>,
    ) -> Self {
        match tunnel_port {
            Some(local_port) => PgConnectPlan {
                host: host.to_string(),
                hostaddr: Some(IpAddr::from([127, 0, 0, 1])),
                port: local_port,
                decision,
            },
            None => PgConnectPlan {
                host: host.to_string(),
                hostaddr: None,
                port: port.unwrap_or(5432) as u16,
                decision,
            },
        }
    }

    /// Write the endpoint into a driver config.
    ///
    /// `hostaddr` (never `host`) carries the tunnel endpoint: `tokio-postgres`
    /// dials `hostaddr` while it keeps using `host` as the TLS hostname.
    pub fn apply(&self, config: &mut tokio_postgres::Config) {
        config.host(self.host.clone());
        if let Some(addr) = self.hostaddr {
            config.hostaddr(addr);
        }
        config.port(self.port);
    }
}

/// Plan a PostgreSQL connect: validate the mode, then resolve the endpoint.
pub fn pg_connect_plan(
    host: &str,
    port: Option<i64>,
    ssl_mode: Option<&str>,
    tunnel_port: Option<u16>,
) -> Result<PgConnectPlan, String> {
    Ok(PgConnectPlan::new(
        host,
        port,
        tls_decision_for(host, ssl_mode)?,
        tunnel_port,
    ))
}

/// Build a rustls `ClientConfig` for tokio-postgres, or `None` for disable.
/// `ca_path` is required for Verify; `cert_path`/`key_path` are optional client auth.
pub fn build_tls_config(
    decision: TlsDecision,
    ca_path: Option<&str>,
    cert_path: Option<&str>,
    key_path: Option<&str>,
) -> Result<Option<Arc<ClientConfig>>, String> {
    if matches!(decision, TlsDecision::Disable) {
        return Ok(None);
    }

    let client_auth = match (cert_path, key_path) {
        (Some(c), Some(k)) => Some(load_client_identity(c, k)?),
        (Some(_), None) | (None, Some(_)) => {
            return Err("both ssl_cert_path and ssl_key_path must be set for client auth".into())
        }
        (None, None) => None,
    };

    let config = match decision {
        TlsDecision::Require => {
            // Encrypt without verifying the server certificate.
            let builder = ClientConfig::builder()
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(NoVerifier));
            match client_auth {
                Some((certs, key)) => builder
                    .with_client_auth_cert(certs, key)
                    .map_err(|e| format!("client cert: {e}"))?,
                None => builder.with_no_client_auth(),
            }
        }
        TlsDecision::Verify => {
            let mut roots = RootCertStore::empty();
            if let Some(ca) = ca_path {
                add_ca_file(&mut roots, ca)?;
            } else {
                return Err("ssl_ca_path is required for verify-ca / verify-full".into());
            }
            for ta in rustls_native_certs::load_native_certs()
                .map_err(|e| format!("native certs: {e}"))?
            {
                let _ = roots.add(ta);
            }
            let builder = ClientConfig::builder().with_root_certificates(roots);
            match client_auth {
                Some((certs, key)) => builder
                    .with_client_auth_cert(certs, key)
                    .map_err(|e| format!("client cert: {e}"))?,
                None => builder.with_no_client_auth(),
            }
        }
        TlsDecision::Disable => unreachable!(),
    };
    Ok(Some(Arc::new(config)))
}

fn add_ca_file(roots: &mut RootCertStore, path: &str) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("failed to read CA file {path}: {e}"))?;
    let mut reader = std::io::BufReader::new(bytes.as_slice());
    let parsed = rustls_pemfile::certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("parse CA: {e}"))?;
    let added = parsed.into_iter().filter_map(|c| roots.add(c).ok()).count();
    if added == 0 {
        return Err("no usable CA certificates found".into());
    }
    Ok(())
}

fn load_client_identity(
    cert_path: &str,
    key_path: &str,
) -> Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>), String> {
    // rustls-pemfile cannot decrypt PKCS#8-encrypted keys, so reject them up
    // front with a clear message before touching the certificate file.
    let kb = std::fs::read(key_path).map_err(|e| format!("read key: {e}"))?;
    if String::from_utf8_lossy(&kb).contains("ENCRYPTED PRIVATE KEY") {
        return Err(
            "encrypted client keys are not supported in v1; use an unencrypted PEM key".into(),
        );
    }
    let cb = std::fs::read(cert_path).map_err(|e| format!("read cert: {e}"))?;
    let certs: Vec<CertificateDer<'static>> =
        rustls_pemfile::certs(&mut std::io::BufReader::new(cb.as_slice()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("parse cert: {e}"))?
            .into_iter()
            .map(|c| c.into_owned())
            .collect();
    if certs.is_empty() {
        return Err("no client certificates parsed".into());
    }
    let key = rustls_pemfile::private_key(&mut std::io::BufReader::new(kb.as_slice()))
        .map_err(|e| format!("parse key: {e}"))?
        .ok_or_else(|| "no private key parsed".to_string())?
        .clone_key();
    Ok((certs, key))
}

/// Accepts every certificate: TLS encryption without authentication (`require` mode).
#[derive(Debug)]
struct NoVerifier;

impl ServerCertVerifier for NoVerifier {
    fn verify_server_cert(
        &self,
        _ee: &CertificateDer<'_>,
        _ic: &[CertificateDer<'_>],
        _n: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every accepted mode, with the decision it must produce. Anything not in
    /// this table is not a Gridline TLS mode.
    const MODES: [(&str, SslMode, TlsDecision); 4] = [
        ("disable", SslMode::Disable, TlsDecision::Disable),
        ("require", SslMode::Require, TlsDecision::Require),
        ("verify-ca", SslMode::VerifyCa, TlsDecision::Verify),
        ("verify-full", SslMode::VerifyFull, TlsDecision::Verify),
    ];

    // NOTE: these tests cover the decision/endpoint seam — which mode is chosen,
    // and which hostname the certificate is verified against. Proving an actual
    // handshake (a real certificate chain, a real mismatch being refused) needs
    // a live server and is covered only by the env-gated integration tests
    // (`GRIDLINE_TEST_*` in `commands/backup.test.rs`) and manual acceptance.

    #[test]
    fn every_supported_mode_has_its_own_behavior() {
        for (name, mode, decision) in MODES {
            assert_eq!(SslMode::parse(name), Ok(mode), "parse {name}");
            assert_eq!(mode.as_str(), name, "round-trip {name}");
            assert_eq!(mode.decision(), decision, "decision for {name}");
            assert_eq!(
                tls_decision(Some(name)).unwrap(),
                decision,
                "tls_decision for {name}"
            );
            assert_eq!(
                mode.verifies_certificate(),
                matches!(decision, TlsDecision::Verify),
                "verifies_certificate for {name}"
            );
        }
    }

    #[test]
    fn unknown_tls_mode_is_rejected_and_names_the_valid_set() {
        // `allow`/`prefer` permit a plaintext fallback our mode set cannot
        // express, and a case-variant or typo is equally unrecognized. None of
        // them may quietly become `disable`.
        for bogus in ["bogus", "allow", "prefer", "REQUIRE", "verify_full", "tls"] {
            for result in [
                tls_decision(Some(bogus)),
                tls_decision_for("db.example.com", Some(bogus)),
            ] {
                let err = result.expect_err("an unknown mode must be an error, not plaintext");
                assert!(err.contains(bogus), "error should quote the value: {err}");
                for valid in VALID_SSL_MODES {
                    assert!(err.contains(valid), "error {err} must name {valid}");
                }
            }
            assert!(validate_ssl_mode(Some(bogus)).is_err());
            assert!(resolve_ssl_mode("ep-x.eu.aws.neon.tech", Some(bogus)).is_err());
            assert!(pg_connect_plan("db.example.com", Some(5432), Some(bogus), None).is_err());
        }
    }

    #[test]
    fn absent_or_blank_mode_keeps_engine_and_managed_defaults() {
        // No mode at all, and the blank string a form leaves behind, both mean
        // "nothing was chosen": plain engines stay plaintext, managed providers
        // that refuse plaintext keep their documented `require` default.
        for no_mode in [None, Some(""), Some("   ")] {
            assert_eq!(parse_ssl_mode(no_mode), Ok(None));
            assert!(validate_ssl_mode(no_mode).is_ok());
            assert_eq!(tls_decision(no_mode).unwrap(), TlsDecision::Disable);
            assert_eq!(resolve_ssl_mode("db.example.com", no_mode), Ok(None));
            assert_eq!(
                resolve_ssl_mode("ep-x.eu.aws.neon.tech", no_mode),
                Ok(Some("require".to_string()))
            );
            assert_eq!(
                tls_decision_for("db.example.com", no_mode).unwrap(),
                TlsDecision::Disable
            );
            assert_eq!(
                tls_decision_for("ep-x.eu.aws.neon.tech", no_mode).unwrap(),
                TlsDecision::Require
            );
        }
    }

    #[test]
    fn resolve_ssl_mode_defaults_managed_hosts_to_require() {
        // Saved connections that predate the form storing `ssl_mode` still work.
        for host in [
            "ep-hidden-star-b3hqtp4x-pooler.c-4.ap-southeast-1.aws.neon.tech",
            "db.abcdefghijklmnopqrst.supabase.co",
            "xxxx.us-east-2.psdb.cloud",
            "EP-X-POOLER.EU.AWS.NEON.TECH",
        ] {
            assert_eq!(
                resolve_ssl_mode(host, None),
                Ok(Some("require".to_string()))
            );
        }
    }

    #[test]
    fn resolve_ssl_mode_leaves_other_hosts_and_explicit_modes_alone() {
        assert_eq!(resolve_ssl_mode("localhost", None), Ok(None));
        assert_eq!(resolve_ssl_mode("prod.example.com", None), Ok(None));
        // An explicit mode always wins — a deliberate `disable` is never overridden.
        assert_eq!(
            resolve_ssl_mode("ep-x.eu.aws.neon.tech", Some("disable")),
            Ok(Some("disable".to_string()))
        );
        assert_eq!(
            resolve_ssl_mode("ep-x.eu.aws.neon.tech", Some("verify-full")),
            Ok(Some("verify-full".to_string()))
        );
    }

    #[test]
    fn tls_decision_for_honors_managed_default_and_explicit_modes() {
        assert_eq!(
            tls_decision_for("ep-x.eu.aws.neon.tech", None).unwrap(),
            TlsDecision::Require
        );
        assert_eq!(
            tls_decision_for("ep-x.eu.aws.neon.tech", Some("disable")).unwrap(),
            TlsDecision::Disable
        );
        assert_eq!(
            tls_decision_for("db.example.com", None).unwrap(),
            TlsDecision::Disable
        );
    }

    #[test]
    fn verified_tunnel_plan_dials_loopback_but_verifies_the_real_host() {
        // The reason this ticket exists: through an SSH tunnel the TCP peer is
        // 127.0.0.1, but the certificate must be checked against the database's
        // real hostname — not against loopback.
        for mode in ["verify-ca", "verify-full"] {
            let plan =
                pg_connect_plan("db.internal", Some(5432), Some(mode), Some(45_123)).unwrap();
            assert_eq!(plan.decision, TlsDecision::Verify, "{mode} keeps verifying");
            assert_eq!(plan.host, "db.internal", "{mode} verifies the real host");
            assert_ne!(plan.host, "127.0.0.1", "{mode} must not verify loopback");
            assert_eq!(plan.hostaddr, Some(IpAddr::from([127, 0, 0, 1])));
            assert_eq!(plan.port, 45_123, "{mode} connects to the tunnel listener");
        }
    }

    #[test]
    fn a_tunnel_never_changes_the_tls_decision() {
        // The old behavior degraded verify-ca/verify-full to encryption-only
        // through a tunnel. Every mode must now survive the tunnel unchanged.
        for (name, _, decision) in MODES {
            let direct = pg_connect_plan("db.internal", Some(5432), Some(name), None).unwrap();
            let tunnelled =
                pg_connect_plan("db.internal", Some(5432), Some(name), Some(45_123)).unwrap();
            assert_eq!(direct.decision, decision, "{name} direct");
            assert_eq!(tunnelled.decision, decision, "{name} through a tunnel");
            assert_eq!(tunnelled.host, "db.internal", "{name}");
            assert_eq!(
                tunnelled.hostaddr,
                Some(IpAddr::from([127, 0, 0, 1])),
                "{name}"
            );
            // Require asks for encryption without verification: it stays that,
            // and never becomes verification, on either path.
            if decision != TlsDecision::Verify {
                assert!(tunnelled.hostaddr.is_some());
            }
        }
    }

    #[test]
    fn direct_plan_uses_the_real_endpoint() {
        let plan = pg_connect_plan("db.internal", Some(6543), Some("verify-full"), None).unwrap();
        assert_eq!(plan.host, "db.internal");
        assert_eq!(plan.hostaddr, None);
        assert_eq!(plan.port, 6543);
        assert_eq!(plan.decision, TlsDecision::Verify);
        // A managed host with no mode keeps its `require` default through a plan.
        assert_eq!(
            pg_connect_plan("ep-x.eu.aws.neon.tech", None, None, None)
                .unwrap()
                .decision,
            TlsDecision::Require
        );
    }

    #[test]
    fn plan_applies_loopback_as_hostaddr_so_the_driver_verifies_the_real_host() {
        // The invariant lives in the driver config the handshake actually sees:
        // `host` (the TLS hostname) must be the real database, and only
        // `hostaddr` may be loopback.
        use tokio_postgres::config::Host;

        let plan =
            pg_connect_plan("db.internal", Some(5432), Some("verify-full"), Some(45_123)).unwrap();
        let mut cfg = tokio_postgres::Config::new();
        plan.apply(&mut cfg);
        assert_eq!(cfg.get_hosts(), &[Host::Tcp("db.internal".into())]);
        assert_eq!(cfg.get_hostaddrs(), &[IpAddr::from([127, 0, 0, 1])]);
        assert_eq!(cfg.get_ports(), &[45_123]);

        // Direct: no hostaddr override, the real endpoint is dialed as-is.
        let plan = pg_connect_plan("db.internal", Some(5432), None, None).unwrap();
        let mut cfg = tokio_postgres::Config::new();
        plan.apply(&mut cfg);
        assert_eq!(cfg.get_hosts(), &[Host::Tcp("db.internal".into())]);
        assert!(cfg.get_hostaddrs().is_empty());
        assert_eq!(cfg.get_ports(), &[5432]);
    }

    #[test]
    fn build_tls_disable_returns_none() {
        assert!(build_tls_config(TlsDecision::Disable, None, None, None)
            .unwrap()
            .is_none());
    }

    #[test]
    fn build_tls_require_returns_some_without_files() {
        assert!(build_tls_config(TlsDecision::Require, None, None, None)
            .unwrap()
            .is_some());
    }

    #[test]
    fn build_tls_verify_missing_ca_errors() {
        let err = build_tls_config(TlsDecision::Verify, Some("/nonexistent/ca.pem"), None, None)
            .unwrap_err();
        assert!(err.to_lowercase().contains("ca"), "got: {err}");
    }

    #[test]
    fn build_tls_client_cert_missing_key_errors() {
        // cert set without key
        let err = build_tls_config(
            TlsDecision::Require,
            None,
            Some("/nonexistent/cert.pem"),
            None,
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("cert") || err.to_lowercase().contains("key"));
    }

    #[test]
    fn build_tls_rejects_encrypted_key_marker() {
        // rustls-pemfile cannot decrypt PKCS#8-encrypted keys, so an ENCRYPTED
        // PRIVATE KEY header must be rejected with a clear error. The cert file
        // is a dummy: the key check fires before the cert is read.
        let dir = std::env::temp_dir();
        let cert_path = dir.join("gl_tls_cert_dummy.pem");
        let key_path = dir.join("gl_tls_enc_key.pem");
        std::fs::write(
            &cert_path,
            "-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----\n",
        )
        .unwrap();
        std::fs::write(
            &key_path,
            "-----BEGIN ENCRYPTED PRIVATE KEY-----\nabc\n-----END ENCRYPTED PRIVATE KEY-----\n",
        )
        .unwrap();
        let r = build_tls_config(
            TlsDecision::Require,
            None,
            Some(cert_path.to_str().unwrap()),
            Some(key_path.to_str().unwrap()),
        );
        assert!(r.is_err());
        assert!(
            r.unwrap_err().to_lowercase().contains("encrypt"),
            "must mention encryption"
        );
    }
}
