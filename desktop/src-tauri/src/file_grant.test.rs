use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// A controllable clock: grants age only when a test advances `elapsed_ms`.
pub struct FakeClock {
    base: Instant,
    elapsed_ms: Arc<AtomicU64>,
}

impl FakeClock {
    fn new() -> (Self, Arc<AtomicU64>) {
        let base = Instant::now();
        let elapsed_ms = Arc::new(AtomicU64::new(0));
        (
            Self {
                base,
                elapsed_ms: elapsed_ms.clone(),
            },
            elapsed_ms,
        )
    }

    fn clock_fn(&self) -> Clock {
        let base = self.base;
        let elapsed = self.elapsed_ms.clone();
        Box::new(move || base + Duration::from_millis(elapsed.load(Ordering::SeqCst)))
    }
}

fn store_with_fake_clock() -> (FileGrantStore, Arc<AtomicU64>) {
    let (clock, elapsed) = FakeClock::new();
    (
        FileGrantStore::with_clock(GRANT_TTL, clock.clock_fn()),
        elapsed,
    )
}

/// A picker that answers with whatever the test scripts, and records the
/// request it received (so intent propagation is provable).
struct FakePicker {
    answer: Result<Option<PickedFile>, String>,
    seen: std::sync::Mutex<Vec<PickRequest>>,
}

impl FakePicker {
    fn returning(path: &str) -> Self {
        Self {
            answer: Ok(Some(PickedFile {
                path: path.to_string(),
            })),
            seen: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn cancelled() -> Self {
        Self {
            answer: Ok(None),
            seen: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn last_request(&self) -> Option<PickRequest> {
        self.seen.lock().unwrap().last().cloned()
    }
}

impl FilePicker for FakePicker {
    fn pick(&self, request: &PickRequest) -> Result<Option<PickedFile>, String> {
        self.seen.lock().unwrap().push(request.clone());
        self.answer.clone()
    }
}

fn write_request() -> PickRequest {
    PickRequest {
        intent: FileIntent::Write,
        title: "Save backup as".into(),
        default_name: Some("backup.dump".into()),
        filters: vec![FileFilter {
            name: "Backup".into(),
            extensions: vec!["dump".into()],
        }],
    }
}

// ---------------------------------------------------------------------------
// A native selection yields a grant the backup write can consume
// ---------------------------------------------------------------------------

#[test]
fn native_selection_yields_a_write_grant_for_the_picked_path() {
    let (store, _elapsed) = store_with_fake_clock();
    let picker = FakePicker::returning("/tmp/gridline-backup.dump");

    let grant = grant_selection(&store, &picker, &write_request())
        .expect("selection should succeed")
        .expect("a picked file yields a grant");

    assert_eq!(grant.path, "/tmp/gridline-backup.dump");
    assert_eq!(grant.display_name, "gridline-backup.dump");
    assert_eq!(grant.intent, FileIntent::Write);
    assert_eq!(grant.expires_in_seconds, 300);
    assert!(!grant.id.is_empty());

    // The brokered selection asked for a write, not a read.
    assert_eq!(picker.last_request().unwrap().intent, FileIntent::Write);

    // The grant authorizes exactly that write, once.
    let consumed = store
        .consume(&grant.id, FileIntent::Write)
        .expect("a fresh write grant is consumable");
    assert_eq!(
        consumed,
        std::path::PathBuf::from("/tmp/gridline-backup.dump")
    );
}

#[test]
fn cancelled_native_selection_mints_no_grant() {
    let (store, _elapsed) = store_with_fake_clock();
    let picker = FakePicker::cancelled();

    let grant = grant_selection(&store, &picker, &write_request()).expect("cancel is not an error");
    assert!(grant.is_none());
    assert_eq!(store.active_grants(), 0);
}

#[test]
fn a_relative_path_is_never_minted_into_a_grant() {
    let (store, _elapsed) = store_with_fake_clock();
    let picker = FakePicker::returning("relative/backup.dump");

    let err = grant_selection(&store, &picker, &write_request()).unwrap_err();
    assert!(err.contains("absolute"), "unexpected error: {err}");
    assert_eq!(store.active_grants(), 0);
}

// ---------------------------------------------------------------------------
// A raw renderer-supplied path authorizes nothing
// ---------------------------------------------------------------------------

#[test]
fn a_raw_path_is_not_a_grant_and_is_rejected() {
    let (store, _elapsed) = store_with_fake_clock();
    // Mint a real grant so the store is not simply empty.
    let granted = store.mint(
        std::path::PathBuf::from("/tmp/real.dump"),
        FileIntent::Write,
    );

    // A path handed in where a grant id is required is rejected, and the
    // legitimate grant is untouched (a rejected attempt consumes nothing).
    let err = store
        .consume("/tmp/raw-renderer-path.dump", FileIntent::Write)
        .unwrap_err();
    assert_eq!(err.code(), CODE_INVALID);
    assert_eq!(err, GrantError::Unknown);

    assert!(
        store.consume(&granted.id, FileIntent::Write).is_ok(),
        "the legitimate grant must survive a rejected raw-path attempt"
    );
}

#[test]
fn an_empty_grant_id_is_rejected() {
    let (store, _elapsed) = store_with_fake_clock();
    assert_eq!(
        store.consume("", FileIntent::Write).unwrap_err().code(),
        CODE_INVALID
    );
}

// ---------------------------------------------------------------------------
// Single job, single use, single intent
// ---------------------------------------------------------------------------

#[test]
fn a_grant_cannot_be_reused_for_a_second_job() {
    let (store, _elapsed) = store_with_fake_clock();
    let grant = store.mint(
        std::path::PathBuf::from("/tmp/once.dump"),
        FileIntent::Write,
    );

    assert!(store.consume(&grant.id, FileIntent::Write).is_ok());

    let replay = store.consume(&grant.id, FileIntent::Write).unwrap_err();
    assert_eq!(replay, GrantError::AlreadyConsumed);
    assert_eq!(replay.code(), CODE_CONSUMED);
}

#[test]
fn a_write_grant_cannot_be_consumed_for_a_read() {
    let (store, _elapsed) = store_with_fake_clock();
    let grant = store.mint(std::path::PathBuf::from("/tmp/out.dump"), FileIntent::Write);

    let err = store.consume(&grant.id, FileIntent::Read).unwrap_err();
    assert_eq!(err.code(), CODE_WRONG_INTENT);
    assert_eq!(
        err,
        GrantError::WrongIntent {
            expected: FileIntent::Read,
            actual: FileIntent::Write,
        }
    );

    // A wrong-intent attempt is not a use: the grant still authorizes its own
    // write (so a mis-routed call cannot silently burn the selection).
    assert!(store.consume(&grant.id, FileIntent::Write).is_ok());
}

#[test]
fn a_read_grant_cannot_be_consumed_for_a_write() {
    let (store, _elapsed) = store_with_fake_clock();
    let grant = store.mint(std::path::PathBuf::from("/tmp/in.sql"), FileIntent::Read);
    assert_eq!(
        store
            .consume(&grant.id, FileIntent::Write)
            .unwrap_err()
            .code(),
        CODE_WRONG_INTENT
    );
}

// ---------------------------------------------------------------------------
// Five-minute expiry
// ---------------------------------------------------------------------------

#[test]
fn a_grant_is_still_valid_just_under_five_minutes() {
    let (store, elapsed) = store_with_fake_clock();
    let grant = store.mint(
        std::path::PathBuf::from("/tmp/fresh.dump"),
        FileIntent::Write,
    );

    elapsed.store(4 * 60 * 1000 + 59 * 1000, Ordering::SeqCst);
    assert!(store.consume(&grant.id, FileIntent::Write).is_ok());
}

#[test]
fn a_grant_older_than_five_minutes_is_rejected_with_the_expired_state() {
    let (store, elapsed) = store_with_fake_clock();
    let grant = store.mint(
        std::path::PathBuf::from("/tmp/stale.dump"),
        FileIntent::Write,
    );

    elapsed.store(5 * 60 * 1000 + 1, Ordering::SeqCst);
    let err = store.consume(&grant.id, FileIntent::Write).unwrap_err();

    // The expired case is its own visible state, not a silent fallback and not
    // a generic "unknown selection".
    assert_eq!(err, GrantError::Expired);
    assert_eq!(err.code(), CODE_EXPIRED);
    assert!(err.message().contains("expired"));
}

#[test]
fn an_expired_grant_keeps_reporting_expired_until_it_is_forgotten() {
    let (store, elapsed) = store_with_fake_clock();
    let grant = store.mint(
        std::path::PathBuf::from("/tmp/stale.dump"),
        FileIntent::Write,
    );

    elapsed.store(5 * 60 * 1000 + 1, Ordering::SeqCst);
    assert_eq!(
        store.consume(&grant.id, FileIntent::Write).unwrap_err(),
        GrantError::Expired
    );
    // A second attempt reports the same visible state rather than degrading to
    // "unknown".
    assert_eq!(
        store.consume(&grant.id, FileIntent::Write).unwrap_err(),
        GrantError::Expired
    );

    // Well past expiry the entry is dropped for memory hygiene.
    elapsed.store(
        GRANT_TTL.as_millis() as u64 + RETENTION_GRACE.as_millis() as u64 + 1,
        Ordering::SeqCst,
    );
    store.mint(
        std::path::PathBuf::from("/tmp/other.dump"),
        FileIntent::Write,
    );
    assert_eq!(
        store.consume(&grant.id, FileIntent::Write).unwrap_err(),
        GrantError::Unknown
    );
}

#[test]
fn a_consumed_grant_does_not_become_reusable_when_time_passes() {
    let (store, elapsed) = store_with_fake_clock();
    let grant = store.mint(
        std::path::PathBuf::from("/tmp/once.dump"),
        FileIntent::Write,
    );
    assert!(store.consume(&grant.id, FileIntent::Write).is_ok());

    elapsed.store(1000, Ordering::SeqCst);
    assert_eq!(
        store.consume(&grant.id, FileIntent::Write).unwrap_err(),
        GrantError::AlreadyConsumed
    );
}

// ---------------------------------------------------------------------------
// IPC error shape
// ---------------------------------------------------------------------------

#[test]
fn grant_errors_carry_a_stable_code_prefix_for_the_ui() {
    for error in [
        GrantError::Unknown,
        GrantError::Expired,
        GrantError::AlreadyConsumed,
        GrantError::WrongIntent {
            expected: FileIntent::Read,
            actual: FileIntent::Write,
        },
    ] {
        let ipc = error.to_ipc();
        let (code, message) = ipc.split_once(": ").expect("code: message");
        assert_eq!(code, error.code());
        assert!(code.starts_with("file-grant-"), "unexpected code: {code}");
        assert!(!message.is_empty());
        // Never leak a path or a grant id into an error.
        assert!(!message.contains('/'), "message leaks a path: {message}");
    }
}

#[test]
fn grant_ids_are_unique_per_selection() {
    let (store, _elapsed) = store_with_fake_clock();
    let a = store.mint(std::path::PathBuf::from("/tmp/a.dump"), FileIntent::Write);
    let b = store.mint(std::path::PathBuf::from("/tmp/b.dump"), FileIntent::Write);
    assert_ne!(a.id, b.id);
    assert_eq!(store.active_grants(), 2);
}
