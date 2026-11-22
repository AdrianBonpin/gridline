use super::*;

// --- tokenizer ---

#[test]
fn the_tokenizer_keeps_every_byte_of_the_source() {
    let sql = "CREATE TABLE \"a\"\"b\" (x TEXT DEFAULT 'q''q', -- note\n y [z z])";
    let tokens = tokenize(sql);
    let round_trip: String = tokens.iter().map(|t| t.text.as_str()).collect();
    assert_eq!(round_trip, sql, "tokens cover the input exactly");
    assert_eq!(
        tokens
            .iter()
            .find(|t| t.kind == TokenKind::Str)
            .map(|t| t.text.as_str()),
        Some("'q''q'"),
        "a string literal is one token, including its doubled-quote escape"
    );
    assert!(
        tokens.iter().any(|t| t.kind == TokenKind::Comment),
        "a line comment is its own token"
    );
}

#[test]
fn a_quoted_identifier_reports_its_unquoted_value() {
    for (text, value) in [
        ("\"a b\"", "a b"),
        ("\"a\"\"b\"", "a\"b"),
        ("[a b]", "a b"),
        ("`a b`", "a b"),
        ("plain", "plain"),
    ] {
        let token = tokenize(text)
            .into_iter()
            .find(|t| !t.is_space())
            .expect("a token");
        assert_eq!(
            token.ident_value().as_deref(),
            Some(value),
            "{text} names {value}"
        );
    }
    let number = tokenize("42").into_iter().next().unwrap();
    assert_eq!(number.ident_value(), None, "a number is not an identifier");
}

#[test]
fn statements_split_at_top_level_semicolons_only() {
    let script = "CREATE TABLE t (a TEXT DEFAULT 'x;y');\nINSERT INTO t VALUES ('a;b');";
    let statements = split_statements(script);
    assert_eq!(statements.len(), 2, "{statements:?}");
    assert!(statements[0].contains("'x;y'"));
    assert!(statements[1].starts_with("INSERT"));
}

// --- CREATE TABLE parsing ---

const DEMO_USERS: &str = "CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','guest')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
)";

#[test]
fn columns_keep_their_type_and_their_clauses_verbatim() {
    let table = parse_create_table(DEMO_USERS).expect("parses");
    assert_eq!(table.name, "users");
    assert_eq!(table.constraints, Vec::new());
    assert_eq!(
        table
            .columns
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>(),
        vec!["id", "email", "role", "created_at", "updated_at"]
    );

    let id = table.column("id").unwrap();
    assert_eq!(id.type_, "INTEGER");
    assert!(id.clause(ClauseKind::PrimaryKey).is_some());

    let role = table
        .column("ROLE")
        .expect("identifiers are case-insensitive");
    assert_eq!(
        role.clause(ClauseKind::Default).map(|c| c.text.as_str()),
        Some("DEFAULT 'customer'"),
        "the default literal is kept verbatim"
    );
    assert_eq!(
        role.clause(ClauseKind::Check).map(|c| c.text.as_str()),
        Some("CHECK (role IN ('admin','guest'))"),
        "the check keeps its expression, spaces and all"
    );

    let created = table.column("created_at").unwrap();
    assert_eq!(
        created.clause(ClauseKind::Default).map(|c| c.text.as_str()),
        Some("DEFAULT (datetime('now'))"),
        "an expression default keeps the parentheses that make it emit-able"
    );
}

#[test]
fn a_table_level_constraint_is_not_read_as_a_column() {
    let table = parse_create_table(
        "CREATE TABLE order_items (
            order_id INTEGER NOT NULL REFERENCES orders(id),
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
            CONSTRAINT order_items_pk PRIMARY KEY (order_id, product_id),
            UNIQUE (order_id, quantity),
            CHECK (quantity > 0),
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE SET NULL
        )",
    )
    .expect("parses");
    assert_eq!(
        table
            .columns
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>(),
        vec!["order_id", "product_id", "quantity"],
        "the constraints are not mistaken for columns"
    );
    assert_eq!(table.constraints.len(), 4, "{:?}", table.constraints);

    let pk = &table.constraints[0];
    assert_eq!(pk.kind, ConstraintKind::PrimaryKey);
    assert_eq!(pk.name.as_deref(), Some("order_items_pk"));
    assert_eq!(pk.columns, vec!["order_id", "product_id"]);

    assert_eq!(table.constraints[1].kind, ConstraintKind::Unique);
    assert_eq!(table.constraints[1].columns, vec!["order_id", "quantity"]);

    let fk = &table.constraints[3];
    assert_eq!(fk.kind, ConstraintKind::ForeignKey);
    assert_eq!(
        fk.columns,
        vec!["product_id"],
        "only the local columns, not the referenced ones"
    );
    assert!(
        fk.text.contains("ON DELETE CASCADE ON UPDATE SET NULL"),
        "{}",
        fk.text
    );

    // A CHECK's dependencies are every identifier its expression mentions.
    let check = &table.constraints[2];
    assert_eq!(check.kind, ConstraintKind::Check);
    assert_eq!(check.dependent_columns(), vec!["quantity"]);
}

#[test]
fn a_column_named_like_a_constraint_keyword_is_still_a_column() {
    // `check` / `unique` are legal column names; only `KEY (…)` and `(…)` after
    // the keyword make a table constraint.
    let table = parse_create_table(
        "CREATE TABLE t (check TEXT, unique TEXT, primary_key TEXT, CONSTRAINTED TEXT)",
    )
    .expect("parses");
    assert_eq!(
        table
            .columns
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>(),
        vec!["check", "unique", "primary_key", "CONSTRAINTED"]
    );
    assert!(table.constraints.is_empty());
}

#[test]
fn generated_columns_and_collations_are_kept_whole() {
    let table = parse_create_table(
        "CREATE TABLE t (
            a INTEGER,
            b INTEGER GENERATED ALWAYS AS (a * 2) VIRTUAL,
            c TEXT COLLATE NOCASE DEFAULT 'x',
            d INTEGER AS (a + 1) STORED
        )",
    )
    .expect("parses");
    assert!(table.column("a").unwrap().is_generated() == false);
    assert!(table.column("b").unwrap().is_generated());
    assert!(table.column("d").unwrap().is_generated());
    assert_eq!(
        table.column("d").unwrap().definition,
        "d INTEGER AS (a + 1) STORED",
        "a generated column keeps its whole definition"
    );
    assert_eq!(
        table
            .column("c")
            .unwrap()
            .clause(ClauseKind::Collate)
            .map(|c| c.text.as_str()),
        Some("COLLATE NOCASE")
    );
}

#[test]
fn table_options_are_kept_after_the_column_list() {
    let without_rowid =
        parse_create_table("CREATE TABLE t (id TEXT PRIMARY KEY) WITHOUT ROWID").expect("parses");
    assert_eq!(without_rowid.options, vec!["WITHOUT ROWID".to_string()]);
    let strict = parse_create_table("CREATE TABLE t (id INTEGER PRIMARY KEY, n INT) STRICT;")
        .expect("parses");
    assert_eq!(strict.options, vec!["STRICT".to_string()]);
    let both = parse_create_table("CREATE TABLE t (id TEXT PRIMARY KEY) STRICT, WITHOUT ROWID")
        .expect("parses");
    assert_eq!(
        both.options,
        vec!["STRICT".to_string(), "WITHOUT ROWID".to_string()]
    );
}

#[test]
fn a_foreign_key_action_is_not_read_as_a_not_null_clause() {
    let table = parse_create_table(
        "CREATE TABLE t (
            id INTEGER PRIMARY KEY,
            parent INTEGER REFERENCES parent(id) NOT DEFERRABLE INITIALLY DEFERRED
        )",
    )
    .expect("parses");
    let parent = table.column("parent").unwrap();
    assert!(
        parent.clause(ClauseKind::NotNull).is_none(),
        "NOT DEFERRABLE belongs to the foreign-key clause: {:?}",
        parent.clauses
    );
    assert_eq!(
        parent
            .clause(ClauseKind::References)
            .map(|c| c.text.as_str()),
        Some("REFERENCES parent(id) NOT DEFERRABLE INITIALLY DEFERRED")
    );
}

#[test]
fn a_virtual_table_is_not_a_creatable_table() {
    let err = parse_create_table("CREATE VIRTUAL TABLE docs USING fts5(body)")
        .expect_err("a virtual table has no column list");
    assert!(err.contains("not a CREATE TABLE"), "{err}");
    assert!(parse_create_table("SELECT 1").is_err());
}

// --- identifier rewriting ---

#[test]
fn a_rename_rewrites_column_identifiers_but_not_table_names_or_literals() {
    let renames = vec![("quantity".to_string(), "qty".to_string())];
    let sql = "CREATE INDEX idx ON orders(quantity) WHERE status = 'quantity'";
    assert_eq!(
        rewrite_identifiers(sql, &renames, "orders"),
        "CREATE INDEX idx ON orders(\"qty\") WHERE status = 'quantity'",
        "the indexed column is renamed; the table and the string literal are not"
    );

    let trigger = "CREATE TRIGGER trg AFTER UPDATE OF quantity ON orders BEGIN \
                   UPDATE orders SET quantity = OLD.quantity WHERE rowid = NEW.rowid; END";
    assert_eq!(
        rewrite_identifiers(trigger, &renames, "orders"),
        "CREATE TRIGGER trg AFTER UPDATE OF \"qty\" ON orders BEGIN \
         UPDATE orders SET \"qty\" = OLD.\"qty\" WHERE rowid = NEW.rowid; END"
    );
}

#[test]
fn a_rename_never_touches_a_shadowed_name() {
    let renames = vec![("name".to_string(), "label".to_string())];
    // A column whose name is a substring of another identifier is not renamed.
    let sql = "CREATE INDEX i ON t(username, name)";
    assert_eq!(
        rewrite_identifiers(sql, &renames, "t"),
        "CREATE INDEX i ON t(username, \"label\")"
    );
    // No renames means the text is returned untouched.
    assert_eq!(
        rewrite_identifiers(sql, &[], "t"),
        "CREATE INDEX i ON t(username, name)"
    );
}

// --- rebuild script plan ---

#[test]
fn a_rebuild_script_is_read_back_as_a_plan() {
    let script = "CREATE TABLE \"main\".\"_gl_t_tmp\" (\"a\" TEXT, \"b\" TEXT);\n\
                  INSERT INTO \"main\".\"_gl_t_tmp\" (\"a\", \"b\") SELECT \"x\", \"y\" FROM \"main\".\"t\";\n\
                  DROP TABLE \"main\".\"t\";\n\
                  ALTER TABLE \"main\".\"_gl_t_tmp\" RENAME TO \"t\";\n\
                  CREATE INDEX \"main\".\"idx_t_a\" ON \"t\"(\"a\");\n\
                  CREATE TRIGGER \"main\".\"trg_t\" AFTER UPDATE ON \"t\" BEGIN SELECT 1; END;";
    let plan = parse_rebuild_script(script).expect("parses");
    assert_eq!(plan.tmp_table, "_gl_t_tmp");
    assert_eq!(plan.columns, vec!["a", "b"]);
    assert_eq!(
        plan.copy,
        vec![
            ("x".to_string(), "a".to_string()),
            ("y".to_string(), "b".to_string())
        ]
    );
    let live = vec!["x".to_string(), "y".to_string()];
    assert_eq!(
        plan.renamed_columns(&live).unwrap(),
        vec![
            ("x".to_string(), "a".to_string()),
            ("y".to_string(), "b".to_string())
        ],
        "the copy step is the Column Identity mapping"
    );
    assert_eq!(plan.index_sql.len(), 1);
    assert_eq!(plan.trigger_sql.len(), 1);
    assert!(!plan.restores_sequence);
}

#[test]
fn a_positional_copy_is_reported_as_positional() {
    let script = "CREATE TABLE \"main\".\"_gl_t_tmp\" (\"a\" TEXT, \"b\" TEXT);\n\
                  INSERT INTO \"main\".\"_gl_t_tmp\" (\"a\", \"b\") SELECT * FROM \"main\".\"t\"";
    let plan = parse_rebuild_script(script).expect("parses");
    let live = vec!["a".to_string(), "b".to_string()];
    assert!(
        plan.renamed_columns(&live).unwrap().is_empty(),
        "a positional copy carries no rename"
    );
    assert_eq!(
        plan.copy_pairs(&live).unwrap(),
        vec![
            ("a".to_string(), "a".to_string()),
            ("b".to_string(), "b".to_string())
        ],
        "position is only the identity when the copy is positional"
    );
    assert!(
        plan.copy_pairs(&vec!["a".to_string()]).is_err(),
        "a positional copy that does not line up with the live table is unreadable"
    );
}

#[test]
fn a_sequence_restore_is_recognised() {
    let script =
        "CREATE TABLE \"main\".\"_gl_t_tmp\" (\"id\" INTEGER PRIMARY KEY AUTOINCREMENT);\n\
                  INSERT INTO \"main\".\"_gl_t_tmp\" (\"id\") SELECT \"id\" FROM \"main\".\"t\";\n\
                  UPDATE \"main\".\"sqlite_sequence\" SET seq = 7 WHERE name = 't'";
    let plan = parse_rebuild_script(script).expect("parses");
    assert!(plan.restores_sequence);
    assert!(plan.declares_autoincrement());
}

#[test]
fn a_script_without_a_create_table_is_not_a_rebuild() {
    let err = parse_rebuild_script("SELECT 1").expect_err("no replacement table");
    assert!(err.contains("replacement table"), "{err}");
    let err =
        parse_rebuild_script("INSERT INTO \"main\".\"x\" (\"a\") SELECT \"a\" FROM \"main\".\"t\"")
            .expect_err("no replacement table");
    assert!(err.contains("replacement table"), "{err}");
}
