use super::*;
use crate::commands::ssh_trust::fake::{FakeHostTrust, FakeTransport, TransportOp};
use crate::models::ssh_trust::{HostKey, HostKeyFingerprint, HostTrustRecord, SshHostTrustState};
use sha2::Digest;

// ---------------------------------------------------------------------------
// Helpers: synthetic host keys in the SSH wire format
// ---------------------------------------------------------------------------

/// Build a key blob shaped like the wire format: `u32 len | algorithm | key`.
fn key_blob(key_type: &str, seed: u8) -> Vec<u8> {
    let mut blob = Vec::new();
    blob.extend_from_slice(&(key_type.len() as u32).to_be_bytes());
    blob.extend_from_slice(key_type.as_bytes());
    blob.extend_from_slice(&4u32.to_be_bytes());
    blob.extend_from_slice(&[seed; 32]);
    blob
}

fn host_key(key_type: &str, seed: u8) -> HostKey {
    host_key_from_blob(&key_blob(key_type, seed)).expect("well-formed key blob")
}

fn fingerprint(key_type: &str, seed: u8) -> String {
    fingerprint_of(&key_blob(key_type, seed))
}

/// A known-hosts line for `host_field`, base64-encoding `key`.
fn known_hosts_line(host_field: &str, key: &HostKey) -> String {
    format!("{host_field} {} {}", key.key_type, b64_encode(&key.blob))
}

fn record_for(host: &str, port: u16, key: &HostKey) -> HostTrustRecord {
    HostTrustRecord {
        host: host.to_string(),
        port,
        key: key.clone(),
        fingerprint: fingerprint_of(&key.blob),
        enrolled_at: "2026-11-21T00:00:00Z".to_string(),
    }
}
fn ssh_config(host: &str, port: u16, auth_method: &str) -> crate::models::SshConfig {
    let mut cfg = crate::models::SshConfig::new(
        host.to_string(),
        port,
        "tunnel".to_string(),
        auth_method.to_string(),
    );
    if auth_method == "key" {
        cfg.private_key_path = Some("/home/user/.ssh/id_ed25519".to_string());
    }
    cfg
}

// ---------------------------------------------------------------------------
// Key identity
// ---------------------------------------------------------------------------

#[test]
fn host_key_type_comes_from_the_wire_blob() {
    assert_eq!(host_key("ssh-ed25519", 1).key_type, "ssh-ed25519");
    assert_eq!(host_key("ssh-rsa", 2).key_type, "ssh-rsa");
    // A truncated or non-key blob is rejected rather than guessed at.
    assert!(host_key_from_blob(&[]).is_err());
    assert!(host_key_from_blob(&[0, 0, 0, 40, b's', b's', b'h']).is_err());
}

#[test]
fn fingerprint_is_openssh_style_sha256_without_padding() {
    // Golden value: base64(SHA256(blob)) with no `=` padding.
    let blob = key_blob("ssh-ed25519", 7);
    let expected = format!(
        "SHA256:{}",
        base64::engine::general_purpose::STANDARD_NO_PAD.encode(sha2::Sha256::digest(&blob))
    );
    assert_eq!(fingerprint_of(&blob), expected);
    assert!(fingerprint_of(&blob).starts_with("SHA256:"));
    assert!(!fingerprint_of(&blob).contains('='));
}

// ---------------------------------------------------------------------------
// known-hosts parsing and endpoint keying
// ---------------------------------------------------------------------------

#[test]
fn known_hosts_name_keys_non_standard_ports() {
    assert_eq!(known_hosts_name("db.example.com", 22), "db.example.com");
    assert_eq!(
        known_hosts_name("db.example.com", 2222),
        "[db.example.com]:2222"
    );
}

#[test]
fn parse_known_hosts_reads_entries_and_skips_noise() {
    let key = host_key("ssh-ed25519", 3);
    let content = format!(
        "# a comment\n\n{} {} {}\ngarbage line\n@cert-authority * ssh-ed25519 {}\n",
        "host.example.com,10.0.0.1",
        key.key_type,
        b64_encode(&key.blob),
        b64_encode(&key.blob),
    );
    let entries = parse_known_hosts(&content);
    assert_eq!(entries.len(), 1, "only the plain entry is a trust record");
    assert_eq!(entries[0].key, key);
    assert_eq!(
        entries[0].patterns,
        vec!["host.example.com".to_string(), "10.0.0.1".to_string()]
    );
}

#[test]
fn known_hosts_entry_matches_its_own_port_only() {
    let key = host_key("ssh-ed25519", 4);
    let default_port = parse_known_hosts(&known_hosts_line("db.example.com", &key));
    let custom_port = parse_known_hosts(&known_hosts_line("[db.example.com]:2222", &key));

    assert!(patterns_match(&default_port[0].patterns, "db.example.com"));
    assert!(!patterns_match(
        &default_port[0].patterns,
        "[db.example.com]:2222"
    ));
    assert!(patterns_match(
        &custom_port[0].patterns,
        "[db.example.com]:2222"
    ));
    assert!(!patterns_match(&custom_port[0].patterns, "db.example.com"));
}

#[test]
fn known_hosts_patterns_support_wildcards() {
    let key = host_key("ssh-ed25519", 5);
    let entries = parse_known_hosts(&known_hosts_line("*.example.com", &key));
    assert!(patterns_match(&entries[0].patterns, "db.example.com"));
    assert!(!patterns_match(&entries[0].patterns, "db.example.net"));
    // OpenSSH matches the bracketed `[host]:port` name literally, so a wildcard
    // written for the default port does not silently authorize a non-standard
    // one: that falls back to an explicit enrollment instead.
    assert!(!patterns_match(
        &entries[0].patterns,
        "[db.example.com]:2222"
    ));
}

#[test]
fn hashed_known_hosts_entries_match_the_keyed_endpoint() {
    // HashKnownHosts writes `|1|<salt>|<hmac-sha1(host)>`, over the same
    // `host`/`[host]:port` name, so non-standard ports hash correctly too.
    let hmac_sha1 = |name: &str| {
        use hmac::{Hmac, Mac};
        let mut mac = Hmac::<sha1::Sha1>::new_from_slice(b"salt-salt-salt-12").unwrap();
        mac.update(name.as_bytes());
        mac.finalize().into_bytes()
    };
    let key = host_key("ssh-ed25519", 6);
    let hashed = format!(
        "|1|{}|{} {} {}",
        b64_encode(b"salt-salt-salt-12"),
        b64_encode(&hmac_sha1("[db.example.com]:2222")),
        key.key_type,
        b64_encode(&key.blob),
    );
    let entries = parse_known_hosts(&hashed);
    assert_eq!(entries.len(), 1);
    assert!(patterns_match(
        &entries[0].patterns,
        "[db.example.com]:2222"
    ));
    assert!(!patterns_match(&entries[0].patterns, "db.example.com"));
}

// ---------------------------------------------------------------------------
// Trust evaluation
// ---------------------------------------------------------------------------

#[test]
fn known_hosts_match_is_trusted_without_prompting() {
    let key = host_key("ssh-ed25519", 10);
    let known = parse_known_hosts(&known_hosts_line("[db.example.com]:2222", &key));

    match evaluate_host_trust("db.example.com", 2222, &key, &known, None) {
        SshHostTrustState::Trusted {
            source,
            fingerprint,
            key_type,
            ..
        } => {
            assert_eq!(source, crate::models::ssh_trust::TrustSource::KnownHosts);
            assert_eq!(fingerprint, fingerprint_of(&key.blob));
            assert_eq!(key_type, "ssh-ed25519");
        }
        other => panic!("expected trusted, got {other:?}"),
    }
}

#[test]
fn unknown_host_blocks_with_the_offered_fingerprint() {
    let key = host_key("ssh-ed25519", 11);
    match evaluate_host_trust("new.example.com", 22, &key, &[], None) {
        SshHostTrustState::Unknown {
            host,
            port,
            key_type,
            fingerprint,
        } => {
            assert_eq!(host, "new.example.com");
            assert_eq!(port, 22);
            assert_eq!(key_type, "ssh-ed25519");
            assert_eq!(fingerprint, fingerprint_of(&key.blob));
        }
        other => panic!("expected unknown, got {other:?}"),
    }
}

#[test]
fn a_known_hosts_entry_for_another_port_does_not_authorize_this_one() {
    let key = host_key("ssh-ed25519", 12);
    let known = parse_known_hosts(&known_hosts_line("db.example.com", &key));
    assert!(matches!(
        evaluate_host_trust("db.example.com", 2222, &key, &known, None),
        SshHostTrustState::Unknown { .. }
    ));
}

#[test]
fn conflicting_key_reports_expected_and_actual_fingerprints() {
    let trusted = host_key("ssh-ed25519", 20);
    let offered = host_key("ssh-ed25519", 21);
    let known = parse_known_hosts(&known_hosts_line("db.example.com", &trusted));

    match evaluate_host_trust("db.example.com", 22, &offered, &known, None) {
        SshHostTrustState::Mismatch {
            expected_fingerprint,
            expected_key_type,
            fingerprint,
            source,
            ..
        } => {
            assert_eq!(expected_fingerprint, fingerprint_of(&trusted.blob));
            assert_eq!(expected_key_type, "ssh-ed25519");
            assert_eq!(fingerprint, fingerprint_of(&offered.blob));
            assert_eq!(source, crate::models::ssh_trust::TrustSource::KnownHosts);
        }
        other => panic!("expected mismatch, got {other:?}"),
    }
}

#[test]
fn known_hosts_stays_authoritative_over_an_enrolled_record() {
    // ADR 0001: existing known-hosts entries remain authoritative where present.
    let trusted = host_key("ssh-ed25519", 22);
    let offered = host_key("ssh-ed25519", 23);
    let known = parse_known_hosts(&known_hosts_line("db.example.com", &trusted));
    let record = record_for("db.example.com", 22, &offered);

    assert!(matches!(
        evaluate_host_trust("db.example.com", 22, &offered, &known, Some(&record)),
        SshHostTrustState::Mismatch { .. }
    ));
}

#[test]
fn an_enrolled_record_is_trusted_on_reconnect() {
    let key = host_key("ssh-ed25519", 24);
    let record = record_for("db.example.com", 2222, &key);
    match evaluate_host_trust("db.example.com", 2222, &key, &[], Some(&record)) {
        SshHostTrustState::Trusted { source, .. } => {
            assert_eq!(source, crate::models::ssh_trust::TrustSource::Enrolled)
        }
        other => panic!("expected trusted, got {other:?}"),
    }
}

#[test]
fn an_enrolled_record_for_a_different_key_fails_closed() {
    let enrolled = host_key("ssh-ed25519", 25);
    let offered = host_key("ssh-ed25519", 26);
    let record = record_for("db.example.com", 22, &enrolled);
    match evaluate_host_trust("db.example.com", 22, &offered, &[], Some(&record)) {
        SshHostTrustState::Mismatch {
            expected_fingerprint,
            fingerprint,
            source,
            ..
        } => {
            assert_eq!(expected_fingerprint, fingerprint_of(&enrolled.blob));
            assert_eq!(fingerprint, fingerprint_of(&offered.blob));
            assert_eq!(source, crate::models::ssh_trust::TrustSource::Enrolled);
        }
        other => panic!("expected mismatch, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Pre-authentication ordering (the ticket's core requirement)
// ---------------------------------------------------------------------------

#[test]
fn a_known_host_is_authenticated_after_verification() {
    let key = host_key("ssh-ed25519", 30);
    let mut trust = FakeHostTrust::default();
    trust.add_known_hosts(&known_hosts_line("db.example.com", &key));
    let mut transport = FakeTransport::offering(key.clone());

    let state = establish_trusted_session(
        &mut transport,
        &trust,
        &ssh_config("db.example.com", 22, "password"),
        Some("db-password"),
        None,
    )
    .expect("known host connects without prompting");

    assert!(state.is_trusted());
    assert_eq!(
        transport.ops,
        vec![
            TransportOp::Handshake,
            TransportOp::HostKey,
            TransportOp::PasswordAuth {
                user: "tunnel".into(),
                password: "db-password".into(),
            },
        ]
    );
}

#[test]
fn an_unknown_host_never_sees_a_password() {
    let key = host_key("ssh-ed25519", 31);
    let trust = FakeHostTrust::default();
    let mut transport = FakeTransport::offering(key);

    let err = establish_trusted_session(
        &mut transport,
        &trust,
        &ssh_config("new.example.com", 2222, "password"),
        Some("secret-db-password"),
        None,
    )
    .expect_err("unknown host must block authentication");

    assert!(matches!(err, SshTunnelError::HostKeyUnknown(_)));
    assert_eq!(
        transport.ops,
        vec![TransportOp::Handshake, TransportOp::HostKey],
        "no credential may be sent before the fingerprint is accepted"
    );
    assert!(
        !transport.saw_credentials(),
        "nothing credential-bearing sent"
    );
}

#[test]
fn an_unknown_host_never_sees_a_private_key_or_passphrase() {
    let key = host_key("ssh-ed25519", 32);
    let trust = FakeHostTrust::default();
    let mut transport = FakeTransport::offering(key);

    let err = establish_trusted_session(
        &mut transport,
        &trust,
        &ssh_config("new.example.com", 22, "key"),
        None,
        Some("key-passphrase"),
    )
    .expect_err("unknown host must block authentication");

    assert!(matches!(err, SshTunnelError::HostKeyUnknown(_)));
    assert_eq!(
        transport.ops,
        vec![TransportOp::Handshake, TransportOp::HostKey]
    );
    assert!(!transport.saw_credentials());
}

#[test]
fn a_conflicting_key_fails_with_both_fingerprints_and_no_bypass() {
    let trusted = host_key("ssh-ed25519", 40);
    let offered = host_key("ssh-ed25519", 41);
    let mut trust = FakeHostTrust::default();
    trust.add_known_hosts(&known_hosts_line("db.example.com", &trusted));
    let mut transport = FakeTransport::offering(offered.clone());

    let err = establish_trusted_session(
        &mut transport,
        &trust,
        &ssh_config("db.example.com", 22, "password"),
        Some("secret-db-password"),
        None,
    )
    .expect_err("a changed host key must fail closed");

    match &err {
        SshTunnelError::HostKeyMismatch(SshHostTrustState::Mismatch {
            expected_fingerprint,
            fingerprint,
            ..
        }) => {
            assert_eq!(expected_fingerprint, &fingerprint_of(&trusted.blob));
            assert_eq!(fingerprint, &fingerprint_of(&offered.blob));
        }
        other => panic!("expected a mismatch, got {other:?}"),
    }
    assert_eq!(
        transport.ops,
        vec![TransportOp::Handshake, TransportOp::HostKey]
    );
    // The message names both keys so the user can see what changed.
    let message = err.message();
    assert!(
        message.contains(&fingerprint_of(&trusted.blob)),
        "{message}"
    );
    assert!(
        message.contains(&fingerprint_of(&offered.blob)),
        "{message}"
    );
}

#[test]
fn key_auth_also_waits_for_verification() {
    let key = host_key("ssh-ed25519", 50);
    let mut trust = FakeHostTrust::default();
    trust.add_record(record_for("db.example.com", 22, &key));
    let mut transport = FakeTransport::offering(key);

    establish_trusted_session(
        &mut transport,
        &trust,
        &ssh_config("db.example.com", 22, "key"),
        None,
        Some("key-passphrase"),
    )
    .expect("an enrolled host reconnects");

    assert_eq!(
        transport.ops,
        vec![
            TransportOp::Handshake,
            TransportOp::HostKey,
            TransportOp::KeyAuth {
                user: "tunnel".into(),
                path: "/home/user/.ssh/id_ed25519".into(),
                passphrase: Some("key-passphrase".into()),
            },
        ]
    );
}

#[test]
fn a_failed_handshake_sends_nothing() {
    let mut trust = FakeHostTrust::default();
    trust.add_known_hosts(&known_hosts_line(
        "db.example.com",
        &host_key("ssh-ed25519", 60),
    ));
    let mut transport = FakeTransport::offering(host_key("ssh-ed25519", 60));
    transport.fail_handshake("ssh handshake: connection reset");

    let err = establish_trusted_session(
        &mut transport,
        &trust,
        &ssh_config("db.example.com", 22, "password"),
        Some("secret-db-password"),
        None,
    )
    .expect_err("a failed handshake cannot authenticate");

    assert!(matches!(err, SshTunnelError::Failed(_)));
    assert_eq!(transport.ops, vec![TransportOp::Handshake]);
}

// ---------------------------------------------------------------------------
// First-use enrollment
// ---------------------------------------------------------------------------

#[test]
fn enrollment_remembers_the_accepted_fingerprint_without_credentials() {
    let key = host_key("ssh-ed25519", 70);
    let trust = FakeHostTrust::default();
    let mut transport = FakeTransport::offering(key.clone());
    let accepted = HostKeyFingerprint {
        key_type: "ssh-ed25519".into(),
        fingerprint: fingerprint_of(&key.blob),
    };

    let state = enroll_host_trust(&mut transport, &trust, "db.example.com", 2222, &accepted)
        .expect("explicit acceptance enrolls an unknown host");

    assert!(matches!(
        state,
        SshHostTrustState::Trusted {
            source: crate::models::ssh_trust::TrustSource::Enrolled,
            ..
        }
    ));
    assert_eq!(
        transport.ops,
        vec![TransportOp::Handshake, TransportOp::HostKey],
        "enrollment reads the key and sends no credentials"
    );
    let records = trust.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].host, "db.example.com");
    assert_eq!(records[0].port, 2222);
    assert_eq!(records[0].key, key);
    assert_eq!(records[0].fingerprint, fingerprint_of(&key.blob));
}

#[test]
fn enrollment_unblocks_the_next_connection_for_that_port_only() {
    let key = host_key("ssh-ed25519", 75);
    let trust = FakeHostTrust::default();
    let accepted = HostKeyFingerprint {
        key_type: key.key_type.clone(),
        fingerprint: fingerprint_of(&key.blob),
    };
    enroll_host_trust(
        &mut FakeTransport::offering(key.clone()),
        &trust,
        "db.example.com",
        2222,
        &accepted,
    )
    .expect("first use enrolls");

    // The accepted endpoint now connects and authenticates...
    let mut enrolled = FakeTransport::offering(key.clone());
    establish_trusted_session(
        &mut enrolled,
        &trust,
        &ssh_config("db.example.com", 2222, "password"),
        Some("db-password"),
        None,
    )
    .expect("an enrolled host reconnects without prompting");
    assert!(enrolled.saw_credentials());

    // ...but a different port is a different endpoint: still unknown, and still
    // nothing credential-bearing is sent to it.
    let mut other_port = FakeTransport::offering(key);
    let err = establish_trusted_session(
        &mut other_port,
        &trust,
        &ssh_config("db.example.com", 22, "password"),
        Some("db-password"),
        None,
    )
    .expect_err("trust is per endpoint, not per host name");
    assert!(matches!(err, SshTunnelError::HostKeyUnknown(_)));
    assert!(!other_port.saw_credentials());
}

#[test]
fn enrollment_refuses_a_changed_key() {
    let trusted = host_key("ssh-ed25519", 71);
    let offered = host_key("ssh-ed25519", 72);
    let mut trust = FakeHostTrust::default();
    trust.add_known_hosts(&known_hosts_line("db.example.com", &trusted));
    let mut transport = FakeTransport::offering(offered.clone());

    let err = enroll_host_trust(
        &mut transport,
        &trust,
        "db.example.com",
        22,
        &HostKeyFingerprint {
            key_type: offered.key_type.clone(),
            fingerprint: fingerprint_of(&offered.blob),
        },
    )
    .expect_err("a conflicting key is not accepted inline");

    assert!(err.contains(&fingerprint_of(&trusted.blob)), "{err}");
    assert!(err.contains(&fingerprint_of(&offered.blob)), "{err}");
    assert!(trust.records().is_empty(), "nothing was trusted");
}

#[test]
fn enrollment_requires_the_offered_key_to_match_the_accepted_fingerprint() {
    let offered = host_key("ssh-ed25519", 73);
    let other = host_key("ssh-ed25519", 74);
    let trust = FakeHostTrust::default();
    let mut transport = FakeTransport::offering(offered);

    let err = enroll_host_trust(
        &mut transport,
        &trust,
        "db.example.com",
        22,
        &HostKeyFingerprint {
            key_type: "ssh-ed25519".into(),
            fingerprint: fingerprint_of(&other.blob),
        },
    )
    .expect_err("a server that switched keys between prompt and acceptance is refused");

    assert!(err.contains("different host key"), "{err}");
    assert!(trust.records().is_empty(), "nothing was trusted");
}

#[test]
fn a_probe_reports_state_without_credentials() {
    let key = host_key("ssh-ed25519", 80);
    let mut trust = FakeHostTrust::default();
    trust.add_known_hosts(&known_hosts_line("[db.example.com]:2222", &key));
    let mut transport = FakeTransport::offering(key.clone());

    let state = probe_host_trust(&mut transport, &trust, "db.example.com", 2222)
        .expect("probe handshakes and reads the key");

    assert!(state.is_trusted());
    assert_eq!(
        transport.ops,
        vec![TransportOp::Handshake, TransportOp::HostKey]
    );
}

// ---------------------------------------------------------------------------
// Deliberate re-enrollment (ticket 22)
//
// Replacing stale trust is a separate action from authenticating: it is only
// reachable from the connection's trust state, never from a connect attempt.
// ---------------------------------------------------------------------------

#[test]
fn re_enrollment_replaces_stale_trust_and_the_next_connection_verifies_the_new_key() {
    let stale = host_key("ssh-ed25519", 100);
    let rotated = host_key("ssh-ed25519", 101);
    let mut trust = FakeHostTrust::default();
    trust.add_record(record_for("db.example.com", 2222, &stale));

    let accepted = HostKeyFingerprint {
        key_type: rotated.key_type.clone(),
        fingerprint: fingerprint_of(&rotated.blob),
    };
    let mut transport = FakeTransport::offering(rotated.clone());
    let state = reenroll_host_trust(&mut transport, &trust, "db.example.com", 2222, &accepted)
        .expect("a confirmed fingerprint replaces stale trust");

    assert!(matches!(
        state,
        SshHostTrustState::Trusted {
            source: crate::models::ssh_trust::TrustSource::Enrolled,
            ..
        }
    ));
    assert_eq!(
        transport.ops,
        vec![TransportOp::Handshake, TransportOp::HostKey],
        "re-enrollment reads the key and sends no credentials"
    );

    // One record per endpoint, now holding the rotated key.
    let records = trust.records();
    assert_eq!(records.len(), 1, "re-enrollment replaces rather than adds");
    assert_eq!(records[0].key, rotated);
    assert_eq!(records[0].fingerprint, fingerprint_of(&rotated.blob));

    // The new key verifies on later connections...
    let mut next = FakeTransport::offering(rotated.clone());
    establish_trusted_session(
        &mut next,
        &trust,
        &ssh_config("db.example.com", 2222, "password"),
        Some("db-password"),
        None,
    )
    .expect("the re-enrolled key connects");
    assert!(next.saw_credentials());

    // ...and the replaced key does not.
    let mut stale_offer = FakeTransport::offering(stale);
    let err = establish_trusted_session(
        &mut stale_offer,
        &trust,
        &ssh_config("db.example.com", 2222, "password"),
        Some("db-password"),
        None,
    )
    .expect_err("the replaced key is no longer trusted");
    assert!(matches!(err, SshTunnelError::HostKeyMismatch(_)));
    assert!(!stale_offer.saw_credentials());
}

#[test]
fn re_enrollment_requires_the_confirmed_fingerprint_to_match_the_offered_key() {
    let stale = host_key("ssh-ed25519", 102);
    let confirmed = host_key("ssh-ed25519", 103);
    let switched = host_key("ssh-ed25519", 104);
    let mut trust = FakeHostTrust::default();
    trust.add_record(record_for("db.example.com", 22, &stale));
    let mut transport = FakeTransport::offering(switched.clone());

    let err = reenroll_host_trust(
        &mut transport,
        &trust,
        "db.example.com",
        22,
        &HostKeyFingerprint {
            key_type: confirmed.key_type.clone(),
            fingerprint: fingerprint_of(&confirmed.blob),
        },
    )
    .expect_err("a server that switched keys after the confirmation is refused");

    assert!(err.contains("different host key"), "{err}");
    assert!(!transport.saw_credentials());
    let records = trust.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].key, stale, "the existing trust is untouched");
}

#[test]
fn re_enrollment_never_overrides_a_known_hosts_entry() {
    let configured = host_key("ssh-ed25519", 105);
    let rotated = host_key("ssh-ed25519", 106);
    let mut trust = FakeHostTrust::default();
    trust.add_known_hosts(&known_hosts_line("db.example.com", &configured));

    let err = reenroll_host_trust(
        &mut FakeTransport::offering(rotated.clone()),
        &trust,
        "db.example.com",
        22,
        &HostKeyFingerprint {
            key_type: rotated.key_type.clone(),
            fingerprint: fingerprint_of(&rotated.blob),
        },
    )
    .expect_err("Gridline does not rewrite the user's known-hosts file");

    assert!(err.contains("known-hosts"), "{err}");
    assert!(
        trust.records().is_empty(),
        "nothing was enrolled over the user's own SSH configuration"
    );

    // Still a dead end on the next connection: known hosts stay authoritative.
    let mut next = FakeTransport::offering(rotated);
    let connect_error = establish_trusted_session(
        &mut next,
        &trust,
        &ssh_config("db.example.com", 22, "password"),
        Some("db-password"),
        None,
    )
    .expect_err("the known-hosts conflict still fails closed");
    assert!(matches!(connect_error, SshTunnelError::HostKeyMismatch(_)));
    assert!(!next.saw_credentials());
}

#[test]
fn re_enrollment_of_an_unknown_host_enrolls_it_deliberately() {
    let key = host_key("ssh-ed25519", 107);
    let trust = FakeHostTrust::default();
    let accepted = HostKeyFingerprint {
        key_type: key.key_type.clone(),
        fingerprint: fingerprint_of(&key.blob),
    };

    let state = reenroll_host_trust(
        &mut FakeTransport::offering(key.clone()),
        &trust,
        "db.example.com",
        22,
        &accepted,
    )
    .expect("an explicit confirmation also establishes first trust");

    assert!(state.is_trusted());
    assert_eq!(trust.records().len(), 1);
    assert_eq!(trust.records()[0].key, key);
}

#[test]
fn no_authentication_entry_point_accepts_a_conflicting_key() {
    let trusted = host_key("ssh-ed25519", 108);
    let offered = host_key("ssh-ed25519", 109);
    let mut trust = FakeHostTrust::default();
    trust.add_record(record_for("db.example.com", 22, &trusted));
    let accepted = HostKeyFingerprint {
        key_type: offered.key_type.clone(),
        fingerprint: fingerprint_of(&offered.blob),
    };

    // 1. Connecting fails closed, before credentials, and leaves trust intact.
    let mut connect = FakeTransport::offering(offered.clone());
    let error = establish_trusted_session(
        &mut connect,
        &trust,
        &ssh_config("db.example.com", 22, "password"),
        Some("db-password"),
        None,
    )
    .expect_err("a changed key cannot connect");
    assert!(matches!(error, SshTunnelError::HostKeyMismatch(_)));
    assert!(!connect.saw_credentials());

    // 2. The acceptance offered during a failed attempt refuses a mismatch too.
    enroll_host_trust(
        &mut FakeTransport::offering(offered.clone()),
        &trust,
        "db.example.com",
        22,
        &accepted,
    )
    .expect_err("the connect-path acceptance offers no override");

    // 3. Probing only reports the conflict.
    let state = probe_host_trust(
        &mut FakeTransport::offering(offered.clone()),
        &trust,
        "db.example.com",
        22,
    )
    .expect("a probe reports state");
    assert!(matches!(state, SshHostTrustState::Mismatch { .. }));

    // Nothing above replaced the trusted key; only the deliberate action does.
    assert_eq!(trust.records()[0].key, trusted);
    reenroll_host_trust(
        &mut FakeTransport::offering(offered.clone()),
        &trust,
        "db.example.com",
        22,
        &accepted,
    )
    .expect("deliberate re-enrollment is the only path that replaces trust");
    assert_eq!(trust.records()[0].key, offered);
}

#[test]
fn only_the_deliberate_command_can_replace_host_trust() {
    // The connect/test path must never be able to replace host trust: a
    // mismatch stays a dead end there (ADR 0001).
    for (name, source) in [
        ("db_viewer.rs", include_str!("db_viewer.rs")),
        ("connections.rs", include_str!("connections.rs")),
    ] {
        assert!(
            !source.contains("reenroll_host_trust"),
            "{name} is on the connect path and must not replace SSH host trust"
        );
    }
}

// ---------------------------------------------------------------------------
// Store-backed provider: a real known-hosts file plus real SQLite records
// ---------------------------------------------------------------------------

#[test]
fn store_backed_provider_honors_known_hosts_and_remembers_enrollments() {
    let dir = std::env::temp_dir().join(format!("gridline-ssh-trust-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let known_hosts_path = dir.join("known_hosts");
    let known = host_key("ssh-ed25519", 95);
    std::fs::write(
        &known_hosts_path,
        format!(
            "# hashed-style comment\n{}\n",
            known_hosts_line("[db.example.com]:2222", &known)
        ),
    )
    .unwrap();

    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::store::migrations::run_migrations(&conn).unwrap();
    let store = std::sync::Arc::new(std::sync::Mutex::new(
        crate::store::Store::from_connection(conn).expect("test store"),
    ));
    let trust = StoreHostTrust::with_known_hosts_paths(store, vec![known_hosts_path.clone()]);

    // A real known-hosts entry verifies silently, on its own port.
    let mut transport = FakeTransport::offering(known.clone());
    let state = probe_host_trust(&mut transport, &trust, "db.example.com", 2222).unwrap();
    assert!(matches!(
        state,
        SshHostTrustState::Trusted {
            source: crate::models::ssh_trust::TrustSource::KnownHosts,
            ..
        }
    ));

    // An accepted fingerprint is persisted and trusted on the next attempt.
    let enrolled = host_key("ssh-ed25519", 96);
    let accepted = HostKeyFingerprint {
        key_type: enrolled.key_type.clone(),
        fingerprint: fingerprint_of(&enrolled.blob),
    };
    enroll_host_trust(
        &mut FakeTransport::offering(enrolled.clone()),
        &trust,
        "new.example.com",
        22,
        &accepted,
    )
    .expect("enrollment writes through to the store");

    let mut again = FakeTransport::offering(enrolled.clone());
    let state = probe_host_trust(&mut again, &trust, "new.example.com", 22).unwrap();
    assert!(matches!(
        state,
        SshHostTrustState::Trusted {
            source: crate::models::ssh_trust::TrustSource::Enrolled,
            ..
        }
    ));

    let stored = trust
        .lookup("new.example.com", 22)
        .unwrap()
        .expect("record");
    assert_eq!(stored.key, enrolled, "the key blob survives SQLite");
    assert_eq!(stored.fingerprint, fingerprint_of(&enrolled.blob));
    assert!(
        trust.lookup("new.example.com", 2222).unwrap().is_none(),
        "trust is keyed by endpoint, not host name"
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn store_backed_re_enrollment_replaces_the_row_with_public_metadata_only() {
    let dir = std::env::temp_dir().join(format!("gridline-ssh-reenroll-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    // A file-backed store so the persisted row itself can be inspected.
    let db_path = dir.join("store.sqlite");
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    crate::store::migrations::run_migrations(&conn).unwrap();
    let store = std::sync::Arc::new(std::sync::Mutex::new(
        crate::store::Store::from_connection(conn).expect("test store"),
    ));
    let trust = StoreHostTrust::with_known_hosts_paths(store, vec![dir.join("known_hosts")]);

    let stale = host_key("ssh-ed25519", 97);
    trust
        .remember(&record_for("db.example.com", 2222, &stale))
        .unwrap();
    let rotated = host_key("ssh-ed25519", 98);
    let accepted = HostKeyFingerprint {
        key_type: rotated.key_type.clone(),
        fingerprint: fingerprint_of(&rotated.blob),
    };

    let mut transport = FakeTransport::offering(rotated.clone());
    reenroll_host_trust(&mut transport, &trust, "db.example.com", 2222, &accepted)
        .expect("re-enrollment writes through to the store");
    assert!(!transport.saw_credentials());

    let stored = trust
        .lookup("db.example.com", 2222)
        .unwrap()
        .expect("record");
    assert_eq!(stored.key, rotated);
    assert_eq!(stored.fingerprint, fingerprint_of(&rotated.blob));
    assert!(
        !stored.enrolled_at.is_empty(),
        "the acceptance is timestamped"
    );

    // The persisted row holds host-key metadata only: no password, private key
    // or passphrase column exists, so none can be stored.
    let inspect = rusqlite::Connection::open(&db_path).unwrap();
    let columns: Vec<String> = {
        let mut stmt = inspect
            .prepare("PRAGMA table_info(ssh_host_trust)")
            .unwrap();
        stmt.query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|c| c.unwrap())
            .collect()
    };
    assert_eq!(
        columns,
        vec![
            "host".to_string(),
            "port".to_string(),
            "key_type".to_string(),
            "fingerprint".to_string(),
            "key_blob".to_string(),
            "enrolled_at".to_string(),
        ]
    );
    drop(inspect);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn store_backed_re_enrollment_is_verified_by_later_connections() {
    // The durable half of ticket 22: the replacement is written to the local
    // store, so a later connection — after a restart, through a freshly
    // constructed provider — verifies the new key and refuses the old one.
    let dir = std::env::temp_dir().join(format!(
        "gridline-ssh-reenroll-later-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("store.sqlite");
    let known_hosts_path = dir.join("known_hosts");

    let stale = host_key("ssh-ed25519", 120);
    let rotated = host_key("ssh-ed25519", 121);

    {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        let store = std::sync::Arc::new(std::sync::Mutex::new(
            crate::store::Store::from_connection(conn).expect("test store"),
        ));
        let trust = StoreHostTrust::with_known_hosts_paths(store, vec![known_hosts_path.clone()]);
        trust
            .remember(&record_for("db.example.com", 2222, &stale))
            .unwrap();

        let accepted = HostKeyFingerprint {
            key_type: rotated.key_type.clone(),
            fingerprint: fingerprint_of(&rotated.blob),
        };
        reenroll_host_trust(
            &mut FakeTransport::offering(rotated.clone()),
            &trust,
            "db.example.com",
            2222,
            &accepted,
        )
        .expect("the confirmed fingerprint replaces the stored trust");
    }

    // A later connection re-opens the store from disk, as an app restart would.
    let later_conn = rusqlite::Connection::open(&db_path).unwrap();
    crate::store::migrations::run_migrations(&later_conn).unwrap();
    let later_store = std::sync::Arc::new(std::sync::Mutex::new(
        crate::store::Store::from_connection(later_conn).expect("test store"),
    ));
    let later = StoreHostTrust::with_known_hosts_paths(later_store, vec![known_hosts_path]);

    // The new key verifies without prompting and is allowed to authenticate.
    let state = probe_host_trust(
        &mut FakeTransport::offering(rotated.clone()),
        &later,
        "db.example.com",
        2222,
    )
    .unwrap();
    assert!(
        matches!(
            state,
            SshHostTrustState::Trusted {
                source: TrustSource::Enrolled,
                ..
            }
        ),
        "the re-enrolled key verifies on a later connection, got {state:?}"
    );

    let mut session = FakeTransport::offering(rotated.clone());
    establish_trusted_session(
        &mut session,
        &later,
        &ssh_config("db.example.com", 2222, "password"),
        Some("db-password"),
        None,
    )
    .expect("the re-enrolled key connects");
    assert!(session.saw_credentials());

    // The replaced key is a conflict again, before any credential is sent.
    let mut replaced = FakeTransport::offering(stale);
    let err = establish_trusted_session(
        &mut replaced,
        &later,
        &ssh_config("db.example.com", 2222, "password"),
        Some("db-password"),
        None,
    )
    .expect_err("the replaced key is no longer trusted");
    assert!(matches!(err, SshTunnelError::HostKeyMismatch(_)));
    assert!(!replaced.saw_credentials());

    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// IPC contract shared with the frontend
// ---------------------------------------------------------------------------

#[test]
fn trust_states_serialize_to_the_frontend_contract() {
    let key = host_key("ssh-ed25519", 90);
    let unknown = serde_json::to_value(SshHostTrustState::Unknown {
        host: "db.example.com".into(),
        port: 2222,
        key_type: key.key_type.clone(),
        fingerprint: fingerprint_of(&key.blob),
    })
    .unwrap();
    assert_eq!(unknown["state"], "unknown");
    assert_eq!(unknown["port"], 2222);
    assert!(unknown["fingerprint"]
        .as_str()
        .unwrap()
        .starts_with("SHA256:"));

    let mismatch = serde_json::to_value(SshHostTrustState::Mismatch {
        host: "db.example.com".into(),
        port: 22,
        key_type: key.key_type.clone(),
        fingerprint: "SHA256:actual".into(),
        expected_key_type: key.key_type.clone(),
        expected_fingerprint: "SHA256:expected".into(),
        source: crate::models::ssh_trust::TrustSource::KnownHosts,
    })
    .unwrap();
    assert_eq!(mismatch["state"], "mismatch");
    assert_eq!(mismatch["source"], "known_hosts");
    assert_eq!(mismatch["expected_fingerprint"], "SHA256:expected");

    let trusted = serde_json::to_value(SshHostTrustState::Trusted {
        host: "db.example.com".into(),
        port: 22,
        key_type: key.key_type.clone(),
        fingerprint: fingerprint_of(&key.blob),
        source: crate::models::ssh_trust::TrustSource::Enrolled,
    })
    .unwrap();
    assert_eq!(trusted["state"], "trusted");
    assert_eq!(trusted["source"], "enrolled");
}
