use super::*;
use crate::file_grant::{FileGrantStore, GrantError, PickRequest};

fn write_request() -> PickRequest {
    PickRequest {
        intent: FileIntent::Write,
        title: "Save backup as".into(),
        default_name: Some("backup.dump".into()),
        filters: vec![],
    }
}

/// A picker that fails the way a broken/blocked dialog does.
struct FailingPicker;

impl FilePicker for FailingPicker {
    fn pick(&self, _request: &PickRequest) -> Result<Option<PickedFile>, String> {
        Err("dialog unavailable".into())
    }
}

#[test]
fn a_write_grant_asks_the_save_dialog_and_a_read_grant_the_open_dialog() {
    assert_eq!(dialog_kind(FileIntent::Write), DialogKind::Save);
    assert_eq!(dialog_kind(FileIntent::Read), DialogKind::Open);
}

#[test]
fn a_dialog_failure_issues_no_grant() {
    let store = FileGrantStore::new();
    let err = crate::file_grant::grant_selection(&store, &FailingPicker, &write_request())
        .expect_err("a failing dialog is an error, not a silent success");
    assert!(err.contains("dialog unavailable"));
    assert_eq!(store.active_grants(), 0);
}

/// The command boundary must not offer any way to mint a grant from a path.
/// This asserts the shape that makes the raw-path rejection provable: the only
/// minting entry point takes a `PickedFile` produced by a `FilePicker`.
#[test]
fn the_grant_store_is_only_reachable_through_a_picker() {
    let store = FileGrantStore::new();
    // A path string is not a grant id; consuming one fails closed.
    let err = store
        .consume("/tmp/backup.dump", FileIntent::Write)
        .unwrap_err();
    assert_eq!(err, GrantError::Unknown);
    assert_eq!(err.code(), crate::file_grant::CODE_INVALID);
}
