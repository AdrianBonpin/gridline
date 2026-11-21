/**
 * Fixture expectations for the desktop end-to-end harness.
 *
 * The demo SQLite database is seeded at application startup by
 * `desktop/src-tauri/src/commands/demo.rs` (`ensure_demo_db`) from
 * `commands/demo_schema.sql`. The harness never invents its own fixtures: it
 * drives the real seeded demo and asserts text that the seed literally
 * contains. `expectations.test.ts` fails if these values drift away from the
 * seeder, so a rename cannot silently turn the smoke assertion into a no-op.
 */

/** Connection name created by `commands/demo.rs` (`DEMO_CONNECTION_NAME`). */
export const DEMO_CONNECTION_NAME = "Gridline Demo (SQLite)";

/** Demo table opened by the smoke flow (24 seeded rows, fits on one page). */
export const DEMO_TABLE = "products";

/**
 * Cell text that must be visible in the grid once `products` loads. Both
 * values belong to the same seeded row (`GL-MSE-001` / "Gridline Wireless
 * Mouse"), so they also prove the grid renders whole rows, not just headers.
 */
export const DEMO_TABLE_CELLS = ["GL-MSE-001", "Gridline Wireless Mouse"];

export function connectionCardSelector(name = DEMO_CONNECTION_NAME) {
  return `[data-testid="connection-card"][data-connection-name="${name}"]`;
}

export function tableTreeItemSelector(table = DEMO_TABLE) {
  return `[data-testid="table-tree-item"][data-table-name="${table}"]`;
}

export function gridSelector() {
  return '[role="grid"]';
}

/**
 * Query workspace anchors for the destructive-execution flow.
 *
 * Each selector targets an accessible label or a `data-testid` that the owning
 * component pins in its own unit test, so renaming the UI breaks a fast test
 * instead of silently turning an end-to-end assertion into a no-op.
 */
export function newQueryTabSelector() {
  return 'button[aria-label="New query tab"]';
}

/** Monaco's hidden input area: clicking the editor focuses it, then sendKeys types. */
export function queryEditorInputSelector() {
  return '[data-testid="query-editor"] textarea.inputarea';
}

export function runQuerySelector() {
  return 'button[aria-label="Run query"]';
}

/** The query tab's toolbar re-run control (TableControls, query variant). */
export function rerunQuerySelector() {
  return 'button[aria-label="Re-run query"]';
}

export function destructiveDialogSelector() {
  return '[data-testid="destructive-query-dialog"]';
}

export function destructiveDialogConfirmSelector() {
  return '[data-testid="destructive-query-confirm"]';
}

export function destructiveDialogCancelSelector() {
  return '[data-testid="destructive-query-cancel"]';
}
