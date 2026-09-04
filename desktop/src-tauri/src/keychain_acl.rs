//! Keychain ACL normalization for stored secrets (macOS).
//!
//! # Why this exists
//!
//! Generic-password items stored via the legacy keychain API get a default ACL
//! that grants access to "the application that created the item". When a Tauri
//! app is rebuilt, its code signature changes (dev builds are ad-hoc signed, so
//! the identity differs on every build), and the new binary no longer matches
//! the item's ACL — macOS then shows the "Gridline wants to access your
//! keychain" prompt.
//!
//! The fix: after storing a secret, replace the item's ACL with an explicit
//! `SecAccess` whose trusted-application list contains exactly *this app*,
//! resolved by `SecTrustedApplicationCreateFromPath(NULL)` — the current
//! process's code-signature requirement. For a Developer ID-signed release
//! build that requirement is stable across versions (anchored to the signing
//! certificate), so items stay accessible without prompts through upgrades.
//!
//! # Prompt behavior
//!
//! - Item created by this build → the ACL set is silent.
//! - Item created by an older/differently-signed build → macOS shows the
//!   standard one-time authorization dialog; "Always Allow" replaces the ACL
//!   and the prompt never reappears (the same dialog the app would show on the
//!   first read anyway — this just makes the result permanent and clean).
//!
//! All operations are best-effort: `after_store` swallows errors so keychain
//! writes never fail because of ACL normalization.

/// Best-effort ACL normalization after a successful keychain write.
///
/// Resolves the service name the same way `tauri-plugin-keyring-store` does
/// (the Tauri bundle identifier) and never fails the caller's operation.
pub fn after_store(app: &tauri::AppHandle, account: &str) {
    let service = app.config().identifier.clone();
    if let Err(e) = ensure_item_acl(&service, account) {
        eprintln!("[keychain_acl] skipped for {account}: {e}");
    }
}

/// Grant this app (by its code-signature requirement) access to a keychain item.
#[cfg(target_os = "macos")]
pub fn ensure_item_acl(service: &str, account: &str) -> Result<(), String> {
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use security_framework::item::{ItemClass, ItemSearchOptions, Reference, SearchResult};
    use security_framework::os::macos::access::SecAccess;
    use security_framework_sys::base::SecAccessRef;

    // Locate the item WITHOUT reading its secret: a ref-only lookup
    // (`kSecReturnRef`, no data/attributes) never triggers an authorization
    // prompt, so merely probing an item we can't yet access is safe.
    let found = ItemSearchOptions::new()
        .class(ItemClass::generic_password())
        .service(service)
        .account(account)
        .load_refs(true)
        .load_data(false)
        .load_attributes(false)
        .search()
        .map_err(|e| format!("keychain item lookup failed: {e}"))?;

    let item = match found.first() {
        Some(SearchResult::Ref(Reference::KeychainItem(item))) => item,
        // No item (yet) or an unexpected result shape — nothing to normalize.
        _ => return Ok(()),
    };

    fn cvt(status: i32) -> Result<(), String> {
        if status == 0 {
            Ok(())
        } else {
            Err(format!("security framework error {status}"))
        }
    }

    // Build an access object whose trusted list is exactly this app. A NULL
    // path resolves the trusted application to the current process's code
    // signature requirement.
    unsafe {
        let mut trusted_app_ref: *mut OpaqueSecTrustedApplication = std::ptr::null_mut();
        cvt(SecTrustedApplicationCreateFromPath(std::ptr::null(), &mut trusted_app_ref))?;
        let trusted_app = SecTrustedApplication::wrap_under_create_rule(trusted_app_ref);
        let trusted_list = CFArray::from_CFTypes(&[trusted_app]);

        let descriptor = CFString::new("Gridline");
        let mut access_ref: SecAccessRef = std::ptr::null_mut();
        cvt(SecAccessCreate(
            descriptor.as_concrete_TypeRef() as CFTypeRef,
            trusted_list.as_concrete_TypeRef() as CFTypeRef,
            &mut access_ref,
        ))?;
        let access = SecAccess::wrap_under_create_rule(access_ref);

        // Replace the item's ACL. Silent when we already own the item;
        // one-time authorization dialog when the item was created by a
        // differently-signed build.
        cvt(SecKeychainItemSetAccess(
            item.as_concrete_TypeRef(),
            access.as_concrete_TypeRef(),
        ))
    }
}

/// Non-macOS platforms have no keychain ACL concept — nothing to do.
#[cfg(not(target_os = "macos"))]
pub fn ensure_item_acl(_service: &str, _account: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos_ffi {
    use core_foundation::base::{CFTypeRef, CFTypeID};

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
        pub fn SecAccessCreate(
            descriptor: CFTypeRef,
            trustedlist: CFTypeRef,
            access: *mut security_framework_sys::base::SecAccessRef,
        ) -> i32;
        pub fn SecKeychainItemSetAccess(
            item: security_framework_sys::base::SecKeychainItemRef,
            access: security_framework_sys::base::SecAccessRef,
        ) -> i32;
    }
}

#[cfg(target_os = "macos")]
use macos_ffi::{
    OpaqueSecTrustedApplication, SecAccessCreate, SecKeychainItemSetAccess, SecTrustedApplication,
    SecTrustedApplicationCreateFromPath,
};

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use security_framework::os::macos::keychain::SecKeychain;
    use security_framework::os::macos::passwords::find_generic_password;

    /// Real-keychain integration test: creates a generic-password item the
    /// same way the keyring store does, normalizes its ACL, verifies the
    /// secret is still readable, and cleans up.
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

        // ACL normalization must succeed on an item we just created.
        ensure_item_acl(service, &account).expect("normalize ACL");

        // The item must remain readable with the correct secret.
        let (password, item) =
            find_generic_password(Some(&[keychain]), service, &account).expect("read back");
        assert_eq!(password.as_ref(), b"test-secret");

        // Cleanup: delete the test item.
        item.delete();
    }
}
