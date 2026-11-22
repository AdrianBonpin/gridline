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

/**
 * Demo table with a composite primary key — the Row Identity fixture for the
 * composite-key edit flow. `order_items` is keyed by `(order_id, product_id)`,
 * and its first two rendered rows share `order_id`, so a single-column key
 * would change both.
 */
export const COMPOSITE_TABLE = "order_items";

/** `order_items` columns in the order the demo schema declares them. */
export const COMPOSITE_TABLE_COLUMNS = ["order_id", "product_id", "quantity", "unit_price"];

/** The editable column the composite-key flow rewrites. */
export const COMPOSITE_EDIT_COLUMN = "quantity";

/**
 * Cell text that must be visible once `order_items` loads. Both values are the
 * seeded `unit_price` of the first two rows (products 1 and 3), so seeing them
 * proves the table rendered its own data rather than another table's.
 */
export const COMPOSITE_TABLE_CELLS = ["34.99", "44.99"];

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

/**
 * Monaco's hidden input area — the element keys are sent to.
 *
 * Never *click* this: measured on the built app it is a 1x1 element at
 * `z-index:-10`, painted behind `.view-lines`, so a W3C element-targeted click
 * is intercepted by `div.view-line` every time ("element click intercepted").
 * Focus the editor through {@link queryEditorSurfaceSelector} and type here.
 */
export function queryEditorInputSelector() {
  return '[data-testid="query-editor"] textarea.inputarea';
}

/**
 * The rendered editor surface — a real hit target, so clicking it focuses Monaco
 * exactly as a user's click does. `destructiveFlow`/`sqliteRebuildFlow` click
 * this and then send keys to {@link queryEditorInputSelector}.
 */
export function queryEditorSurfaceSelector() {
  return '[data-testid="query-editor"] .monaco-editor .view-lines';
}

/** A harmless read the destructive flow runs first, so a result set exists. */
export const READ_ONLY_SCRIPT = "SELECT count(*) AS n FROM products;";

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

/**
 * Keys the destructive flow sends to the confirmation dialog itself.
 *
 * `\uE00C` is the WebDriver Escape key and must cancel the pending request.
 * `\uE009\uE007` is Control+Enter — the editor's own run shortcut — which must
 * never execute or relocate the pending confirmation.
 */
export function destructiveDialogEscapeKey() {
  return "\uE00C";
}

export function destructiveDialogRunShortcut() {
  return "\uE009\uE007";
}

export function destructiveDialogCancelSelector() {
  return '[data-testid="destructive-query-cancel"]';
}

/**
 * One data-row cell: the row's first child is the selection checkbox, so the
 * declared column at `colIndex` is its `colIndex + 2`-th child.
 */
export function rowCellSelector(rowIndex, colIndex) {
  return `[role="grid"] [data-index="${rowIndex}"] > div:nth-child(${colIndex + 2})`;
}

/** The open cell editor's input (the grid renders it inside the edited cell). */
export function cellEditorSelector() {
  return '[data-testid="cell-editor"] input';
}

/** The tab-bar toggle that opens the changes queue popover. */
export function changesQueueSelector() {
  return '[data-testid="changes-queue-toggle"]';
}

/** The popover's Commit All button. */
export function commitAllSelector() {
  return '[data-testid="commit-all"]';
}

// ---------------------------------------------------------------------------
// SQLite rebuild flow (ticket 08)
// ---------------------------------------------------------------------------

/**
 * A demo table no rebuild can reproduce faithfully today: `order_items` carries
 * a composite primary key, a CHECK, foreign keys, and an explicit index, and the
 * rebuild script drops every one of them. The editor must refuse the rebuild
 * and stage nothing.
 */
export const REBUILD_REFUSED_TABLE = "order_items";

/**
 * A table the flow creates itself (through the query workspace) so the rebuild
 * has a shape it can complete: no AUTOINCREMENT, index, trigger, key, check,
 * unique, generated column, collation, expression default, or table option.
 */
export const REBUILD_CREATED_TABLE = "e2e_rebuild";

/** Seeded rows the completed rebuild must still show. */
export const REBUILD_CREATED_CELLS = ["alpha", "beta"];

/**
 * The column the refusal half makes the editor drop.
 *
 * It has to be a column a **preserved object names**, otherwise nothing refuses:
 * `blockers_for()` only blocks a dropped column that a preserved index, trigger,
 * constraint, or generated expression uses. The old fixture dropped
 * `unit_price`, which no index, CHECK, or key names — so `{"ok":true,"reasons":[]}`
 * was the correct answer and the flow was asserting a refusal that the rebuild
 * no longer produces (ticket 10 made the rebuild preserve indexes, keys, checks,
 * and triggers). `product_id` is named by `idx_order_items_product_id` and by its
 * own `REFERENCES products(id)` foreign key, so dropping it must refuse.
 */
export const REBUILD_REFUSED_DROPPED_COLUMN = "product_id";

/** The column the completed rebuild drops, with its seeded value. */
export const REBUILD_DROPPED_COLUMN = "note";
export const REBUILD_DROPPED_VALUES = ["first", "second"];

/**
 * Create + seed the rebuild fixture through the query workspace. Two statements
 * in one run: the app stages schema work through `execute_query`/`Ddl`, and a
 * `CREATE TABLE` reaching the database is what makes the table appear in the
 * tree. The script never touches demo data.
 */
export function rebuildFixtureScript() {
  return (
    `CREATE TABLE ${REBUILD_CREATED_TABLE} (` +
    "id INTEGER PRIMARY KEY, label TEXT NOT NULL, note TEXT); " +
    `INSERT INTO ${REBUILD_CREATED_TABLE} (id, label, note) VALUES ` +
    "(1, 'alpha', 'first'), (2, 'beta', 'second');"
  );
}

/** The table row's overflow button (the one that opens the actions menu). */
export function tableOptionsSelector(table) {
  return `[data-testid="table-tree-item"][data-table-name="${table}"] [aria-label="Table options"]`;
}

/** One item of that menu, e.g. `edit_table`. */
export function tableMenuItemSelector(id) {
  return `[data-testid="table-menu-${id}"]`;
}

/** The table editor's rebuild refusal banner (the editor itself, not a queue error). */
export function rebuildRefusalSelector() {
  return '[data-testid="rebuild-refusal"]';
}

/** The table editor's Stage button. */
export function tableFormStageSelector() {
  return '[data-testid="table-form-stage"]';
}

/** Every "Remove column" control in the editor, in column order. */
export function removeColumnSelector() {
  return '[aria-label="Remove column"]';
}

/**
 * Wording any refusal must carry for the demo's rich table: the blocker names
 * come from the backend guard, so the assertion accepts the ones a rebuild of
 * `order_items` would drop rather than pinning one exact sentence. `index` is
 * the singular phrasing ("index \"idx_…\" uses column …").
 */
export const REBUILD_REFUSAL_WORDS = ["CHECK", "FOREIGN KEY", "UNIQUE", "index", "indexes"];
