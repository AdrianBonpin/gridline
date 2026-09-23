//! TLS connector factory for tokio-postgres.
//!
//! Maps the user-facing SSL modes to rustls `ClientConfig` values:
//! - `disable` -> no TLS (returns `None`)
//! - `require` -> encrypt without verifying the server certificate (custom `NoVerifier`)
//! - `verify-ca` / `verify-full` -> standard rustls webpki verification (chain AND
//!   hostname; `verify-ca` is intentionally identical to `verify-full` in v1)
//!
//! Client certificates are supported via optional `cert_path` / `key_path` pair.

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

pub fn tls_decision(ssl_mode: Option<&str>) -> TlsDecision {
    match ssl_mode {
        Some("require") => TlsDecision::Require,
        Some("verify-ca") | Some("verify-full") => TlsDecision::Verify,
        _ => TlsDecision::Disable,
    }
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
pub fn resolve_ssl_mode(host: &str, ssl_mode: Option<&str>) -> Option<String> {
    if let Some(mode) = ssl_mode {
        return Some(mode.to_string());
    }
    let host = host.to_ascii_lowercase();
    if MANAGED_SSL_HOST_SUFFIXES
        .iter()
        .any(|suffix| host.ends_with(suffix))
    {
        return Some("require".to_string());
    }
    None
}

/// TLS decision for a connection, applying the managed-provider default from
/// [`resolve_ssl_mode`] before mapping to a [`TlsDecision`].
pub fn tls_decision_for(host: &str, ssl_mode: Option<&str>) -> TlsDecision {
    tls_decision(resolve_ssl_mode(host, ssl_mode).as_deref())
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

    #[test]
    fn tls_decision_maps_modes() {
        assert!(matches!(tls_decision(None), TlsDecision::Disable));
        assert!(matches!(
            tls_decision(Some("disable")),
            TlsDecision::Disable
        ));
        assert!(matches!(
            tls_decision(Some("require")),
            TlsDecision::Require
        ));
        assert!(matches!(
            tls_decision(Some("verify-ca")),
            TlsDecision::Verify
        ));
        assert!(matches!(
            tls_decision(Some("verify-full")),
            TlsDecision::Verify
        ));
        assert!(matches!(tls_decision(Some("bogus")), TlsDecision::Disable));
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
            assert_eq!(resolve_ssl_mode(host, None).as_deref(), Some("require"));
        }
    }

    #[test]
    fn resolve_ssl_mode_leaves_other_hosts_and_explicit_modes_alone() {
        assert_eq!(resolve_ssl_mode("localhost", None), None);
        assert_eq!(resolve_ssl_mode("prod.example.com", None), None);
        // An explicit mode always wins — a deliberate `disable` is never overridden.
        assert_eq!(
            resolve_ssl_mode("ep-x.eu.aws.neon.tech", Some("disable")).as_deref(),
            Some("disable")
        );
        assert_eq!(
            resolve_ssl_mode("ep-x.eu.aws.neon.tech", Some("verify-full")).as_deref(),
            Some("verify-full")
        );
    }

    #[test]
    fn tls_decision_for_honors_managed_default_and_explicit_modes() {
        assert!(matches!(
            tls_decision_for("ep-x.eu.aws.neon.tech", None),
            TlsDecision::Require
        ));
        assert!(matches!(
            tls_decision_for("ep-x.eu.aws.neon.tech", Some("disable")),
            TlsDecision::Disable
        ));
        assert!(matches!(
            tls_decision_for("db.example.com", None),
            TlsDecision::Disable
        ));
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
