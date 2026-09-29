//! Pure SQL statement splitter shared by multi-result execution and the
//! streaming export (single-statement validation).
//!
//! A hand-rolled state machine (no new dependencies). It understands:
//! single/double/backtick-quoted strings with doubled-quote escapes,
//! `--` line comments, `/* */` block comments, and PostgreSQL dollar-quoted
//! bodies (`$$…$$`, `$tag$…$tag$`). Conservative by design: anything it
//! cannot confidently close is kept inside the current statement rather
//! than split — a naive semicolon split that could execute fragmentary SQL
//! is unacceptable (spec §2).
//!
//! Statement classification (SELECT vs DML vs DDL) happens at execution
//! time, not here.

/// Split `sql` into ordered statement texts. Comment-only and empty
/// fragments are dropped. Statement text keeps its comments verbatim.
pub fn split_statements(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let mut stmts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut i = 0usize;
    // MySQL's client-side `DELIMITER` directive. Default matches the SQL
    // standard terminator so behaviour is unchanged when no directive appears.
    let mut delimiter: Vec<char> = vec![';'];

    while i < chars.len() {
        // A `DELIMITER` line is a client directive, not SQL. Only recognised
        // at the start of a line: quoted regions, block comments and line
        // comments are copied atomically below, so a directive inside any of
        // them can never reach this check.
        if i == 0 || chars[i - 1] == '\n' {
            if let Some((end, token)) = match_delimiter_directive(&chars, i) {
                delimiter = token.chars().collect();
                i = end;
                continue;
            }
        }
        let c = chars[i];
        let at_delimiter = starts_with(&chars, i, &delimiter);
        match c {
            '\'' | '"' | '`' => {
                copy_quoted(&chars, &mut i, &mut current, c);
            }
            '-' if peek(&chars, i + 1) == Some('-') => {
                copy_until(&chars, &mut i, &mut current, |ch| ch == '\n');
            }
            '/' if peek(&chars, i + 1) == Some('*') => {
                copy_block_comment(&chars, &mut i, &mut current);
            }
            _ if at_delimiter => {
                if has_executable_text(&current) {
                    stmts.push(current.trim().to_string());
                }
                current.clear();
                i += delimiter.len();
            }
            '$' => {
                if let Some(end) = dollar_quote_end(&chars, i) {
                    for _ in i..end {
                        if i < chars.len() {
                            current.push(chars[i]);
                            i += 1;
                        }
                    }
                } else {
                    current.push(c);
                    i += 1;
                }
            }
            _ => {
                current.push(c);
                i += 1;
            }
        }
    }

    if has_executable_text(&current) {
        stmts.push(current.trim().to_string());
    }
    stmts
}

fn peek(chars: &[char], idx: usize) -> Option<char> {
    chars.get(idx).copied()
}

/// Copy a quoted region starting at the opening `quote` char. Doubled quotes
/// are escapes and stay inside the region. Unterminated quotes consume the
/// rest of the input (conservative).
fn copy_quoted(chars: &[char], i: &mut usize, out: &mut String, quote: char) {
    out.push(chars[*i]);
    *i += 1;
    while *i < chars.len() {
        let c = chars[*i];
        out.push(c);
        *i += 1;
        if c == quote {
            if peek(chars, *i) == Some(quote) {
                // doubled quote — escaped, keep it and continue
                out.push(quote);
                *i += 1;
            } else {
                return;
            }
        }
    }
}

/// Copy characters until `stop` matches (inclusive for `\n` handled by the
/// caller's predicate) or input ends.
fn copy_until(chars: &[char], i: &mut usize, out: &mut String, stop: impl Fn(char) -> bool) {
    while *i < chars.len() {
        let c = chars[*i];
        out.push(c);
        *i += 1;
        if stop(c) {
            return;
        }
    }
}

/// Copy a `/* … */` block comment (no nesting per the SQL standard).
fn copy_block_comment(chars: &[char], i: &mut usize, out: &mut String) {
    out.push(chars[*i]); // '/'
    *i += 1;
    if *i < chars.len() {
        out.push(chars[*i]); // '*'
        *i += 1;
    }
    while *i < chars.len() {
        let c = chars[*i];
        out.push(c);
        *i += 1;
        if c == '*' && peek(chars, *i) == Some('/') {
            out.push('/');
            *i += 1;
            return;
        }
    }
}

/// At `chars[start] == '$'`, try to match `$[A-Za-z_][A-Za-z0-9_]*$` and find
/// the matching closing delimiter. Returns the index one past the closing
/// delimiter, or None if this is not a well-formed (and closable) dollar
/// quote — in which case the `$` is ordinary text.
fn dollar_quote_end(chars: &[char], start: usize) -> Option<usize> {
    let mut j = start + 1;
    if j < chars.len() && chars[j] == '$' {
        // bare $$ body
        let tag = String::new();
        return find_dollar_close(chars, j + 1, &tag);
    }
    let mut tag = String::new();
    while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
        tag.push(chars[j]);
        j += 1;
    }
    if tag.is_empty() || j >= chars.len() || chars[j] != '$' {
        return None; // not $tag$
    }
    find_dollar_close(chars, j + 1, &tag)
}

fn find_dollar_close(chars: &[char], from: usize, tag: &str) -> Option<usize> {
    let closing: Vec<char> = format!("${tag}$").chars().collect();
    let mut j = from;
    while j + closing.len() <= chars.len() {
        if chars[j..j + closing.len()] == closing[..] {
            return Some(j + closing.len());
        }
        j += 1;
    }
    None
}

/// True if the fragment contains anything other than whitespace and comments
/// (comments are preserved in statement text, but a fragment that is ONLY
/// comments/whitespace is not a statement).
pub fn has_executable_text(stmt: &str) -> bool {
    let chars: Vec<char> = stmt.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '\'' | '"' | '`' => {
                let mut probe = String::new();
                let mut j = i;
                copy_quoted(&chars, &mut j, &mut probe, c);
                return true; // a quoted region IS executable text
            }
            '-' if peek(&chars, i + 1) == Some('-') => {
                skip_until(&chars, &mut i, |ch| ch == '\n');
            }
            '/' if peek(&chars, i + 1) == Some('*') => {
                // MySQL executable comments (`/*! … */`, optionally
                // version-gated like `/*!50003 … */`) are executed by the
                // server, so a fragment that is only such a comment is still
                // a statement. mysqldump wraps routine and trigger definitions
                // in them with no surrounding SQL. Ordinary block comments
                // remain skipped.
                if peek(&chars, i + 2) == Some('!') {
                    return true;
                }
                skip_block_comment(&chars, &mut i);
            }
            c if c.is_whitespace() => i += 1,
            _ => return true,
        }
    }
    false
}

fn skip_until(chars: &[char], i: &mut usize, stop: impl Fn(char) -> bool) {
    while *i < chars.len() {
        let c = chars[*i];
        *i += 1;
        if stop(c) {
            return;
        }
    }
}

fn skip_block_comment(chars: &[char], i: &mut usize) {
    *i += 2; // "/*"
    while *i < chars.len() {
        if chars[*i] == '*' && peek(chars, *i + 1) == Some('/') {
            *i += 2;
            return;
        }
        *i += 1;
    }
}

/// True when `chars[i..]` begins with `pat`.
fn starts_with(chars: &[char], i: usize, pat: &[char]) -> bool {
    !pat.is_empty() && i + pat.len() <= chars.len() && chars[i..i + pat.len()] == *pat
}

/// Match a MySQL client `DELIMITER <token>` directive that occupies a whole
/// line. Returns the index just past the directive's newline and the new
/// delimiter token. Conservative: anything other than
/// `^[ \t]*DELIMITER[ \t]+<token>[ \t]*$` is left as ordinary text.
fn match_delimiter_directive(chars: &[char], i: usize) -> Option<(usize, String)> {
    let mut j = i;
    while j < chars.len() && matches!(chars[j], ' ' | '\t') {
        j += 1;
    }
    for kw in ['D', 'E', 'L', 'I', 'M', 'I', 'T', 'E', 'R'] {
        if j >= chars.len() || chars[j].to_ascii_uppercase() != kw {
            return None;
        }
        j += 1;
    }
    if j >= chars.len() || !matches!(chars[j], ' ' | '\t') {
        return None; // `DELIMITERx` is not a directive
    }
    while j < chars.len() && matches!(chars[j], ' ' | '\t') {
        j += 1;
    }
    let start = j;
    while j < chars.len() && !matches!(chars[j], ' ' | '\t' | '\r' | '\n') {
        j += 1;
    }
    if start == j {
        return None; // no token
    }
    let token: String = chars[start..j].iter().collect();
    // The rest of the line must be blank, otherwise this is not a directive.
    let mut k = j;
    while k < chars.len() && matches!(chars[k], ' ' | '\t') {
        k += 1;
    }
    if k < chars.len() && !matches!(chars[k], '\r' | '\n') {
        return None;
    }
    while k < chars.len() && matches!(chars[k], '\r' | '\n') {
        k += 1;
    }
    Some((k, token))
}

#[cfg(test)]
#[path = "sql_split.test.rs"]
mod sql_split_tests;
