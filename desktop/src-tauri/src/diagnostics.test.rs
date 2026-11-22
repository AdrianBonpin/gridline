//! Ticket 28 — redaction and truncation are bounded, linear, and Unicode-safe.
//!
//! These pin the invariants of [`crate::diagnostics`] — the single
//! implementation every diagnostic path uses:
//!
//! * **Unicode-safe** — a cut inside a multi-byte character is moved back to a
//!   character boundary. Slicing a `String` at a byte index that is not a
//!   boundary panics, which is how a truncated error message crashed the app.
//! * **Linear** — one forward pass with fixed-width prefix compares. The pre-fix
//!   implementation lowercased (and allocated) the whole remaining input at
//!   every byte offset, so a megabyte of stderr cost gigabytes of copying.
//! * **Bounded** — the result never exceeds the requested cap, and the scan
//!   stops once the cap is reached, so the cost is bounded by the cap rather
//!   than by the input size.
//! * **Redacting** — credential-shaped text never reaches the renderer, while
//!   the surrounding diagnostic detail survives.

use super::*;
use std::time::{Duration, Instant};

// ---------------------------------------------------------------------------
// Unicode safety
// ---------------------------------------------------------------------------

/// `truncate` must never panic when the cut lands inside a multi-byte
/// character: it steps back to the previous boundary instead.
#[test]
fn truncate_cuts_at_a_character_boundary() {
    // 396 ASCII bytes, then a 3-byte character occupying 396..399. With a
    // 400-byte cap the cut index is 397 — the middle of `日`.
    let s = format!("{}日本語", "x".repeat(396));
    assert!(!s.is_char_boundary(397), "the fixture straddles the cut");

    let out = truncate(&s, MAX_ERROR_BYTES);
    // The marker starts exactly where the kept bytes end, so `kept` is the cut
    // index. Asserting it is a boundary of the *input* is what fails when the
    // cut lands inside `日`: a lossy implementation would keep 399 bytes (with a
    // replacement character), and a byte-index slice would have panicked before
    // reaching this assertion.
    let kept = out.len() - "...".len();
    assert!(
        s.is_char_boundary(kept),
        "the cut lands on a character boundary of the input: {kept}"
    );
    assert_eq!(kept, 396, "the cut backs off to the last complete byte");
    assert!(
        s.starts_with(&out[..kept]),
        "the kept bytes are a prefix of the input: {out:?}"
    );
    assert!(out.len() <= MAX_ERROR_BYTES, "capped: {} bytes", out.len());
    assert!(out.ends_with("..."), "marks the truncation: {out:?}");
    assert_eq!(
        out.trim_end_matches('.'),
        "x".repeat(396),
        "the bytes before the cut survive untouched"
    );
}

/// Every cut position over text that mixes 1-, 3- and 4-byte characters: the
/// kept bytes are always a complete prefix of the input (never a split
/// character), always within the cap, and the ellipsis appears exactly when
/// something was dropped.
///
/// The single-fixture test above pins one cut index only, so an implementation
/// that steps back a fixed number of bytes, or assumes 2-byte characters, can
/// pass it and still corrupt text elsewhere. This sweep is what fails then.
#[test]
fn truncate_keeps_a_complete_prefix_at_every_cut() {
    let s = format!("{}{}{}", "x".repeat(5), "日本語", "😀😀");
    assert_eq!(s.len(), 5 + 9 + 8, "fixture: 1-, 3- and 4-byte characters");

    for cap in 0..=s.len() + 2 {
        let out = truncate(&s, cap);
        assert!(out.len() <= cap.max(3), "cap {cap}: {} bytes", out.len());
        let body = out.strip_suffix("...").unwrap_or(&out);
        assert!(
            s.starts_with(body),
            "cap {cap}: the kept bytes are a complete prefix of the input: {out:?}"
        );
        assert!(
            s.is_char_boundary(body.len()),
            "cap {cap}: the cut lands on a character boundary, not inside one"
        );
        assert_eq!(
            out.ends_with("..."),
            body.len() < s.len(),
            "cap {cap}: the marker appears exactly when bytes were dropped: {out:?}"
        );
    }
}

/// `redact` truncates too, so it carries the same Unicode obligation.
#[test]
fn redact_truncates_at_a_character_boundary() {
    // 396 ASCII bytes, then a 3-byte character straddling the cut index.
    let s = format!("{}日本語", "x".repeat(396));
    let out = redact(&s, MAX_ERROR_BYTES);
    assert!(out.len() <= MAX_ERROR_BYTES, "capped: {} bytes", out.len());
    assert!(out.ends_with("..."));
    assert!(out.starts_with(&"x".repeat(396)));
}

/// A cap smaller than the ellipsis, and a cut one byte past a boundary, are
/// both handled rather than panic.
#[test]
fn truncate_handles_edges() {
    let emoji = "😀😀😀"; // 4 bytes each

    // A cap that cannot hold even one character keeps only the ellipsis: it
    // never splits 😀 and never exceeds the cap.
    let out = truncate(emoji, 4);
    assert!(out.len() <= 4, "capped: {} bytes ({out:?})", out.len());
    assert_eq!(out, "...", "no character fits under the cap: {out:?}");

    for cap in 0..12 {
        let out = truncate(emoji, cap);
        let body = out.trim_end_matches('.');
        // The truncation marker is itself 3 bytes, so a cap below that yields
        // the marker alone: the result never exceeds the larger of the two.
        assert!(
            out.len() <= cap.max(3),
            "cap {cap}: produced {} bytes ({out:?})",
            out.len()
        );
        assert!(
            emoji.starts_with(body),
            "cap {cap}: the kept bytes are a prefix of the input: {out:?}"
        );
        assert_eq!(
            body.len() % 4,
            0,
            "cap {cap}: the cut never splits a 4-byte character: {out:?}"
        );
        assert!(
            out.len() == emoji.len() || out.ends_with("..."),
            "cap {cap}: a truncated result is marked: {out:?}"
        );
    }

    // A cap at or above the input length returns it untouched.
    for cap in [emoji.len(), emoji.len() + 1, MAX_ERROR_BYTES] {
        assert_eq!(truncate(emoji, cap), emoji, "cap {cap}: no ellipsis");
    }
    assert_eq!(truncate("short", MAX_ERROR_BYTES), "short", "no ellipsis");
}

/// The per-character advance is fallible instead of `expect`-ed: it runs over
/// arbitrary server/subprocess output, so a mid-character index must degrade the
/// message rather than panic the redaction path.
///
/// This is the one place the scan advances over the input itself, and the old
/// code both sliced (`input[i..]`, which panics off a boundary) and then
/// `.expect`-ed. Calling the helper with an index inside a multi-byte character
/// is exactly the case that used to abort the program.
#[test]
fn advancing_over_a_mid_character_index_ends_the_scan_instead_of_panicking() {
    let mut out = String::new();
    // "é" occupies bytes 0..2, so index 1 is inside it.
    assert!(!"é".is_char_boundary(1), "the fixture is mid-character");
    assert_eq!(push_char_at(&mut out, "é", 1), None, "not a boundary");
    assert_eq!(out, "", "nothing is copied from a partial character");

    // Past the end is also a clean stop, never a panic.
    assert_eq!(push_char_at(&mut out, "abc", 3), None);
    assert_eq!(out, "");

    // A real boundary still copies exactly one character and advances past it.
    assert_eq!(push_char_at(&mut out, "aé", 1), Some(3));
    assert_eq!(out, "é");
}

/// Adversarial subprocess output: multi-byte text glued to credential shapes,
/// a truncated URL, and a scan that stops on the cap. Nothing may panic and no
/// credential may survive.
#[test]
fn redact_never_panics_on_adversarial_output() {
    let many_emoji = "\u{1F600}".repeat(200);
    let cases = [
        "日本語password=secret-value trailing detail",
        "postgres://héllo:pässwörd@höst/db failed",
        "secret=😀😀 after",
        "user=ünïcode secret=🙈 x",
        "postgres://",
        "\u{0}password=\u{0}",
        many_emoji.as_str(),
    ];
    for input in cases {
        let out = redact(input, MAX_ERROR_BYTES);
        assert!(out.len() <= MAX_ERROR_BYTES, "{input:?} -> {out:?}");
        assert!(!out.contains("secret-value"), "{out:?}");
        assert!(!out.contains("pässwörd"), "{out:?}");
        assert!(!out.contains("🙈 x"), "{out:?}");
    }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/// The credential fragments are replaced; the diagnostic detail that makes the
/// message useful survives.
#[test]
fn redact_removes_credentials_and_keeps_detail() {
    let msg = "pg_dump failed: password=hunter2 host=db.internal user=admin \
               connect postgresql://admin:hunter2@db.internal:5432/app?sslmode=require refused";
    let out = redact(msg, MAX_ERROR_BYTES);

    assert!(!out.contains("hunter2"), "no password may survive: {out}");
    assert!(
        !out.contains("admin:"),
        "no URL userinfo may survive: {out}"
    );
    assert!(
        out.contains("pg_dump failed:"),
        "the diagnostic prefix survives: {out}"
    );
    assert!(
        out.contains("refused"),
        "the failure reason after the URL survives: {out}"
    );
    assert!(
        out.contains("db.internal:5432/app") || out.contains("[redacted-url://"),
        "the URL is replaced by the marker: {out}"
    );
}

/// Every scheme is redacted, not just PostgreSQL's, and matching is
/// case-insensitive.
#[test]
fn redact_covers_any_scheme_case_insensitively() {
    for msg in [
        "redis://:hunter2@127.0.0.1:6379/ failed",
        "MySQL://root:hunter2@localhost/db failed",
        "postgres://hunter2@localhost/db failed",
        "postgresql://hunter2@localhost/db failed",
    ] {
        let out = redact(msg, MAX_ERROR_BYTES);
        assert!(!out.contains("hunter2"), "{msg} → {out}");
    }
}

/// A URL-shaped run glued to more than a scheme's worth of word characters is
/// not a URL, so plain prose is not rewritten.
#[test]
fn redact_requires_a_scheme_boundary() {
    // 20 word characters then `postgres://`: no position here starts a
    // 1–16-character scheme, and a mid-word start is rejected by the boundary
    // rule, so the text is left as it is.
    let prose = format!("{}postgres://host/db", "a".repeat(20));
    assert_eq!(redact(&prose, MAX_ERROR_BYTES), prose);
}

/// `user=` and `secret` are credential keys too.
#[test]
fn redact_covers_user_and_secret_keys() {
    let out = redact("connect failed user=admin secret=abc123", MAX_ERROR_BYTES);
    assert!(!out.contains("admin"), "user value redacted: {out}");
    assert!(out.contains("secret=[redacted]"), "secret redacted: {out}");
    assert!(!out.contains("abc123"), "secret value redacted: {out}");
}

// ---------------------------------------------------------------------------
// Bounded cost
// ---------------------------------------------------------------------------

/// A large subprocess stderr finishes quickly and returns a capped string.
///
/// The pre-fix implementation lowercased the remaining input at every byte
/// offset: 1 MiB of text meant gigabytes of allocation and effectively hung.
#[test]
fn redact_bounds_time_and_memory_on_large_output() {
    let unit = "password=hunter2 postgresql://u:p@db.internal:5432/app ";
    let input = unit.repeat(1_048_576 / unit.len() + 1);
    assert!(input.len() >= 1_048_576, "at least 1 MiB of diagnostics");

    let start = Instant::now();
    let out = redact(&input, MAX_ERROR_BYTES);
    let elapsed = start.elapsed();

    assert!(out.len() <= MAX_ERROR_BYTES, "capped: {} bytes", out.len());
    assert!(!out.contains("hunter2"), "still redacted at scale: {out}");
    assert!(
        elapsed < Duration::from_secs(2),
        "1 MiB of diagnostics took {elapsed:?}; redaction must stay linear"
    );
}

/// The same bound for text with no credential pattern at all — the common case,
/// where a scan that is quadratic in the input length has nothing to skip.
#[test]
fn redact_bounds_plain_large_output() {
    let input = "a".repeat(1_048_576);
    let start = Instant::now();
    let out = redact(&input, MAX_ERROR_BYTES);
    let elapsed = start.elapsed();

    assert_eq!(out.len(), MAX_ERROR_BYTES, "exactly the cap");
    assert!(out.ends_with("..."));
    assert!(
        elapsed < Duration::from_secs(2),
        "1 MiB of plain text took {elapsed:?}; redaction must stay linear"
    );
}

/// A short diagnostic is returned unchanged — no ellipsis, no rewriting.
#[test]
fn redact_leaves_short_clean_text_alone() {
    let msg = "permission denied for table users";
    assert_eq!(redact(msg, MAX_ERROR_BYTES), msg);
    assert_eq!(truncate(msg, MAX_ERROR_BYTES), msg);
}
