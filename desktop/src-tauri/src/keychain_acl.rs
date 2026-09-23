//! Keychain ACL normalization and repair for stored secrets (macOS).
//!
//! # Why this exists
//!
//! Generic-password items stored via the legacy keychain API are guarded by an
//! item ACL. For a dev (linker-signed / ad-hoc) binary macOS records that ACL's
//! trusted application as **the path of the executable** — not a code
//! requirement — so the item stays readable across rebuilds *as long as the
//! binary keeps living at that path*. A properly signed bundle is recorded as a
//! code requirement plus a `cdhash` partition list, which is stable across
//! versions and even moves.
//!
//! Two failure modes follow from that:
//!
//! 1. **The path changes** (monorepo move `src-tauri/` → `desktop/src-tauri/`,
//!    app reinstalled elsewhere, release vs. dev binary). The stored paths no
//!    longer match the running binary, so macOS treats it as a *foreign* app and
//!    asks for the keychain password on **every** access — per secret, and with
//!    no "Always Allow", because the item's ACL lists only other apps.
//! 2. **A differently-signed build wrote the item** and the pin never ran again.
//!
//! Pinning only after writes (`after_store`) can't repair either case: writing
//! to an item we can't access already needs the same authorization, so the ACL
//! is never corrected. This module therefore also *repairs before reads*.
//!
//! # How the repair works
//!
//! [`ensure_access`] first asks, **without prompting**, whether this process is
//! already represented in the item's ACL (see [`is_item_trusted`]). Only when it
//! is not does it call `SecKeychainItemSetAccess` with an ACL whose trusted list
//! is exactly this app. That call is what macOS gates behind the authorization
//! dialog — so a stale item costs the user **one** authorization, and every
//! later access (including after future rebuilds at the same path) is silent.
//! Items that are already trusted are left alone, so the ACL never accumulates
//! duplicate entries.
//!
//! All operations are best-effort: they log to stderr and never fail the
//! caller's keychain read/write.

#[cfg(target_os = "macos")]
mod macos_ffi {
    use core_foundation::base::{CFTypeID, CFTypeRef};

    /// Minimal `TCFType` wrapper for `SecTrustedApplication` — the
    /// security-framework crate exposes no high-level API for it.
    #[repr(C)]
    pub struct OpaqueSecTrustedApplication {
        _priv: [u8; 0],
    }
    pub type SecTrustedApplicationRef = *mut OpaqueSecTrustedApplication;

    use core_foundation::{declare_TCFType, impl_TCFType};
    declare_TCFType!(SecTrustedApplication, SecTrustedApplicationRef);
    impl_TCFType!(
        SecTrustedApplication,
        SecTrustedApplicationRef,
        SecTrustedApplicationGetTypeID
    );
    unsafe impl Send for SecTrustedApplication {}
    unsafe impl Sync for SecTrustedApplication {}

    extern "C" {
        // SecAccess/SecTrustedApplication APIs are deprecated in the macOS SDK
        // but remain fully functional (the legacy keychain store this app uses
        // via tauri-plugin-keyring-store relies on the same API family).
        pub fn SecTrustedApplicationGetTypeID() -> CFTypeID;
        pub fn SecTrustedApplicationCreateFromPath(
            path: CFTypeRef,
            app: *mut SecTrustedApplicationRef,
        ) -> i32;
        pub fn SecTrustedApplicationCopyData(
            app: CFTypeRef,
            data: *mut core_foundation::data::CFDataRef,
        ) -> i32;
        pub fn SecAccessCreate(
            descriptor: CFTypeRef,
            trustedlist: core_foundation::array::CFArrayRef,
            access: *mut security_framework_sys::base::SecAccessRef,
        ) -> i32;
        pub fn SecKeychainItemCopyAccess(
            item: security_framework_sys::base::SecKeychainItemRef,
            access: *mut security_framework_sys::base::SecAccessRef,
        ) -> i32;
        pub fn SecAccessCopyACLList(
            access: security_framework_sys::base::SecAccessRef,
            list: *mut core_foundation::array::CFArrayRef,
        ) -> i32;
        pub fn SecACLCopyContents(
            acl: CFTypeRef,
            apps: *mut core_foundation::array::CFArrayRef,
            desc: *mut core_foundation::string::CFStringRef,
            prompt: *mut u32,
        ) -> i32;
        pub fn SecKeychainItemSetAccess(
            item: security_framework_sys::base::SecKeychainItemRef,
            access: security_framework_sys::base::SecAccessRef,
        ) -> i32;
    }
}

#[cfg(target_os = "macos")]
use core_foundation::base::TCFType;

#[cfg(target_os = "macos")]
use macos_ffi::{
    SecACLCopyContents, SecAccessCopyACLList, SecAccessCreate, SecKeychainItemCopyAccess,
    SecKeychainItemSetAccess, SecTrustedApplication, SecTrustedApplicationCopyData,
    SecTrustedApplicationCreateFromPath,
};

/// Best-effort ACL normalization after a successful keychain write.
pub fn after_store(app: &tauri::AppHandle, account: &str) {
    ensure_access(app, account);
}

/// Best-effort ACL repair *before* reading a secret.
///
/// A stale ACL is what makes macOS ask for the keychain password on every
/// access, so this runs before reads: it authorizes/repairs the item once and
/// leaves it silent from then on. Prompt-free (and cheap) when the item is
/// already trusted or does not exist.
pub fn before_read(app: &tauri::AppHandle, account: &str) {
    ensure_access(app, account);
}

/// Resolve the keyring service name (the Tauri bundle identifier) and repair the
/// item's ACL when this app is not already trusted. Never fails the caller.
fn ensure_access(app: &tauri::AppHandle, account: &str) {
    let service = app.config().identifier.clone();
    if let Err(e) = ensure_item_acl(&service, account) {
        eprintln!("[keychain_acl] skipped for {account}: {e}");
    }
}

/// Make sure this app can read `account` without an authorization prompt.
///
/// Idempotent and cheap when the item is already trusted (the common case):
/// the trust check is a metadata-only, prompt-free lookup. Returns `Ok(())` when
/// the item exists and now trusts this app, or when there is nothing to do.
#[cfg(target_os = "macos")]
pub fn ensure_item_acl(service: &str, account: &str) -> Result<(), String> {
    use security_framework::os::macos::access::SecAccess;
    use security_framework_sys::base::SecAccessRef;

    // Locate the item WITHOUT reading its secret: a ref-only lookup
    // (`kSecReturnRef`, no data/attributes) never triggers an authorization
    // prompt, so merely probing an item we can't yet access is safe.
    let item = match item_ref(service, account)? {
        Some(item) => item,
        // No item (yet) — nothing to normalize.
        None => return Ok(()),
    };

    // Already trusted → leave the ACL alone (repairing again would only
    // authorize-and-append a duplicate entry).
    if is_item_trusted(&item) {
        return Ok(());
    }

    fn cvt(status: i32) -> Result<(), String> {
        if status == 0 {
            Ok(())
        } else {
            Err(format!("security framework error {status}"))
        }
    }

    // Build an access object whose trusted list is exactly this app. A NULL
    // path resolves the trusted application to the current process's identity
    // (its executable path for ad-hoc dev builds, its code requirement for a
    // signed bundle).
    unsafe {
        let mut trusted_app_ref = std::ptr::null_mut();
        cvt(SecTrustedApplicationCreateFromPath(
            std::ptr::null(),
            &mut trusted_app_ref,
        ))?;
        let trusted_app = SecTrustedApplication::wrap_under_create_rule(trusted_app_ref);
        let trusted_list = core_foundation::array::CFArray::from_CFTypes(&[trusted_app]);

        let descriptor = core_foundation::string::CFString::new("Gridline");
        let mut access_ref: SecAccessRef = std::ptr::null_mut();
        cvt(SecAccessCreate(
            descriptor.as_concrete_TypeRef() as core_foundation::base::CFTypeRef,
            trusted_list.as_concrete_TypeRef(),
            &mut access_ref,
        ))?;
        let access = SecAccess::wrap_under_create_rule(access_ref);

        // Replace the item's ACL. Silent when this app already owns the item;
        // the one-time authorization dialog otherwise (this is what makes a
        // stale item permanently silent again).
        cvt(SecKeychainItemSetAccess(
            item.as_concrete_TypeRef(),
            access.as_concrete_TypeRef(),
        ))
    }
}

/// Ref-only lookup for a generic-password item. Prompt-free.
#[cfg(target_os = "macos")]
fn item_ref(
    service: &str,
    account: &str,
) -> Result<Option<security_framework::os::macos::keychain_item::SecKeychainItem>, String> {
    use security_framework::item::{ItemClass, ItemSearchOptions, Reference, SearchResult};

    let found = match ItemSearchOptions::new()
        .class(ItemClass::generic_password())
        .service(service)
        .account(account)
        .load_refs(true)
        .load_data(false)
        .load_attributes(false)
        .search()
    {
        Ok(found) => found,
        // `search()` reports "nothing matched" as an error, not an empty vec.
        // That is the normal case for connections without a stored secret.
        Err(e) if e.code() == security_framework_sys::base::errSecItemNotFound => return Ok(None),
        Err(e) => return Err(format!("keychain item lookup failed: {e}")),
    };

    Ok(match found.first() {
        Some(SearchResult::Ref(Reference::KeychainItem(item))) => Some(item.clone()),
        // No item or an unexpected result shape — nothing to normalize.
        _ => None,
    })
}

/// This process's identity as a `SecTrustedApplication`, serialized.
///
/// For a signed bundle this is the code requirement; for a dev/ad-hoc binary it
/// is the resolved executable path (NUL-terminated). Either way, byte-comparing
/// it against an item's ACL entries tells us whether the ACL already admits us.
#[cfg(target_os = "macos")]
fn own_identity() -> Option<Vec<u8>> {
    unsafe {
        let mut app = std::ptr::null_mut();
        if SecTrustedApplicationCreateFromPath(std::ptr::null(), &mut app) != 0 || app.is_null() {
            return None;
        }
        let app = SecTrustedApplication::wrap_under_create_rule(app);
        let mut data: core_foundation::data::CFDataRef = std::ptr::null();
        if SecTrustedApplicationCopyData(
            app.as_concrete_TypeRef() as core_foundation::base::CFTypeRef,
            &mut data,
        ) != 0
            || data.is_null()
        {
            return None;
        }
        let bytes = std::slice::from_raw_parts(
            core_foundation::data::CFDataGetBytePtr(data),
            core_foundation::data::CFDataGetLength(data) as usize,
        )
        .to_vec();
        core_foundation::base::CFRelease(data as core_foundation::base::CFTypeRef);
        Some(bytes)
    }
}

/// Whether this process is already admitted by the item's ACL — **prompt-free**.
///
/// True when an ACL entry's serialized trusted application is byte-identical to
/// this process's identity, or when the item carries a `cdhash:` partition list
/// (how macOS records access for a signed bundle — we leave those untouched).
#[cfg(target_os = "macos")]
fn is_item_trusted(item: &security_framework::os::macos::keychain_item::SecKeychainItem) -> bool {
    use core_foundation::array::{CFArray, CFArrayRef};
    use core_foundation::base::{CFTypeRef, TCFType};
    use core_foundation::string::{CFString, CFStringRef};

    let Some(own) = own_identity() else {
        return false;
    };

    unsafe {
        let mut access: security_framework_sys::base::SecAccessRef = std::ptr::null_mut();
        if SecKeychainItemCopyAccess(item.as_concrete_TypeRef(), &mut access) != 0
            || access.is_null()
        {
            return false;
        }
        let mut acl_list: CFArrayRef = std::ptr::null();
        if SecAccessCopyACLList(access, &mut acl_list) != 0 || acl_list.is_null() {
            return false;
        }
        let acls = CFArray::<CFTypeRef>::wrap_under_create_rule(acl_list);

        for acl in acls.iter() {
            let mut apps: CFArrayRef = std::ptr::null();
            let mut desc: CFStringRef = std::ptr::null();
            let mut prompt: u32 = 0;
            if SecACLCopyContents(*acl, &mut apps, &mut desc, &mut prompt) != 0 {
                continue;
            }
            if !desc.is_null() {
                // Signed-bundle items store a code-signing partition list here.
                if CFString::wrap_under_create_rule(desc)
                    .to_string()
                    .contains("cdhash:")
                {
                    return true;
                }
            }
            if apps.is_null() {
                continue;
            }
            let list = CFArray::<CFTypeRef>::wrap_under_create_rule(apps);
            for app in list.iter() {
                let mut data: core_foundation::data::CFDataRef = std::ptr::null();
                if SecTrustedApplicationCopyData(*app, &mut data) != 0 || data.is_null() {
                    continue;
                }
                let bytes = std::slice::from_raw_parts(
                    core_foundation::data::CFDataGetBytePtr(data),
                    core_foundation::data::CFDataGetLength(data) as usize,
                );
                if bytes == own.as_slice() {
                    return true;
                }
            }
        }
        false
    }
}

/// Non-macOS platforms have no keychain ACL concept — nothing to do.
#[cfg(not(target_os = "macos"))]
pub fn ensure_item_acl(_service: &str, _account: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use security_framework::os::macos::keychain::SecKeychain;
    use security_framework::os::macos::passwords::find_generic_password;

    /// A missing item is a silent no-op — no lookup errors, no prompts. This is
    /// the path taken for every connection that never stored a password, so it
    /// must stay cheap and quiet.
    #[test]
    fn ensure_item_acl_missing_item_is_noop() {
        let service = "com.adrianbonpin.gridline.acl-test.missing";
        let account = "definitely-not-stored";
        ensure_item_acl(service, account).expect("no-op for a missing item");
    }

    /// Real-keychain integration test: creates a generic-password item the same
    /// way the keyring store does, asserts the trust check, repairs the ACL,
    /// verifies the item is now trusted (and that repairing again is a silent
    /// no-op), reads the secret back, and cleans up.
    ///
    /// Ignored by default (`cargo test`) so CI/dev runs never touch the login
    /// keychain. Run explicitly with:
    /// `cargo test -- --ignored keychain_acl`
    #[test]
    #[ignore = "touches the real login keychain"]
    fn keychain_acl_normalizes_item() {
        let keychain = SecKeychain::default().expect("default keychain");
        let service = "com.adrianbonpin.gridline.acl-test";
        let account = format!("acl-test-{}", std::process::id());

        // Create the item exactly like apple-native-keyring-store does
        // (legacy SecKeychain generic-password API).
        keychain
            .set_generic_password(service, &account, b"test-secret")
            .expect("create test item");

        // Fresh items are created with this build as the trusted app, so the
        // trust check must already be true and the repair a no-op.
        let item = item_ref(service, &account)
            .expect("lookup")
            .expect("item exists");
        assert!(is_item_trusted(&item), "fresh item should already trust us");

        ensure_item_acl(service, &account).expect("normalize ACL");
        assert!(
            is_item_trusted(&item),
            "item must be trusted after repair"
        );

        // Idempotent: a second repair must not need authorization again.
        ensure_item_acl(service, &account).expect("second repair");

        // The item must remain readable with the correct secret.
        let (password, item) =
            find_generic_password(Some(&[keychain]), service, &account).expect("read back");
        assert_eq!(password.as_ref(), b"test-secret");

        // Cleanup: delete the test item.
        item.delete();
    }
}
