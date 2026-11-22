//! Bounded, linear, Unicode-safe handling of **diagnostics**.
//!
//! A diagnostic is error text on its way to the renderer: a server message, a
//! subprocess's stderr, a failed tool job. It is treated differently from
//! payload for two reasons:
//!
//! * it can carry credentials the user must never see (a connection URL with an
//!   embedded password, `password=…`), so credential-shaped fragments are
//!   redacted; and
//! * its size is not ours to choose (a subprocess may print megabytes), so the
//!   result is capped.
//!
//! Payload — a copied `CREATE TABLE` statement, query rows, an export file — is
//! **not** a diagnostic. It is returned verbatim even when it legitimately
//! contains connection-string-shaped text, because redacting it would rewrite
//! legal SQL and truncating it would hand the user a broken statement.

/// Cap for engine/subprocess error detail shown to the user (bytes).
pub const MAX_ERROR_BYTES: usize = 400;
/// Cap for connection-test error text (bytes). Kept tighter: this text is
/// rendered inline in the connection form.
pub const MAX_CONNECTION_ERROR_BYTES: usize = 300;

/// A credential-bearing URL is replaced by this marker (the authority — host,
/// user, password, port — is dropped, the path is kept).
const REDACTED_URL: &str = "[redacted-url://";
/// A `key=value` credential is replaced by this marker.
const REDACTED_VALUE: &str = "[redacted]";
/// `secret…` is replaced by this marker (the key survives for readability).
const REDACTED_SECRET: &str = "secret=[redacted]";

/// Redact credential-shaped fragments and cap the result at `max_bytes`.
///
/// `max_bytes` bounds the returned string *including* the trailing ellipsis, so
/// callers get a hard size guarantee. The scan stops as soon as the cap is
/// reached: work is bounded by the cap, not by how much the subprocess printed.
pub fn redact(input: &str, max_bytes: usize) -> String {
    let bytes = input.as_bytes();
    // Never size the buffer from the input: a megabyte of stderr must not cost a
    // megabyte of allocation for a 400-byte result.
    let mut out = String::with_capacity(max_bytes.min(input.len()) + 3);
    let mut i = 0;
    while i < bytes.len() && out.len() < max_bytes {
        if let Some(authority) = url_authority_start(bytes, i) {
            // Drop the whole authority (userinfo, host, port); keep the path so
            // the message still says *what* failed to connect.
            out.push_str(REDACTED_URL);
            i = match input[authority..].find(['/', '?']) {
                Some(pos) => authority + pos,
                None => input.len(),
            };
        } else if key_at(bytes, i, b"password=") {
            out.push_str(REDACTED_VALUE);
            i = token_end(input, i + "password=".len());
        } else if key_at(bytes, i, b"user=") {
            out.push_str(REDACTED_VALUE);
            i = token_end(input, i + "user=".len());
        } else if key_at(bytes, i, b"secret") {
            out.push_str(REDACTED_SECRET);
            i = token_end(input, i + "secret".len());
        } else {
            // Copy exactly one character. This is the only place the scan
            // advances over the input itself, and the input is untrusted
            // subprocess/server text, so the advance is fallible: a mid-character
            // index (only reachable if a future branch advanced by a raw byte
            // offset) ends the scan with an ellipsis instead of panicking the
            // redaction path — which is what an `expect` here used to do.
            match push_char_at(&mut out, input, i) {
                Some(next) => i = next,
                None => break,
            }
        }
    }
    // `i < bytes.len()` means the cap stopped the scan, not the input: say so
    // with an ellipsis even when the text happens to end exactly at the cap.
    truncate_to(out, max_bytes.saturating_sub(3), max_bytes, i < bytes.len())
}

/// Copy the character starting at byte `i` into `out`, returning the index after
/// it.
///
/// `None` means `i` is not a character boundary or is past the end: the caller
/// stops the scan. Deliberately fallible — this runs over arbitrary
/// server/subprocess output, so an invariant failure must degrade the message,
/// never take the program down.
fn push_char_at(out: &mut String, input: &str, i: usize) -> Option<usize> {
    let ch = input.get(i..)?.chars().next()?;
    out.push(ch);
    Some(i + ch.len_utf8())
}

/// Truncate to `max_bytes` (including the ellipsis), cutting at a character
/// boundary so a multi-byte character at the cut point can never panic.
pub fn truncate(input: &str, max_bytes: usize) -> String {
    truncate_to(
        input.to_string(),
        max_bytes.saturating_sub(3),
        max_bytes,
        false,
    )
}

/// Cut `text` to at most `body_cap` bytes (at a character boundary) and append
/// an ellipsis when anything was dropped, keeping the whole result within
/// `max_bytes`.
fn truncate_to(text: String, body_cap: usize, max_bytes: usize, dropped: bool) -> String {
    if !dropped && text.len() <= max_bytes {
        return text;
    }
    let end = floor_char_boundary(&text, body_cap);
    let mut out = String::with_capacity(end + 3);
    out.push_str(&text[..end]);
    out.push_str("...");
    out
}

/// The largest byte index `<= index` that is a character boundary in `s`.
///
/// `str::floor_char_boundary` is unstable, and slicing a `String` at a
/// non-boundary index panics — which is how a truncated error message used to
/// crash the app when the cut landed inside a multi-byte character.
fn floor_char_boundary(s: &str, index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    let mut end = index;
    // A UTF-8 character is at most 4 bytes, so this walks back at most 3 steps.
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    end
}

/// If a `scheme://` URL starts at `i`, the byte index just past the `://`.
///
/// A scheme is 1–16 characters of `[A-Za-z0-9+.-]` and must not be glued to a
/// preceding word character, so `xpostgres://` is plain text rather than a URL.
/// The window is a fixed [`MAX_SCHEME_LEN`] + 3 bytes, so the test is O(1) per
/// position and the whole scan stays linear.
fn url_authority_start(bytes: &[u8], i: usize) -> Option<usize> {
    if let Some(prev) = i.checked_sub(1).and_then(|p| bytes.get(p)) {
        if prev.is_ascii_alphanumeric() || *prev == b'_' {
            return None;
        }
    }
    let mut len = 0;
    while len < MAX_SCHEME_LEN {
        match bytes.get(i + len)? {
            b':' => {
                // A zero-length scheme is not a URL (`://` alone).
                if len == 0 {
                    return None;
                }
                return match (bytes.get(i + len + 1), bytes.get(i + len + 2)) {
                    (Some(b'/'), Some(b'/')) => Some(i + len + 3),
                    _ => None,
                };
            }
            b if b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.') => len += 1,
            _ => return None,
        }
    }
    None
}

/// The longest URL scheme recognised before `://`.
const MAX_SCHEME_LEN: usize = 16;

/// Whether `key` (an ASCII, case-insensitive credential key) starts at `i`.
fn key_at(bytes: &[u8], i: usize, key: &[u8]) -> bool {
    bytes
        .get(i..i + key.len())
        .is_some_and(|window| window.eq_ignore_ascii_case(key))
}

/// The index of the next whitespace at or after `from` (or the end), so one
/// `key=value` token is skipped. Each token is walked once, keeping the scan
/// linear.
fn token_end(input: &str, from: usize) -> usize {
    let rest = &input[from..];
    from + rest.find(char::is_whitespace).unwrap_or(rest.len())
}

#[cfg(test)]
#[path = "diagnostics.test.rs"]
mod tests;
