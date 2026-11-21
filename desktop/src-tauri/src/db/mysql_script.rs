//! MySQL dump splitting for the native (in-process) restore.
//!
//! [`crate::db::sql_split::split_statements`] is the shared, SQL-standard
//! splitter used by query execution and export. A `mysqldump` script differs in
//! ways that corrupt it, and a corrupted split either fails a valid restore or
//! sends half a row:
//!
//! - **Backslash escapes.** `'it\'s'` is one string literal; the standard
//!   splitter closes it at the `\'` and splits mid-statement.
//! - **Doubled quotes.** `'O''Brien; Ltd'` — handled by both, kept here.
//! - **`#` comments.** Not SQL-standard. An apostrophe in one (`# don't`) opens
//!   a string that runs to EOF and merges every later statement.
//! - **`--` comments** are comments only when followed by whitespace in MySQL,
//!   so `1--2` is arithmetic rather than a comment that eats the statement.
//! - **`DELIMITER` directives** carry routine/trigger bodies whose `;` are not
//!   terminators. A directive line is client-side, never sent to the server.
//! - **`/*! … */` executable comments** are statements in their own right.
//! - **Quoted names containing dots or semicolons** (`` `my.table` ``) are one
//!   name; splitting them is what ticket 34 fixes at the clean-planning seam.
//!
//! ## Memory
//!
//! A restore dump is capped at 100 MB ([`crate::commands::backup`]
//! `MAX_RESTORE_FILE_BYTES`). The script is read from disk **once** into a
//! single `String`, and this iterator borrows from it: a normal statement is a
//! [`Cow::Borrowed`] slice, so the whole-script cost beyond that one buffer is
//! the statement index (a `Cow` plus two `usize` per statement). Only a
//! statement that had a `DELIMITER` line spliced into the middle of it — a
//! routine or trigger body — is joined into an owned `String`, because the
//! directive text itself must not reach the server.
//!
//! This is the streaming replacement for `split_statements`, which collects
//! `Vec<char>` (up to 4 bytes per input byte) and copies every statement, so a
//! 100 MB dump peaked at several hundred MB.

use std::borrow::Cow;

/// One statement of a MySQL script, with the position the UI reports when it
/// fails.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MySqlStatement<'a> {
    /// Statement text without its terminator. Borrowed from the script unless a
    /// `DELIMITER` line was spliced into it.
    pub text: Cow<'a, str>,
    /// 1-based position of this statement in the script.
    pub index: usize,
    /// 1-based line the statement's first executable text starts on, so a user
    /// can find it in the file.
    pub line: usize,
}

impl AsRef<str> for MySqlStatement<'_> {
    fn as_ref(&self) -> &str {
        self.text.as_ref()
    }
}

/// Lazy MySQL script splitter. Iterator of [`MySqlStatement`]s.
pub struct MySqlScript<'a> {
    src: &'a str,
    pos: usize,
    line: usize,
    delimiter: String,
    next_index: usize,
}

impl<'a> MySqlScript<'a> {
    pub fn new(src: &'a str) -> Self {
        Self {
            src,
            pos: 0,
            line: 1,
            delimiter: ";".to_string(),
            next_index: 1,
        }
    }

    /// Number of statements yielded so far (the 1-based index of the last one).
    pub fn count(self) -> usize {
        self.map(|s| s.index).last().unwrap_or(0)
    }

    /// Move to `target`, keeping the line counter accurate.
    fn advance_to(&mut self, target: usize) {
        let target = target.min(self.src.len());
        if target > self.pos {
            self.line += self.src[self.pos..target].matches('\n').count();
            self.pos = target;
        }
    }

    fn next_statement(&mut self) -> Option<MySqlStatement<'a>> {
        'fragment: loop {
            // Byte ranges of this statement. More than one only when a
            // `DELIMITER` line interrupted it.
            let mut segs: Vec<(usize, usize)> = Vec::new();
            let mut seg_start: Option<usize> = None;
            let mut start_line = self.line;
            let mut has_exec = false;

            loop {
                if self.pos >= self.src.len() {
                    if let Some(start) = seg_start {
                        segs.push((start, self.src.len()));
                    }
                    if has_exec {
                        return Some(self.emit(segs, start_line));
                    }
                    return None;
                }

                // A `DELIMITER` line is a client directive occupying a whole
                // line. It belongs to no statement and is never sent.
                let at_line_start = self.pos == 0 || self.src.as_bytes()[self.pos - 1] == b'\n';
                if at_line_start {
                    if let Some((consumed, token)) =
                        match_delimiter_directive(&self.src[self.pos..])
                    {
                        if let Some(start) = seg_start.take() {
                            segs.push((start, self.pos));
                        }
                        self.advance_to(self.pos + consumed);
                        self.delimiter = token;
                        continue;
                    }
                }

                let rest = &self.src[self.pos..];
                let byte = rest.as_bytes()[0];

                // Statement terminator (the current, possibly custom one).
                if rest.starts_with(self.delimiter.as_str()) {
                    if let Some(start) = seg_start.take() {
                        segs.push((start, self.pos));
                    }
                    self.advance_to(self.pos + self.delimiter.len());
                    if has_exec {
                        return Some(self.emit(segs, start_line));
                    }
                    // A fragment of only whitespace/comments is not a
                    // statement; keep scanning in the same style.
                    continue 'fragment;
                }

                match byte {
                    b'\'' | b'"' | b'`' => {
                        let quote = byte as char;
                        seg_start.get_or_insert(self.pos);
                        if !has_exec {
                            start_line = self.line;
                            has_exec = true;
                        }
                        self.advance_to(skip_quoted(self.src, self.pos, quote));
                    }
                    b'#' => {
                        seg_start.get_or_insert(self.pos);
                        self.advance_to(line_comment_end(self.src, self.pos));
                    }
                    b'-' if is_dash_comment(rest) => {
                        seg_start.get_or_insert(self.pos);
                        self.advance_to(line_comment_end(self.src, self.pos));
                    }
                    b'/' if rest.as_bytes().get(1) == Some(&b'*') => {
                        seg_start.get_or_insert(self.pos);
                        // `/*! … */` is executed by the server, so a fragment
                        // consisting only of one is still a statement.
                        if rest.as_bytes().get(2) == Some(&b'!') && !has_exec {
                            start_line = self.line;
                            has_exec = true;
                        }
                        match skip_block_comment(self.src, self.pos) {
                            Some(end) => self.advance_to(end),
                            // Unterminated: consume the rest (conservative).
                            None => self.advance_to(self.src.len()),
                        }
                    }
                    c if (c as char).is_ascii_whitespace() => {
                        // Leading whitespace is dropped; interior whitespace is
                        // part of the borrowed slice.
                        self.advance_to(self.pos + 1);
                    }
                    _ => {
                        seg_start.get_or_insert(self.pos);
                        if !has_exec {
                            start_line = self.line;
                            has_exec = true;
                        }
                        let step = rest.chars().next().map(|c| c.len_utf8()).unwrap_or(1);
                        self.advance_to(self.pos + step);
                    }
                }
            }
        }
    }

    /// Finish the statement: borrow it whole when it was contiguous, otherwise
    /// join its pieces with newlines (the removed directive lines).
    fn emit(&mut self, segs: Vec<(usize, usize)>, start_line: usize) -> MySqlStatement<'a> {
        let text = if segs.len() <= 1 {
            match segs.first() {
                Some((start, end)) => Cow::Borrowed(trim_range(self.src, *start, *end)),
                None => Cow::Borrowed(""),
            }
        } else {
            let mut joined = String::new();
            for (start, end) in &segs {
                let part = trim_range(self.src, *start, *end);
                if part.is_empty() {
                    continue;
                }
                if !joined.is_empty() {
                    joined.push('\n');
                }
                joined.push_str(part);
            }
            Cow::Owned(joined)
        };
        let index = self.next_index;
        self.next_index += 1;
        MySqlStatement {
            text,
            index,
            line: start_line,
        }
    }
}

impl<'a> Iterator for MySqlScript<'a> {
    type Item = MySqlStatement<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        self.next_statement()
    }
}

fn trim_range(src: &str, start: usize, end: usize) -> &str {
    src[start..end].trim()
}

fn char_len_at(src: &str, i: usize) -> usize {
    src[i..].chars().next().map(|c| c.len_utf8()).unwrap_or(1)
}

/// Skip a quoted region starting at `start` (the opening quote). Returns the
/// index just past the closing quote, or the end of input when unterminated.
///
/// MySQL escapes a quote inside a string with a backslash *or* by doubling it;
/// inside a backtick identifier only doubling is an escape.
fn skip_quoted(src: &str, start: usize, quote: char) -> usize {
    let bytes = src.as_bytes();
    let q = quote as u8;
    let mut i = start + 1;
    while i < bytes.len() {
        if bytes[i] == b'\\' && quote != '`' {
            // Escape the next *character* (it may be multi-byte), so the
            // returned index stays on a char boundary.
            i += 1;
            if i < bytes.len() {
                i += char_len_at(src, i);
            }
            continue;
        }
        if bytes[i] == q {
            if bytes.get(i + 1) == Some(&q) {
                i += 2; // doubled quote/backtick escape
                continue;
            }
            return i + 1;
        }
        i += 1;
    }
    bytes.len()
}

/// MySQL line comments start with `#` or with `--` followed by whitespace (or
/// end of input). `1--2` is arithmetic, not a comment.
pub(crate) fn is_dash_comment(rest: &str) -> bool {
    if !rest.starts_with("--") {
        return false;
    }
    match rest.as_bytes().get(2) {
        None => true,
        Some(b) => (*b as char).is_ascii_whitespace(),
    }
}

pub(crate) fn line_comment_end(src: &str, start: usize) -> usize {
    match src[start..].find('\n') {
        Some(off) => start + off + 1,
        None => src.len(),
    }
}

/// Skip a `/* … */` comment (no nesting per SQL). `None` when unterminated.
pub(crate) fn skip_block_comment(src: &str, start: usize) -> Option<usize> {
    let bytes = src.as_bytes();
    let mut i = start + 2;
    while i + 1 < bytes.len() {
        if bytes[i] == b'*' && bytes[i + 1] == b'/' {
            return Some(i + 2);
        }
        i += 1;
    }
    None
}

/// Match a MySQL client `DELIMITER <token>` directive on the line starting at
/// `rest[0]`. Returns the bytes consumed (through the line ending) and the new
/// delimiter. Conservative: anything other than
/// `^[ \t]*DELIMITER[ \t]+<token>[ \t]*$` is left as ordinary text.
fn match_delimiter_directive(rest: &str) -> Option<(usize, String)> {
    let bytes = rest.as_bytes();
    let mut j = 0;
    while j < bytes.len() && matches!(bytes[j], b' ' | b'\t') {
        j += 1;
    }
    for kw in b"DELIMITER" {
        if j >= bytes.len() || !bytes[j].eq_ignore_ascii_case(kw) {
            return None;
        }
        j += 1;
    }
    if j >= bytes.len() || !matches!(bytes[j], b' ' | b'\t') {
        return None; // `DELIMITERx` is not a directive
    }
    while j < bytes.len() && matches!(bytes[j], b' ' | b'\t') {
        j += 1;
    }
    let token_start = j;
    while j < bytes.len() && !matches!(bytes[j], b' ' | b'\t' | b'\r' | b'\n') {
        j += 1;
    }
    if token_start == j {
        return None; // no token
    }
    let token = rest[token_start..j].to_string();
    // The rest of the line must be blank, otherwise this is not a directive.
    let mut k = j;
    while k < bytes.len() && matches!(bytes[k], b' ' | b'\t') {
        k += 1;
    }
    if k < bytes.len() && !matches!(bytes[k], b'\r' | b'\n') {
        return None;
    }
    while k < bytes.len() && matches!(bytes[k], b'\r' | b'\n') {
        k += 1;
    }
    Some((k, token))
}

#[cfg(test)]
#[path = "mysql_script.test.rs"]
mod mysql_script_tests;
