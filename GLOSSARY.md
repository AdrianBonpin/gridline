# Gridline

Gridline is an open-source desktop database client for browsing, querying, editing, and administering databases.

## Language

**Changes Queue**:
The collection of staged database changes that have not yet been applied. Pending work is grouped by its **Change Origin**, and only work belonging to the active origin can be committed.
_Avoid_: global queue, transaction, autosave

**Change Origin**:
The exact saved connection, selected database, and connection-target configuration to which a staged change belongs. A change can be committed only when that origin still matches the active target.
_Avoid_: active connection, current tab, current schema

**Commit All**:
The sequential application of pending changes for the active **Change Origin**, stopping at the first failure. Each change has its own atomicity guarantee; earlier successful changes remain committed and the outcome explicitly reports partial success.
_Avoid_: global transaction, all-or-nothing, rollback of the whole queue

**File Grant**:
Short-lived authorization created by a Rust-brokered native file selection for one intended operation and one job. A displayed or renderer-supplied path is not a File Grant.
_Avoid_: raw path authorization, persisted scope, ambient file access

**Row Identity**:
The complete set of values used to address exactly one row for an edit or delete: every primary-key column when a primary key exists, or a backend row locator only when no primary key exists. A grid position is never a Row Identity.
_Avoid_: row index, selected index, first primary-key column

**Column Identity**:
The stable identity of a column across a table edit. Renaming is explicit user intent; column position, type similarity, and ordinals never establish identity.
_Avoid_: same-position column, ordinal match, inferred rename

**Connection-owned Data**:
The query history, recent-connection records, and connection-specific saved queries that belong to a saved connection. Deleting the connection permanently deletes this data; global saved queries are not Connection-owned Data.
_Avoid_: orphaned data, archived connection data, global queries

**Execution Entry Point**:
Any user action or timer that can send SQL to a database, including initial runs, re-runs, history/saved-query runs, refresh, auto-refresh, and export. Every Execution Entry Point must apply the safety rules appropriate to the operation.
_Avoid_: Run button, manual query, query path

**SSH Host Trust**:
The verified association between an SSH server and its host key, established from known hosts or explicit first-use fingerprint acceptance before credentials are sent. A changed key fails closed.
_Avoid_: connected, encrypted-only trust, implicit trust

## Relationships

- A **Changes Queue** contains many staged changes, each with one **Change Origin**.
- **Commit All** applies only pending changes from the active **Change Origin**.
- A file operation consumes one matching **File Grant**.
- A saved connection owns **Connection-owned Data**.
- A table edit preserves **Column Identity** independently of column order.
- An edit or delete uses one **Row Identity**.
- An **Execution Entry Point** may execute one or more SQL statements.
- An SSH connection requires **SSH Host Trust** before authentication.

## Flagged ambiguities

- "Current connection" was used to mean both the connection being viewed and the connection a staged change came from. Resolved: the former is the active target; the latter is the **Change Origin**.
- "Row locator" was used for both a complete composite primary key and a backend-only physical locator. Resolved: **Row Identity** is the umbrella term; a physical locator is used only when no primary key exists.
- "Rename detection" treated matching position and attributes as identity. Resolved: **Column Identity** is stable and a rename requires explicit intent.
