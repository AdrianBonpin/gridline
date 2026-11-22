//! Ticket 27: session-only credentials reach tool jobs.
//!
//! These tests exercise the credential seam a tool job resolves through: a
//! keychain-enabled connection keeps reading the OS keychain, a connection with
//! keychain persistence turned off authenticates from backend memory, and a
//! missing session credential is a named rejection (so the UI can prompt) rather
//! than an empty password handed to `pg_dump`.

use super::*;

/// A keychain-enabled connection keeps its existing behavior: the credential
/// comes from the OS keychain, even if a session copy happens to exist.
#[test]
fn a_keychain_enabled_job_reads_the_keychain() {
    let store = SessionCredentialStore::new();
    store.set("conn-keychain", "stale-session-copy");

    let credential = resolve_tool_credential(&store, true, "conn-keychain", || {
        Ok(Some("kc-secret".into()))
    })
    .expect("a keychain-enabled job resolves through the keychain");

    assert_eq!(credential, "kc-secret");
}

/// A keychain-enabled connection whose keychain read fails keeps the previous
/// behavior exactly: an empty credential, not a refusal (nothing about tool
/// jobs changes for keychain users).
#[test]
fn a_keychain_enabled_job_without_a_keychain_entry_keeps_the_old_empty_fallback() {
    let store = SessionCredentialStore::new();

    let credential = resolve_tool_credential(&store, true, "conn-keychain", || Ok(None))
        .expect("a missing keychain entry is not an error here");

    assert_eq!(credential, "");
}

/// With keychain persistence off, the job reuses the session credential held in
/// backend memory and never touches the OS keychain.
#[test]
fn a_keychain_off_job_uses_the_session_credential() {
    let store = SessionCredentialStore::new();
    store.set("conn-session", "session-secret");

    let credential = resolve_tool_credential(&store, false, "conn-session", || {
        panic!("a session-only connection must not read the OS keychain")
    })
    .expect("the session credential is available");

    assert_eq!(credential, "session-secret");
}

/// No session credential must not become an empty password: the job does not
/// start, and the rejection names the connection so a sync can prompt for the
/// right side.
#[test]
fn a_keychain_off_job_without_a_session_credential_asks_for_one() {
    let store = SessionCredentialStore::new();

    let error = resolve_tool_credential(&store, false, "conn-session", || {
        panic!("a session-only connection must not read the OS keychain")
    })
    .expect_err("a missing session credential must refuse the job");

    assert_eq!(error, "session-credential-required:conn-session");
}

/// An empty string is not a credential. The connect flow asks again in that
/// case too, so a tool must never authenticate silently with nothing.
#[test]
fn an_empty_session_credential_asks_for_a_password() {
    let store = SessionCredentialStore::new();
    store.set("conn-session", "");

    let error = resolve_tool_credential(&store, false, "conn-session", || Ok(None))
        .expect_err("an empty credential is not a credential");

    assert_eq!(error, "session-credential-required:conn-session");
}

/// Forgetting (connection deleted, credential replaced) removes the credential
/// rather than leaving a stale one available to a later job.
#[test]
fn forgetting_a_session_credential_removes_it() {
    let store = SessionCredentialStore::new();
    store.set("conn-session", "session-secret");
    store.forget("conn-session");

    assert!(
        store.get("conn-session").is_none(),
        "a forgotten credential must be gone"
    );
    let error = resolve_tool_credential(&store, false, "conn-session", || Ok(None))
        .expect_err("the job must ask again");
    assert_eq!(error, "session-credential-required:conn-session");
}

/// The rejection carries only the connection id: the credential itself is never
/// part of an error message.
#[test]
fn the_rejection_never_contains_the_credential() {
    let store = SessionCredentialStore::new();
    store.set("conn-session", "super-secret-value");
    store.forget("conn-session");

    let error = resolve_tool_credential(&store, false, "conn-session", || Ok(None))
        .expect_err("no credential");
    assert!(
        !error.contains("super-secret-value"),
        "the refusal must not echo a credential: {error}"
    );
}
