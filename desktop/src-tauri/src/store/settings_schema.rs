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
//! and it governs writes ([`check`]), bulk writes ([`check_batch`]) and read-back
//! ([`read_back`]). Two properties follow, and both are deliberate:
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
    /// Free text of at most `max_len` characters. Used only where the valid set
    /// is not known at compile time (a stored folder id).
    Text { max_len: usize },
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
        rule: Rule::Text {
            max_len: TEXT_MAX_LEN,
        },
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

/// Judge one write. An unknown key is refused, naming it.
pub(crate) fn check(key: &str, value: &str) -> Result<(), SettingRefused> {
    let rule = rule_for(key).ok_or_else(|| {
        SettingRefused::new(
            key,
            "is not a setting this build knows, so it cannot be validated",
        )
    })?;
    if rule.nullable && value == NULL_SENTINEL {
        return Ok(());
    }
    validate(rule, value).map_err(|detail| SettingRefused::new(key, detail))
}

/// Judge a whole batch — every entry is checked before the caller writes any of
/// it, so a caller that applies the batch only on `Ok` leaves settings untouched
/// instead of half-updated (ADR 0003). This is the seam a settings-file import
/// uses; the ranges stay declared here rather than in the importer.
pub(crate) fn check_batch<K, V, I>(entries: I) -> Result<(), SettingRefused>
where
    K: AsRef<str>,
    V: AsRef<str>,
    I: IntoIterator<Item = (K, V)>,
{
    for (key, value) in entries {
        check(key.as_ref(), value.as_ref())?;
    }
    Ok(())
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
pub(crate) fn read_back_int(map: &HashMap<String, String>, key: &str) -> i64 {
    let normalised = read_back(map, key);
    if let Ok(n) = normalised.trim().parse::<i64>() {
        return n;
    }
    // Unreachable while read-back returns a valid integer; kept so a future rule
    // with a non-numeric default still cannot make read-back panic.
    rule_for(key)
        .and_then(|rule| rule.default.parse::<i64>().ok())
        .unwrap_or(0)
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
fn validate(rule: &SettingRule, value: &str) -> Result<(), String> {
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
        Rule::Text { max_len } => {
            if value.chars().count() <= max_len {
                Ok(())
            } else {
                Err(format!(
                    "value is too long: must be at most {max_len} characters"
                ))
            }
        }
        Rule::StringArray => {
            let parsed = serde_json::from_str::<serde_json::Value>(value).map_err(|_| {
                "is not valid: must be a JSON array of non-empty strings".to_string()
            })?;
            let items = parsed.as_array().ok_or_else(|| {
                "is not valid: must be a JSON array of non-empty strings".to_string()
            })?;
            if items
                .iter()
                .all(|item| item.as_str().is_some_and(|s| !s.is_empty()))
            {
                Ok(())
            } else {
                Err("is not valid: must be a JSON array of non-empty strings".to_string())
            }
        }
        Rule::StringMap => {
            let parsed = serde_json::from_str::<serde_json::Value>(value).map_err(|_| {
                "is not valid: must be a JSON object whose values are strings".to_string()
            })?;
            let object = parsed.as_object().ok_or_else(|| {
                "is not valid: must be a JSON object whose values are strings".to_string()
            })?;
            if object.values().all(|item| item.is_string()) {
                Ok(())
            } else {
                Err("is not valid: must be a JSON object whose values are strings".to_string())
            }
        }
        Rule::Ports => validate_ports(value),
    }
}

/// A default port map: known database types mapped to a TCP port or `null`.
///
/// The key set is checked as well as the values because a port stored under a
/// type nothing recognises is a value nothing will ever read.
fn validate_ports(value: &str) -> Result<(), String> {
    let parsed = serde_json::from_str::<serde_json::Value>(value).map_err(|_| {
        format!(
            "is not valid: must be a JSON object mapping {} to a port between {PORT_MIN} and {PORT_MAX}, or null",
            PORT_DB_TYPES.join(", ")
        )
    })?;
    let object = parsed.as_object().ok_or_else(|| {
        format!(
            "is not valid: must be a JSON object mapping {} to a port between {PORT_MIN} and {PORT_MAX}, or null",
            PORT_DB_TYPES.join(", ")
        )
    })?;
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
    if validate(rule, stored).is_ok() {
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
                check(rule.key, rule.default).is_ok(),
                "the declared default for {} does not satisfy its own rule",
                rule.key
            );
        }
    }

    #[test]
    fn an_unknown_key_is_refused_naming_the_key() {
        let err = check("no_such_setting", "1").expect_err("unknown key");
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
                    check(rule.key, &normalised).is_ok(),
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
        assert!(check("default_folder_id", "null").is_ok());
        assert!(check("tag_order", "null").is_ok());
        // A non-nullable key treats the literal "null" as just another bad value.
        assert!(check("theme", "null").is_err());
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
        assert!(check_batch(ok.iter()).is_ok());

        let bad = map_of(&[("theme", "light"), ("table_page_size", "0")]);
        let err = check_batch(bad.iter()).expect_err("one bad entry refuses the batch");
        assert_eq!(err.key, "table_page_size");
        assert!(err.to_string().contains("between 1 and 500"), "{err}");
    }

    #[test]
    fn ports_are_judged_by_type_and_range() {
        assert!(check("default_ports", "{}").is_ok());
        assert!(check("default_ports", "{\"postgresql\":5432,\"sqlite\":null}").is_ok());
        assert!(check("default_ports", "{\"postgresql\":1}").is_ok());
        assert!(check("default_ports", "{\"postgresql\":65535}").is_ok());
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
                check("default_ports", bad).is_err(),
                "default_ports={bad} must be refused"
            );
        }
    }

    #[test]
    fn hex_colours_are_judged_by_shape() {
        for good in ["#2563EB", "#2563eb", "#ABC", "#2563EBFF"] {
            assert!(check("accent_color", good).is_ok(), "{good}");
        }
        for bad in ["2563EB", "#2563E", "#12345", "#GGGGGG", "#"] {
            assert!(check("accent_color", bad).is_err(), "{bad}");
        }
    }
}
