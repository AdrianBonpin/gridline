//! The one declared validity rule per settings key (ADR 0003).
//!
//! Before this table, validity lived in three unrelated places and had already
//! drifted apart: the IPC layer range-checked `table_page_size`, read-back
//! re-clamped two editor keys and filtered one against an allowlist, and the
//! TypeScript import validator clamped a partly overlapping set, while every
//! other key was constrained only by whatever a dropdown happened to offer. The
//! gaps were real — `table_refresh_rate` could be stored as `-1`, `theme` as an
//! arbitrary string, `default_ports` as a port above 65535 — and read-back
//! returned all of them unmodified.
//!
//! So: [`SETTING_RULES`] is the only place a settings key's validity is decided,
//! and it governs writes ([`check_stored_text`]), bulk writes
//! ([`check_stored_batch`]), a settings-file import judged as a whole
//! ([`check_document`]) and read-back ([`read_back`]). Two properties follow, and
//! both are deliberate:
//!
//! - A key the table does not know is **refused**, naming the key. The store
//!   refuses what it cannot validate rather than storing it for nothing to read.
//! - Read-back **never errors**. A value stored by an older build that no longer
//!   satisfies its rule is normalised into one that does, so a stricter write
//!   path can never make an existing installation unreadable.
//!
//! Adding a setting means adding one entry here, and a test for it.

use std::collections::HashMap;
use std::fmt;

/// The sentinel a nullable key stores when it is unset. It is a real row value
/// (`default_folder_id` has been stored this way since the first release), not an
/// absence, so it is checked as the key's "unset" value rather than as a string.
pub(crate) const NULL_SENTINEL: &str = "null";

/// Theme names the interface offers (`ThemePicker`).
pub(crate) const THEMES: &[&str] = &["dark", "light", "system"];

/// Application font-size names the interface offers (`GeneralSettingsTab`).
pub(crate) const FONT_SIZES: &[&str] = &["small", "medium", "large"];

/// Editor font families the interface offers (`EditorSettingsTab`).
pub(crate) const EDITOR_FONTS: &[&str] = &[
    "Space Mono",
    "Fira Code",
    "Menlo",
    "Monaco",
    "Consolas",
    "JetBrains Mono",
    "monospace",
];

/// Editor word-wrap modes.
pub(crate) const WORD_WRAP_MODES: &[&str] = &["off", "on"];

/// Database types a default port may be stored for.
pub(crate) const PORT_DB_TYPES: &[&str] = &["postgresql", "mysql", "mariadb", "sqlite", "redis"];

/// Lowest and highest TCP port a default may name.
pub(crate) const PORT_MIN: i64 = 1;
pub(crate) const PORT_MAX: i64 = 65_535;

/// Longest value accepted for a free-text key (a folder id is a UUID).
pub(crate) const TEXT_MAX_LEN: usize = 200;

/// The default port map, as stored. Kept as JSON here because it is the declared
/// default of the `default_ports` key, which read-back returns verbatim.
pub(crate) const DEFAULT_PORTS_JSON: &str =
    r#"{"postgresql":5432,"mysql":3306,"sqlite":null,"redis":6379}"#;

/// How one settings value is judged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Rule {
    /// One of these exact strings.
    Enum(&'static [&'static str]),
    /// A decimal integer within an inclusive range.
    Integer { min: i64, max: i64 },
    /// `true` or `false`.
    Boolean,
    /// `#RGB`, `#RRGGBB` or `#RRGGBBAA`.
    HexColor,
    /// Free text of at most [`TEXT_MAX_LEN`] characters. Used only where the
    /// valid set is not known at compile time (a stored folder id).
    Text,
    /// A JSON array of non-empty strings.
    StringArray,
    /// A JSON object whose values are all strings.
    StringMap,
    /// A JSON object mapping a database type to a TCP port or `null`.
    Ports,
}

/// One declared settings key: its rule, whether `null` means "unset", and the
/// value read back when the key is absent or its stored value is invalid.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SettingRule {
    pub key: &'static str,
    pub rule: Rule,
    /// Whether the [`NULL_SENTINEL`] is an accepted value, meaning "unset".
    pub nullable: bool,
    /// Always satisfies `rule` (or is the sentinel when `nullable`). A test
    /// asserts this, so a typo in a default fails the suite.
    pub default: &'static str,
}

/// Every settings key this build knows, with the rule that governs it.
///
/// The order is the order the settings interface presents the keys in, so a
/// reader looking for "the rule for this control" finds it in one pass.
pub(crate) const SETTING_RULES: &[SettingRule] = &[
    SettingRule {
        key: "theme",
        rule: Rule::Enum(THEMES),
        nullable: false,
        default: "system",
    },
    SettingRule {
        key: "font_size",
        rule: Rule::Enum(FONT_SIZES),
        nullable: false,
        default: "medium",
    },
    SettingRule {
        key: "accent_color",
        rule: Rule::HexColor,
        nullable: false,
        default: "#2563EB",
    },
    SettingRule {
        key: "default_folder_id",
        // A folder id comes from the store, so the valid set is not known at
        // compile time. The shape that is knowable is bounded: empty (the
        // dropdown's "None") or an id, never an arbitrary length of text.
        rule: Rule::Text,
        // `null` is the sentinel the first release already stored for "unset".
        nullable: true,
        default: NULL_SENTINEL,
    },
    SettingRule {
        key: "confirm_before_delete",
        rule: Rule::Boolean,
        nullable: false,
        default: "true",
    },
    SettingRule {
        key: "table_refresh_rate",
        rule: Rule::Integer {
            min: 0,
            max: 300_000,
        },
        nullable: false,
        default: "0",
    },
    SettingRule {
        key: "table_page_size",
        // The same bound the browse path enforces (`db_viewer::page_window`
        // rejects, it never substitutes a window), so one number decides both.
        rule: Rule::Integer {
            min: 1,
            max: crate::commands::db_viewer::MAX_TABLE_PAGE_SIZE,
        },
        nullable: false,
        default: "50",
    },
    SettingRule {
        key: "default_ports",
        rule: Rule::Ports,
        nullable: false,
        default: DEFAULT_PORTS_JSON,
    },
    SettingRule {
        key: "tag_order",
        rule: Rule::StringArray,
        nullable: true,
        default: NULL_SENTINEL,
    },
    SettingRule {
        key: "shortcuts",
        rule: Rule::StringMap,
        nullable: false,
        default: "{}",
    },
    SettingRule {
        key: "editor_font_size",
        rule: Rule::Integer { min: 8, max: 24 },
        nullable: false,
        default: "13",
    },
    SettingRule {
        key: "editor_font_family",
        rule: Rule::Enum(EDITOR_FONTS),
        nullable: false,
        default: "Space Mono",
    },
    SettingRule {
        key: "editor_word_wrap",
        rule: Rule::Enum(WORD_WRAP_MODES),
        nullable: false,
        default: "off",
    },
    SettingRule {
        key: "editor_minimap",
        rule: Rule::Boolean,
        nullable: false,
        default: "false",
    },
    SettingRule {
        key: "editor_tab_size",
        rule: Rule::Integer { min: 2, max: 8 },
        nullable: false,
        default: "4",
    },
];

/// A write the table refused. Names the key and states what would have been valid,
/// so the message tells the caller what to correct.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SettingRefused {
    pub key: String,
    pub detail: String,
}

impl SettingRefused {
    fn new(key: &str, detail: impl Into<String>) -> Self {
        Self {
            key: key.to_string(),
            detail: detail.into(),
        }
    }

    /// The refusal for a key [`SETTING_RULES`] does not declare. A direct write
    /// and an imported document entry are refused with this same wording: one
    /// table decides what a setting is, so one sentence says a key is not one.
    fn unknown_key(key: &str) -> Self {
        Self::new(
            key,
            "is not a setting this build knows, so it cannot be validated",
        )
    }

    /// The refusal for a key the table declares that a document does not carry.
    fn absent_from_document(key: &str) -> Self {
        Self::new(key, "is missing from the file, so nothing was imported")
    }
}

impl fmt::Display for SettingRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "settings key {:?} {}", self.key, self.detail)
    }
}

/// The declared rule for `key`, if this build knows the key.
pub(crate) fn rule_for(key: &str) -> Option<&'static SettingRule> {
    SETTING_RULES.iter().find(|rule| rule.key == key)
}

/// Judge one stored value written under `key`.
///
/// Takes the key and the **text the store would hold** (not a JSON value — that
/// is [`check_document_entry`]), and returns the keyed refusal
/// ([`SettingRefused`]) when the text does not satisfy the key's rule. An
/// unknown key is refused, naming it.
pub(crate) fn check_stored_text(key: &str, text: &str) -> Result<(), SettingRefused> {
    let rule = rule_for(key).ok_or_else(|| SettingRefused::unknown_key(key))?;
    if rule.nullable && text == NULL_SENTINEL {
        return Ok(());
    }
    judge_against_rule(rule, text).map_err(|detail| SettingRefused::new(key, detail))
}

/// Judge a whole batch of stored values — every entry is checked before the
/// caller writes any of it, so a caller that applies the batch only on `Ok`
/// leaves settings untouched instead of half-updated (ADR 0003).
///
/// The caller is `Store::apply_settings`, the multi-key write. A settings-file
/// **import** is a different seam: it judges a document, whose completeness and
/// unknown keys are rules of their own ([`check_document`]).
pub(crate) fn check_stored_batch<K, V, I>(entries: I) -> Result<(), SettingRefused>
where
    K: AsRef<str>,
    V: AsRef<str>,
    I: IntoIterator<Item = (K, V)>,
{
    for (key, value) in entries {
        check_stored_text(key.as_ref(), value.as_ref())?;
    }
    Ok(())
}

/// Judge a whole settings document — the `settings` object of an imported file —
/// and return the store-form text to write, keyed by setting.
///
/// Two rules hold at the document level, and they are declared **here**, beside
/// the table, rather than by a caller: they are properties of a document, not of
/// any one value, and a caller that re-derived them would be deciding validity
/// outside the table (ADR 0003).
///
/// - **Every key the table declares must be present.** A file exported by an
///   older build omits keys this build declares, and importing what it
///   recognises would leave those settings neither the file's nor the previous
///   one's — exactly the half-changed state a whole-document refusal prevents.
///   (The mirror case, a file from a newer build, is refused by the entry rule
///   below, because it carries a key the table does not declare.)
/// - **Every present entry must satisfy its key's rule**, exactly as a direct
///   write does; a key the table does not declare is refused by name.
///
/// Returns every refusal, not the first, so a user correcting a file sees all of
/// its problems at once. Nothing may be written unless this returned `Ok`.
pub(crate) fn check_document(
    entries: &serde_json::Map<String, serde_json::Value>,
) -> Result<HashMap<String, String>, Vec<SettingRefused>> {
    let mut refusals = Vec::new();
    let mut stored = HashMap::new();
    for (key, value) in entries {
        match check_document_entry(key, value) {
            Ok(text) => {
                stored.insert(key.clone(), text);
            }
            Err(refusal) => refusals.push(refusal),
        }
    }
    for rule in SETTING_RULES {
        if !entries.contains_key(rule.key) {
            refusals.push(SettingRefused::absent_from_document(rule.key));
        }
    }
    if refusals.is_empty() {
        Ok(stored)
    } else {
        Err(refusals)
    }
}

/// Judge one entry of an imported settings document, returning the store-form
/// text the entry is written as.
///
/// A file is JSON while the store holds text, so an entry has to be converted
/// before its declared rule can judge it — and that conversion belongs beside the
/// rule kinds, not in the importer. Keeping it here is what lets the importer
/// hold **no** value shape, range or allowlist of its own: it asks this module
/// about each key and writes only what came back `Ok`, so a file and a direct
/// write are judged by the same table and cannot drift apart.
///
/// A key the table does not know is refused here exactly as a direct write is.
pub(crate) fn check_document_entry(
    key: &str,
    value: &serde_json::Value,
) -> Result<String, SettingRefused> {
    let rule = rule_for(key).ok_or_else(|| SettingRefused::unknown_key(key))?;
    if value.is_null() {
        return if rule.nullable {
            Ok(NULL_SENTINEL.to_string())
        } else {
            Err(SettingRefused::new(
                key,
                "value null is not valid: this key cannot be unset",
            ))
        };
    }
    let stored = stored_form(rule, value).map_err(|detail| SettingRefused::new(key, detail))?;
    check_stored_text(key, &stored)?;
    Ok(stored)
}

/// The text a document value is stored as, decided by the key's declared rule.
///
/// A structured value is stored as its compact JSON text, while a string is
/// already the stored text — a key whose stored form is JSON is exported as a
/// JSON string holding that text, so both shapes reach the same rule.
fn stored_form(rule: &SettingRule, value: &serde_json::Value) -> Result<String, String> {
    let expected = |what: &str| format!("value {value} is not valid: must be {what}");
    match rule.rule {
        Rule::Enum(_) | Rule::HexColor | Rule::Text => value
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| expected("a string")),
        Rule::Integer { .. } => value
            .as_i64()
            .map(|n| n.to_string())
            .ok_or_else(|| expected("a whole number")),
        Rule::Boolean => value
            .as_bool()
            .map(|b| b.to_string())
            .ok_or_else(|| expected("true or false")),
        Rule::StringArray | Rule::StringMap | Rule::Ports => match value {
            serde_json::Value::String(text) => Ok(text.clone()),
            structured => Ok(structured.to_string()),
        },
    }
}

/// Read a value back, normalised into one that satisfies the key's rule.
///
/// This never fails and never returns the invalid text: an integer outside its
/// range is clamped to the nearest bound, and anything that cannot be salvaged
/// becomes the declared default. A key this build does not know has no rule and
/// no consumer — read-back only asks for keys the table declares (a test asserts
/// the two agree).
pub(crate) fn read_back(map: &HashMap<String, String>, key: &str) -> String {
    let Some(rule) = rule_for(key) else {
        return String::new();
    };
    match map.get(key) {
        Some(stored) => normalise(rule, stored),
        None => rule.default.to_string(),
    }
}

/// Read a numeric key back as an integer.
///
/// Read-back has already normalised the value into one the key's rule accepts, so
/// an integer key parses. Asking an integer of a key whose rule is not numeric is
/// a caller error rather than a bad stored value; it reads as `0` instead of
/// panicking the interface, and no rule the table declares today can reach it.
pub(crate) fn read_back_int(map: &HashMap<String, String>, key: &str) -> i64 {
    read_back(map, key).trim().parse::<i64>().unwrap_or(0)
}

/// Read a boolean key back.
pub(crate) fn read_back_bool(map: &HashMap<String, String>, key: &str) -> bool {
    read_back(map, key) == "true"
}

/// Read a nullable key back, mapping the stored [`NULL_SENTINEL`] to `None`.
pub(crate) fn read_back_optional(map: &HashMap<String, String>, key: &str) -> Option<String> {
    let normalised = read_back(map, key);
    if normalised == NULL_SENTINEL {
        None
    } else {
        Some(normalised)
    }
}

// ---------------------------------------------------------------------------
// The judgements themselves
// ---------------------------------------------------------------------------

/// The reason a value does not satisfy its rule, phrased to complete
/// "settings key \"x\" ……". `Ok(())` means the value is valid.
///
/// Takes a declared [`SettingRule`] and the **store-form text** a value would be
/// written as, and returns the unkeyed reason it is refused; the caller adds the
/// key ([`check_stored_text`]).
fn judge_against_rule(rule: &SettingRule, value: &str) -> Result<(), String> {
    match rule.rule {
        Rule::Enum(allowed) => {
            if allowed.contains(&value) {
                Ok(())
            } else {
                Err(format!(
                    "value {value:?} is not valid: must be one of {}",
                    allowed.join(", ")
                ))
            }
        }
        Rule::Integer { min, max } => {
            let parsed = parse_int(value).ok_or_else(|| {
                format!("value {value:?} is not valid: must be an integer between {min} and {max}")
            })?;
            if (min..=max).contains(&parsed) {
                Ok(())
            } else {
                Err(format!(
                    "value {value:?} is out of range: must be an integer between {min} and {max}"
                ))
            }
        }
        Rule::Boolean => match value {
            "true" | "false" => Ok(()),
            _ => Err(format!(
                "value {value:?} is not valid: must be \"true\" or \"false\""
            )),
        },
        Rule::HexColor => {
            if is_hex_colour(value) {
                Ok(())
            } else {
                Err(format!(
                    "value {value:?} is not valid: must be a hex colour such as #2563EB"
                ))
            }
        }
        Rule::Text => {
            if value.chars().count() <= TEXT_MAX_LEN {
                Ok(())
            } else {
                Err(format!(
                    "value is too long: must be at most {TEXT_MAX_LEN} characters"
                ))
            }
        }
        Rule::StringArray => judge_string_array(value),
        Rule::StringMap => judge_string_map(value),
        Rule::Ports => judge_ports(value),
    }
}

/// A JSON array of non-empty strings — the shape `tag_order` is stored as.
fn judge_string_array(value: &str) -> Result<(), String> {
    const EXPECTED: &str = "is not valid: must be a JSON array of non-empty strings";
    let parsed =
        serde_json::from_str::<serde_json::Value>(value).map_err(|_| EXPECTED.to_string())?;
    let items = parsed.as_array().ok_or_else(|| EXPECTED.to_string())?;
    if items
        .iter()
        .all(|item| item.as_str().is_some_and(|s| !s.is_empty()))
    {
        Ok(())
    } else {
        Err(EXPECTED.to_string())
    }
}

/// A JSON object whose values are all strings — the shape `shortcuts` is stored
/// as.
fn judge_string_map(value: &str) -> Result<(), String> {
    const EXPECTED: &str = "is not valid: must be a JSON object whose values are strings";
    let parsed =
        serde_json::from_str::<serde_json::Value>(value).map_err(|_| EXPECTED.to_string())?;
    let object = parsed.as_object().ok_or_else(|| EXPECTED.to_string())?;
    if object.values().all(|item| item.is_string()) {
        Ok(())
    } else {
        Err(EXPECTED.to_string())
    }
}

/// A default port map: known database types mapped to a TCP port or `null`.
///
/// The key set is checked as well as the values because a port stored under a
/// type nothing recognises is a value nothing will ever read.
fn judge_ports(value: &str) -> Result<(), String> {
    let expected = || {
        format!(
            "is not valid: must be a JSON object mapping {} to a port between {PORT_MIN} and {PORT_MAX}, or null",
            PORT_DB_TYPES.join(", ")
        )
    };
    let parsed = serde_json::from_str::<serde_json::Value>(value).map_err(|_| expected())?;
    let object = parsed.as_object().ok_or_else(expected)?;
    for (db_type, port) in object {
        if !PORT_DB_TYPES.contains(&db_type.as_str()) {
            return Err(format!(
                "is not valid: {db_type:?} is not a database type (expected one of {})",
                PORT_DB_TYPES.join(", ")
            ));
        }
        if port.is_null() {
            continue;
        }
        match port.as_i64() {
            Some(n) if (PORT_MIN..=PORT_MAX).contains(&n) => {}
            _ => {
                return Err(format!(
                    "is not valid: the {db_type} port must be an integer between {PORT_MIN} and {PORT_MAX}, or null"
                ))
            }
        }
    }
    Ok(())
}

/// Turn whatever is stored into a value that satisfies `rule`. Never errors.
fn normalise(rule: &SettingRule, stored: &str) -> String {
    if rule.nullable && stored == NULL_SENTINEL {
        return NULL_SENTINEL.to_string();
    }
    if judge_against_rule(rule, stored).is_ok() {
        return stored.to_string();
    }
    // Salvage what can be salvaged: an integer outside its range keeps its
    // intent as the nearest bound. Everything else falls back to the default.
    if let Rule::Integer { min, max } = rule.rule {
        if let Some(n) = parse_int(stored) {
            return n.clamp(min, max).to_string();
        }
    }
    rule.default.to_string()
}

fn parse_int(value: &str) -> Option<i64> {
    value.trim().parse::<i64>().ok()
}

fn is_hex_colour(value: &str) -> bool {
    let Some(digits) = value.strip_prefix('#') else {
        return false;
    };
    matches!(digits.len(), 3 | 6 | 8) && digits.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map_of(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    /// Every key `Store::get_settings` reads. Written out so a rule that goes
    /// missing fails here instead of silently reading back an empty string.
    const KEYS_READ_BACK: &[&str] = &[
        "theme",
        "font_size",
        "accent_color",
        "default_folder_id",
        "confirm_before_delete",
        "table_refresh_rate",
        "table_page_size",
        "default_ports",
        "tag_order",
        "shortcuts",
        "editor_font_size",
        "editor_font_family",
        "editor_word_wrap",
        "editor_minimap",
        "editor_tab_size",
    ];

    #[test]
    fn every_key_read_back_has_exactly_one_rule() {
        for key in KEYS_READ_BACK {
            let matches = SETTING_RULES.iter().filter(|r| r.key == *key).count();
            assert_eq!(matches, 1, "{key} must have exactly one declared rule");
        }
        // …and the table declares no key that nothing reads.
        for rule in SETTING_RULES {
            assert!(
                KEYS_READ_BACK.contains(&rule.key),
                "{} is declared but never read back",
                rule.key
            );
        }
    }

    #[test]
    fn every_declared_default_satisfies_its_own_rule() {
        for rule in SETTING_RULES {
            assert!(
                check_stored_text(rule.key, rule.default).is_ok(),
                "the declared default for {} does not satisfy its own rule",
                rule.key
            );
        }
    }

    #[test]
    fn an_unknown_key_is_refused_naming_the_key() {
        let err = check_stored_text("no_such_setting", "1").expect_err("unknown key");
        assert_eq!(err.key, "no_such_setting");
        assert!(err.to_string().contains("\"no_such_setting\""), "{err}");
        assert!(rule_for("no_such_setting").is_none());
    }

    #[test]
    fn read_back_never_returns_a_value_its_rule_would_refuse() {
        let garbage = [
            "",
            " ",
            "abc",
            "-1",
            "0",
            "999999999999999999999999",
            "null",
            "not json",
            "{}",
            "[]",
            "{\"a\":1}",
            "[1]",
            "#",
            "#1234",
            "chartreuse",
        ];
        for rule in SETTING_RULES {
            for stored in garbage {
                let map = map_of(&[(rule.key, stored)]);
                let normalised = read_back(&map, rule.key);
                assert!(
                    check_stored_text(rule.key, &normalised).is_ok(),
                    "{} read back {normalised:?} from {stored:?}, which its own rule refuses",
                    rule.key
                );
            }
        }
    }

    #[test]
    fn a_nullable_key_accepts_the_unset_sentinel_and_reads_it_back_as_none() {
        let map = map_of(&[("default_folder_id", "null"), ("tag_order", "null")]);
        assert_eq!(read_back_optional(&map, "default_folder_id"), None);
        assert_eq!(read_back_optional(&map, "tag_order"), None);
        assert!(check_stored_text("default_folder_id", "null").is_ok());
        assert!(check_stored_text("tag_order", "null").is_ok());
        // A non-nullable key treats the literal "null" as just another bad value.
        assert!(check_stored_text("theme", "null").is_err());
    }

    #[test]
    fn an_absent_key_reads_back_its_declared_default() {
        let map = map_of(&[]);
        assert_eq!(read_back(&map, "theme"), "system");
        assert_eq!(read_back_int(&map, "table_page_size"), 50);
        assert!(read_back_bool(&map, "confirm_before_delete"));
        assert_eq!(read_back(&map, "default_ports"), DEFAULT_PORTS_JSON);
    }

    #[test]
    fn a_batch_is_judged_entry_by_entry_and_refuses_the_first_bad_one() {
        let ok = map_of(&[("theme", "light"), ("editor_tab_size", "4")]);
        assert!(check_stored_batch(ok.iter()).is_ok());

        let bad = map_of(&[("theme", "light"), ("table_page_size", "0")]);
        let err = check_stored_batch(bad.iter()).expect_err("one bad entry refuses the batch");
        assert_eq!(err.key, "table_page_size");
        assert!(err.to_string().contains("between 1 and 500"), "{err}");
    }

    #[test]
    fn ports_are_judged_by_type_and_range() {
        assert!(check_stored_text("default_ports", "{}").is_ok());
        assert!(
            check_stored_text("default_ports", "{\"postgresql\":5432,\"sqlite\":null}").is_ok()
        );
        assert!(check_stored_text("default_ports", "{\"postgresql\":1}").is_ok());
        assert!(check_stored_text("default_ports", "{\"postgresql\":65535}").is_ok());
        for bad in [
            "{\"postgresql\":0}",
            "{\"postgresql\":65536}",
            "{\"postgresql\":-1}",
            "{\"postgresql\":5432.5}",
            "{\"postgresql\":\"5432\"}",
            "{\"oracle\":1521}",
            "[]",
            "5432",
        ] {
            assert!(
                check_stored_text("default_ports", bad).is_err(),
                "default_ports={bad} must be refused"
            );
        }
    }

    #[test]
    fn hex_colours_are_judged_by_shape() {
        for good in ["#2563EB", "#2563eb", "#ABC", "#2563EBFF"] {
            assert!(check_stored_text("accent_color", good).is_ok(), "{good}");
        }
        for bad in ["2563EB", "#2563E", "#12345", "#GGGGGG", "#"] {
            assert!(check_stored_text("accent_color", bad).is_err(), "{bad}");
        }
    }

    // ── Document entries (a settings file is JSON, the store holds text) ──

    /// A document entry is judged by the same rule as a direct write, and the
    /// text it would be stored as is what the rule judged.
    #[test]
    fn a_document_entry_is_judged_by_the_rule_of_its_key() {
        let cases = [
            ("theme", serde_json::json!("light"), "light"),
            ("table_page_size", serde_json::json!(500), "500"),
            ("confirm_before_delete", serde_json::json!(false), "false"),
            ("accent_color", serde_json::json!("#EF4444"), "#EF4444"),
            ("default_folder_id", serde_json::json!(null), NULL_SENTINEL),
            (
                "default_ports",
                serde_json::json!({"postgresql": 6543}),
                "{\"postgresql\":6543}",
            ),
            ("shortcuts", serde_json::json!({"a": "b"}), "{\"a\":\"b\"}"),
            // A key whose stored form is JSON is exported as a string holding
            // that text, so the string itself is the stored form.
            (
                "tag_order",
                serde_json::json!("[\"b\",\"a\"]"),
                "[\"b\",\"a\"]",
            ),
        ];
        for (key, value, stored) in cases {
            assert_eq!(
                check_document_entry(key, &value),
                Ok(stored.to_string()),
                "{key}"
            );
            assert!(
                check_stored_text(key, stored).is_ok(),
                "{key} stores text its rule refuses"
            );
        }
    }

    /// The whole point of judging a document rather than a deserialised struct:
    /// a key the table does not know is refused and named, never skipped.
    #[test]
    fn a_document_entry_for_an_unknown_key_is_refused_by_name() {
        let err = check_document_entry("future_setting", &serde_json::json!(true))
            .expect_err("unknown key");
        assert_eq!(err.key, "future_setting");
        assert!(err.to_string().contains("\"future_setting\""), "{err}");
    }

    /// A value of the wrong JSON shape is refused naming the key, with the shape
    /// the rule needs — never converted into something the rule might accept.
    #[test]
    fn a_document_entry_of_the_wrong_shape_is_refused_by_name() {
        let cases = [
            ("theme", serde_json::json!(5)),
            ("table_page_size", serde_json::json!("500")),
            ("table_page_size", serde_json::json!(50.5)),
            ("confirm_before_delete", serde_json::json!(1)),
            ("theme", serde_json::json!(null)),
            ("accent_color", serde_json::json!(["#fff"])),
        ];
        for (key, value) in cases {
            let err = check_document_entry(key, &value).expect_err("wrong shape");
            assert_eq!(err.key, key, "{value}");
        }
    }

    /// A document carrying every key the table declares, in the shape an export
    /// writes: most entries are strings, and the structured keys are objects.
    fn complete_document() -> serde_json::Map<String, serde_json::Value> {
        serde_json::json!({
            "theme": "light",
            "font_size": "large",
            "accent_color": "#EF4444",
            "default_folder_id": null,
            "confirm_before_delete": false,
            "table_refresh_rate": 5000,
            "table_page_size": 500,
            "default_ports": {"postgresql": 6543, "sqlite": null},
            "tag_order": null,
            "shortcuts": {"open_command_palette": "Cmd+K"},
            "editor_font_size": 22,
            "editor_font_family": "JetBrains Mono",
            "editor_word_wrap": "on",
            "editor_minimap": true,
            "editor_tab_size": 8,
        })
        .as_object()
        .cloned()
        .expect("the fixture is an object")
    }

    // ── Documents (the rules a whole imported file is held to) ──

    /// A complete, valid document is accepted, and every entry comes back in the
    /// text the store writes it as.
    #[test]
    fn a_complete_document_is_accepted_and_returns_the_store_form_of_every_entry() {
        let entries = complete_document();
        // The fixture must name exactly the declared keys, or the tests below
        // would be arguing about a document the table does not describe.
        assert_eq!(entries.len(), SETTING_RULES.len());
        for rule in SETTING_RULES {
            assert!(entries.contains_key(rule.key), "{} is absent", rule.key);
        }

        let stored = check_document(&entries).expect("a complete, valid document is accepted");
        assert_eq!(stored.len(), SETTING_RULES.len());
        assert_eq!(stored["theme"], "light");
        assert_eq!(stored["table_page_size"], "500");
        assert_eq!(stored["default_folder_id"], NULL_SENTINEL);
        assert_eq!(stored["tag_order"], NULL_SENTINEL);
        assert_eq!(
            stored["default_ports"],
            "{\"postgresql\":6543,\"sqlite\":null}"
        );
        assert_eq!(stored["shortcuts"], "{\"open_command_palette\":\"Cmd+K\"}");
    }

    /// A key the table declares but the document omits is refused by name: a file
    /// from an *older* build carries no entry for a key this build added, so it is
    /// refused rather than imported for the keys it happens to know.
    #[test]
    fn a_document_omitting_a_declared_key_is_refused_by_name() {
        let mut entries = complete_document();
        entries.remove("theme");

        let refused = check_document(&entries).expect_err("an incomplete document is refused");
        assert_eq!(refused.len(), 1, "{refused:?}");
        assert_eq!(refused[0].key, "theme");
        assert!(refused[0].to_string().contains("missing"), "{refused:?}");
    }

    /// Every refusal is reported, not the first: the user edits the file and
    /// retries, so one problem per attempt would be guesswork.
    #[test]
    fn a_document_reports_every_refusal_not_the_first() {
        let mut entries = complete_document();
        entries.insert("editor_tab_size".into(), serde_json::json!(9));
        entries.insert("future_setting".into(), serde_json::json!(true));
        entries.remove("theme");

        let refused = check_document(&entries).expect_err("three defects");
        let keys: Vec<&str> = refused.iter().map(|refusal| refusal.key.as_str()).collect();
        for key in ["editor_tab_size", "future_setting", "theme"] {
            assert!(keys.contains(&key), "{key} must be reported: {keys:?}");
        }
        assert_eq!(refused.len(), 3, "{keys:?}");
    }

    /// Free text is bounded by the one length the table declares.
    #[test]
    fn free_text_is_bounded_by_the_declared_length() {
        assert!(check_stored_text("default_folder_id", &"a".repeat(TEXT_MAX_LEN)).is_ok());
        let err = check_stored_text("default_folder_id", &"a".repeat(TEXT_MAX_LEN + 1))
            .expect_err("too long");
        assert!(err.to_string().contains("too long"), "{err}");
    }

    /// Asking an integer of a key whose rule is not numeric is a caller error, and
    /// reads as `0` instead of panicking the interface. No rule the table declares
    /// today can reach it, which is why it is pinned rather than exercised.
    #[test]
    fn asking_an_integer_of_a_non_numeric_key_reads_zero() {
        let map = map_of(&[("theme", "system")]);
        assert_eq!(read_back_int(&map, "theme"), 0);
    }
}
