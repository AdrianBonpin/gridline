use crate::models::ConnectionInput;
use crate::store::Store;
use crate::AppState;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

const DEMO_DB_FILENAME: &str = "demo.db";
const DEMO_CONNECTION_NAME: &str = "Demo (SQLite)";
/// Bump whenever the demo schema or seed data changes so existing demo files
/// are recreated on the next launch. The demo is disposable by design — it
/// should always showcase the current feature set.
const DEMO_SCHEMA_VERSION: i64 = 2;

/// True when the demo file's `PRAGMA user_version` is at or above the current
/// schema version (i.e. the file already carries the full feature set).
fn demo_file_is_current(conn: &Connection) -> Result<bool, String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(version >= DEMO_SCHEMA_VERSION)
}

/// Ensure the demo SQLite file at `path` exists and is seeded with the current
/// schema. Files that predate `DEMO_SCHEMA_VERSION` are recreated so the demo
/// always showcases every feature.
fn ensure_demo_file(path: &Path) -> Result<(), String> {
    let stale = path.exists() && {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        !demo_file_is_current(&conn).unwrap_or(false)
    };
    if stale {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    if !path.exists() {
        let conn =
            Connection::open(path).map_err(|e| format!("Failed to create demo DB: {e}"))?;
        conn.execute_batch(&get_demo_schema())
            .map_err(|e| format!("Failed to seed demo DB: {e}"))?;
    }
    Ok(())
}

/// Build the connection input for the demo SQLite file at `db_path`.
fn demo_connection_input(db_path: &Path) -> ConnectionInput {
    ConnectionInput {
        name: DEMO_CONNECTION_NAME.to_string(),
        db_type: "sqlite".to_string(),
        host: db_path.to_string_lossy().to_string(),
        port: None,
        username: None,
        password: None,
        database: None,
        folder_id: None,
        tag_ids: vec![],
        environment: Some("development".to_string()),
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_auth_method: None,
        ssh_private_key_path: None,
        ssh_password: None,
        ssh_passphrase: None,
        ssl_mode: None,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
    }
}

/// Resolve the demo database file under the app data directory (the same
/// location the startup `ensure_demo_db` flow seeds), creating the directory
/// when needed.
fn demo_db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join(DEMO_DB_FILENAME))
}

/// Register the demo connection unless one already exists.
fn ensure_demo_connection(store: &Mutex<Store>, db_path: &Path) -> Result<(), String> {
    let exists = {
        let s = store.lock().map_err(|e| e.to_string())?;
        s.get_connections()?
            .iter()
            .any(|c| c.name == DEMO_CONNECTION_NAME)
    };
    if exists {
        return Ok(());
    }
    let input = demo_connection_input(db_path);
    let s = store.lock().map_err(|e| e.to_string())?;
    s.create_connection(input)?;
    Ok(())
}

/// Drop any live pool handle for the demo connection so its SQLite file can
/// be deleted and recreated cleanly.
async fn disconnect_demo_pool(state: &tauri::State<'_, AppState>) -> Result<(), String> {
    let demo_id = {
        let s = state.db_store.lock().map_err(|e| e.to_string())?;
        s.get_connections()?
            .iter()
            .find(|c| c.name == DEMO_CONNECTION_NAME)
            .map(|c| c.id.clone())
    };
    if let Some(id) = demo_id {
        let mut pm = state.pool_manager.lock().await;
        pm.remove(&id);
    }
    Ok(())
}

/// Ensure the demo SQLite database exists and a corresponding connection is
/// registered. Safe to call on every app start — it's idempotent, and it
/// upgrades stale demo files to the current schema automatically.
pub fn ensure_demo_db(app_handle: &tauri::AppHandle, store: &Mutex<Store>) -> Result<(), String> {
    let db_path = demo_db_path(app_handle)?;
    ensure_demo_file(&db_path)?;
    ensure_demo_connection(store, &db_path)
}

/// Tauri command to re-add the demo connection from the settings screen.
/// Recreates the demo file when it is missing or stale, then registers the
/// connection (always under the app data directory, matching startup).
#[tauri::command]
pub fn recreate_demo_db(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let db_path = demo_db_path(&app)?;
    ensure_demo_file(&db_path)?;
    ensure_demo_connection(&state.db_store, &db_path)?;
    Ok("Demo database connection re-created.".to_string())
}

/// Tauri command to regenerate the demo database from the settings screen:
/// drops any live pool handle, wipes the current file (including any edits
/// made against it) and re-seeds it with fresh demo data.
#[tauri::command]
pub async fn regenerate_demo_db(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let db_path = demo_db_path(&app)?;
    disconnect_demo_pool(&state).await?;
    if db_path.exists() {
        std::fs::remove_file(&db_path).map_err(|e| e.to_string())?;
    }
    ensure_demo_file(&db_path)?;
    ensure_demo_connection(&state.db_store, &db_path)?;
    Ok("Demo database regenerated with fresh data.".to_string())
}

/// The demo schema + seed data. Validated to exercise every Gridline feature
/// available for SQLite: PK/FK/composite-PK/self-FK metadata, JSON cells,
/// BLOBs, CHECK/UNIQUE constraints, defaults, indexes, views, an empty table,
/// a no-PK table (rowid editing), a TEXT primary key, and a 500-row table for
/// pagination / virtualization / filtering demos.
fn get_demo_schema() -> String {
    r#"
    PRAGMA user_version = 2;

    -- ── Core: users ─────────────────────────────────────────────────────────
    -- Row editing, JSON popover (preferences), nullable cols (phone/birth_date),
    -- long text (bio -> scrolling textarea editor), smart-sort tiers
    -- (updated_at / created_at / last_login_at), UNIQUE (email), defaults.
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'user',
        phone TEXT,
        birth_date TEXT,
        bio TEXT,
        preferences json,
        balance REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Core: categories (self-referencing FK) ──────────────────────────────
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES categories(id),
        slug TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Core: products ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL CHECK (price >= 0),
        category_id INTEGER REFERENCES categories(id),
        stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        rating REAL,
        discontinued INTEGER NOT NULL DEFAULT 0,
        attributes json,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Core: addresses (1:N from users, FK dropdown editor) ────────────────
    CREATE TABLE IF NOT EXISTS addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        label TEXT NOT NULL DEFAULT 'Home',
        street TEXT NOT NULL,
        city TEXT NOT NULL,
        zip TEXT,
        country TEXT NOT NULL DEFAULT 'USA',
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Core: orders (two FKs -> users and addresses; CHECK status) ─────────
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        shipping_address_id INTEGER REFERENCES addresses(id),
        total REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','processing','shipped','delivered','completed','cancelled')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        shipped_at TEXT
    );

    -- ── Core: order_items (composite PRIMARY KEY; CHECK) ────────────────────
    CREATE TABLE IF NOT EXISTS order_items (
        order_id INTEGER NOT NULL REFERENCES orders(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
        unit_price REAL NOT NULL,
        PRIMARY KEY (order_id, product_id)
    );

    -- ── Big table for pagination / virtualization / filtering (500 rows) ────
    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        severity TEXT NOT NULL DEFAULT 'info'
            CHECK (severity IN ('info','warning','error','critical')),
        details json,
        duration_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── BLOB demo ───────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        content BLOB,
        size_bytes INTEGER NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── No primary key on purpose: exercises the rowid row-locator editing ──
    CREATE TABLE IF NOT EXISTS page_views (
        url TEXT NOT NULL,
        session_id TEXT NOT NULL,
        user_agent TEXT,
        viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Non-integer (TEXT) primary key ──────────────────────────────────────
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Deliberately empty: exercises the Empty Table change + empty state ──
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        budget REAL,
        starts_at TEXT,
        ends_at TEXT,
        status TEXT NOT NULL DEFAULT 'draft'
    );

    -- ── Read-only view for the query editor / ER diagram ────────────────────
    CREATE VIEW IF NOT EXISTS order_summary AS
    SELECT
        o.id AS order_id,
        u.name AS customer_name,
        COUNT(oi.product_id) AS item_count,
        o.total AS order_total,
        o.status,
        o.created_at
    FROM orders o
    JOIN users u ON u.id = o.user_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id, u.name, o.total, o.status, o.created_at;

    -- ── Indexes (surface in the copied DDL) ─────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at ON page_views(viewed_at);

    -- ═══════════════════════════════════════════════════════════════════════
    -- Seed data
    -- ═══════════════════════════════════════════════════════════════════════

    INSERT OR IGNORE INTO users (id, name, email, role, phone, birth_date, bio, preferences, balance, is_active, last_login_at, created_at, updated_at) VALUES
    (1, 'Alice Johnson', 'alice@example.com', 'admin', '+1-555-0101', '1990-04-12',
     'Senior platform engineer and the store''s first admin. She manages the catalog, reviews every order before it ships, and keeps the demo data realistic.',
     '{"theme":"dark","notifications":{"email":true,"push":false},"locale":"en-US"}',
     249.50, 1, datetime('now','-2 hours'), datetime('now','-240 days'), datetime('now','-2 hours')),
    (2, 'Bob Smith', 'bob@example.com', 'user', '+1-555-0102', '1985-11-30',
     'Loyal customer since 2021. Prefers mechanical keyboards and 4K displays, and always opts for the extended warranty.',
     '{"theme":"light","notifications":{"email":true,"push":true},"locale":"en-GB"}',
     12.00, 1, datetime('now','-1 day'), datetime('now','-210 days'), datetime('now','-1 day')),
    (3, 'Carol Davis', 'carol@example.com', 'user', NULL, '1998-07-19',
     'Occasional shopper who mostly buys desk accessories for her home office in Seattle.',
     NULL,
     0.00, 1, datetime('now','-6 days'), datetime('now','-180 days'), datetime('now','-6 days')),
    (4, 'Dan Wilson', 'dan@example.com', 'user', '+1-555-0104', NULL,
     'Power user testing the checkout flow. Frequently leaves detailed feedback and files the occasional bug report.',
     '{"theme":"system","notifications":{"email":false,"push":false},"locale":"de-DE"}',
     87.25, 0, datetime('now','-14 days'), datetime('now','-90 days'), datetime('now','-14 days')),
    (5, 'Eve Martinez', 'eve@example.com', 'moderator', '+1-555-0105', '1993-02-08',
     'Moderator and community lead. Approves product reviews, helps with support tickets, and watches the audit log closely.',
     '{"theme":"dark","notifications":{"email":true,"push":true},"locale":"fr-FR"}',
     33.75, 1, datetime('now','-35 minutes'), datetime('now','-45 days'), datetime('now','-35 minutes'));

    INSERT OR IGNORE INTO categories (id, name, parent_id, slug, sort_order, description, created_at) VALUES
    (1, 'Electronics', NULL, 'electronics', 1, 'Gadgets, displays and peripherals.', datetime('now','-300 days')),
    (2, 'Accessories', NULL, 'accessories', 2, 'Cables, hubs and add-ons.', datetime('now','-300 days')),
    (3, 'Office', NULL, 'office', 3, 'Furniture and desk essentials.', datetime('now','-300 days')),
    (4, 'Keyboards', 1, 'keyboards', 1, 'Mechanical and membrane keyboards.', datetime('now','-120 days')),
    (5, 'Monitors', 1, 'monitors', 2, 'Displays from 24 to 32 inches.', datetime('now','-120 days'));

    INSERT OR IGNORE INTO products (id, sku, name, description, price, category_id, stock, rating, discontinued, attributes, created_at, updated_at) VALUES
    (1, 'SKU-WM-001', 'Wireless Mouse',
     'A comfortable ambidextrous wireless mouse with silent click switches, 2.4 GHz dongle and Bluetooth 5.0, a 1600 DPI optical sensor, and a 12-month battery life on a single AA battery.',
     29.99, 1, 150, 4.5, 0, '{"color":"Graphite","wireless":true,"dpi":1600}', datetime('now','-260 days'), datetime('now','-3 days')),
    (2, 'SKU-MK-001', 'Mechanical Keyboard',
     'Hot-swappable tenkeyless board with brown switches, per-key RGB backlighting, PBT double-shot keycaps and a CNC aluminium case. USB-C with a detachable braided cable.',
     89.99, 4, 75, 4.8, 0, '{"layout":"US ANSI","switches":"brown","backlit":true}', datetime('now','-250 days'), datetime('now','-20 days')),
    (3, 'SKU-HUB-001', 'USB-C Hub',
     'Seven-port hub with 4K HDMI, 100 W power delivery passthrough, two USB-A 3.2 ports, SD/microSD slots and an aluminium body that stays cool.',
     34.99, 2, 200, 4.2, 0, '{"ports":"7-in-1","power_delivery":"100W"}', datetime('now','-240 days'), datetime('now','-2 days')),
    (4, 'SKU-MN-001', '27" 4K Monitor',
     '27-inch IPS panel with 3840x2160 resolution, 60 Hz refresh, 99% sRGB coverage, USB-C upstream with 90 W charging and a fully adjustable stand.',
     449.99, 5, 30, 4.6, 0, '{"resolution":"3840x2160","refresh_hz":60,"panel":"IPS"}', datetime('now','-230 days'), datetime('now','-15 days')),
    (5, 'SKU-LS-001', 'Laptop Stand',
     'Foldable aluminium stand with six height positions, ventilated design and soft silicone pads. Fits laptops from 12 to 16 inches.',
     49.99, 2, 100, 3.9, 0, NULL, datetime('now','-220 days'), datetime('now','-40 days')),
    (6, 'SKU-WC-001', 'Webcam 1080p',
     'Full HD webcam with a privacy shutter, dual noise-reducing microphones and autofocus. Works with every major video call app out of the box.',
     59.99, 1, 0, 4.0, 1, '{"resolution":"1920x1080","fps":30,"microphone":true}', datetime('now','-200 days'), datetime('now','-60 days')),
    (7, 'SKU-DL-001', 'Desk Lamp LED',
     'Dimmable LED desk lamp with adjustable colour temperature from 2700 K to 6500 K, a flexible neck and a built-in USB charging port.',
     39.99, 3, 120, 4.3, 0, '{"color_temp":"2700-6500K","dimmable":true}', datetime('now','-190 days'), datetime('now','-9 days')),
    (8, 'SKU-EC-001', 'Ergonomic Chair',
     'Breathable mesh back, adjustable lumbar support, 4D armrests and a gas lift rated for up to 150 kg. Assembles in under twenty minutes.',
     599.99, 3, 15, 4.7, 0, '{"material":"mesh","lumbar_support":true}', datetime('now','-180 days'), datetime('now','-30 days')),
    (9, 'SKU-UC-001', 'USB-C Cable 2m',
     'Braided USB-C to USB-C cable rated for 100 W charging and USB 3.2 data transfer. Tested for 10,000 bends.',
     14.99, 2, 500, 4.1, 0, '{"length_m":2,"charging":"100W"}', datetime('now','-170 days'), datetime('now','-5 days')),
    (10, 'SKU-MA-001', 'Monitor Arm',
     'Single monitor arm with gas spring, 75/100 mm VESA mount, and 360 degree rotation. Supports monitors up to 9 kg.',
     79.99, 3, 40, NULL, 0, '{"weight_capacity_kg":9,"vesa":"75/100"}', datetime('now','-160 days'), datetime('now','-12 days'));

    INSERT OR IGNORE INTO addresses (id, user_id, label, street, city, zip, country, is_primary, created_at) VALUES
    (1, 1, 'Home', '100 Market Street', 'San Francisco', '94105', 'USA', 1, datetime('now','-200 days')),
    (2, 1, 'Work', '200 Mission Street', 'San Francisco', '94105', 'USA', 0, datetime('now','-180 days')),
    (3, 2, 'Home', '300 Lakeshore Drive', 'Austin', '78701', 'USA', 1, datetime('now','-150 days')),
    (4, 3, 'Home', '400 Maple Avenue', 'Seattle', '98101', 'USA', 1, datetime('now','-120 days')),
    (5, 4, 'Home', '500 Park Boulevard', 'New York', '10001', 'USA', 1, datetime('now','-90 days')),
    (6, 5, 'Home', '600 Cedar Lane', 'Denver', '80202', 'USA', 1, datetime('now','-60 days')),
    (7, 3, 'Cabin', '700 Pine Road', 'Bend', '97701', 'USA', 0, datetime('now','-30 days')),
    (8, 5, 'Work', '800 Pearl Street', 'Denver', '80202', 'USA', 0, datetime('now','-7 days'));

    INSERT OR IGNORE INTO orders (id, user_id, shipping_address_id, total, status, notes, created_at, updated_at, shipped_at) VALUES
    (1, 1, 1, 94.97, 'completed', 'Please leave the package at the front desk.', datetime('now','-40 days'), datetime('now','-38 days'), datetime('now','-38 days')),
    (2, 2, 3, 499.98, 'pending', NULL, datetime('now','-3 days'), datetime('now','-2 hours'), NULL),
    (3, 3, 4, 59.99, 'completed', NULL, datetime('now','-20 days'), datetime('now','-19 days'), datetime('now','-19 days')),
    (4, 1, 2, 89.99, 'shipped', 'Gift wrap, please.', datetime('now','-2 days'), datetime('now','-1 day'), datetime('now','-1 day')),
    (5, 4, 5, 689.96, 'processing', NULL, datetime('now','-1 day'), datetime('now','-5 hours'), NULL),
    (6, 5, 6, 74.98, 'cancelled', 'Customer requested cancellation before dispatch.', datetime('now','-5 days'), datetime('now','-4 days'), NULL);

    INSERT OR IGNORE INTO order_items (order_id, product_id, quantity, unit_price) VALUES
    (1, 1, 2, 29.99),
    (1, 3, 1, 34.99),
    (2, 4, 1, 449.99),
    (2, 5, 1, 49.99),
    (3, 6, 1, 59.99),
    (4, 2, 1, 89.99),
    (5, 8, 1, 599.99),
    (5, 1, 3, 29.99),
    (6, 7, 1, 39.99),
    (6, 3, 1, 34.99);

    -- 500 generated rows for pagination / virtualization / filter demos.
    -- Guarded by NOT EXISTS so re-running the schema never duplicates rows.
    WITH RECURSIVE seq(n) AS (
        SELECT 1
        UNION ALL
        SELECT n + 1 FROM seq WHERE n < 500
    )
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, severity, details, duration_ms, created_at)
    SELECT
        CASE WHEN n % 9 = 0 THEN NULL ELSE (n % 5) + 1 END,
        CASE n % 6 WHEN 0 THEN 'login' WHEN 1 THEN 'page_view' WHEN 2 THEN 'update'
                   WHEN 3 THEN 'create' WHEN 4 THEN 'delete' ELSE 'export' END,
        CASE n % 4 WHEN 0 THEN 'order' WHEN 1 THEN 'product' WHEN 2 THEN 'user' ELSE 'report' END,
        (n % 40) + 1,
        CASE n % 5 WHEN 0 THEN 'info' WHEN 1 THEN 'info' WHEN 2 THEN 'warning'
                   WHEN 3 THEN 'error' ELSE 'critical' END,
        CASE WHEN n % 7 = 0 THEN NULL
             ELSE '{"page":"/demo","retries":' || (n % 3) || ',"row":' || n || '}' END,
        (n * 37) % 2000,
        datetime('now', printf('-%d minutes', n * 7))
    FROM seq
    WHERE NOT EXISTS (SELECT 1 FROM audit_log);

    INSERT OR IGNORE INTO files (id, name, mime_type, content, size_bytes, uploaded_by, uploaded_at) VALUES
    (1, 'logo.png', 'image/png', X'89504E470D0A1A0A0000000D49484452', length(X'89504E470D0A1A0A0000000D49484452'), 1, datetime('now','-10 days')),
    (2, 'photo.jpg', 'image/jpeg', X'FFD8FFE000104A464946000101', length(X'FFD8FFE000104A464946000101'), 2, datetime('now','-9 days')),
    (3, 'manual.pdf', 'application/pdf', X'255044462D312E340A25E2E3CFD3', length(X'255044462D312E340A25E2E3CFD3'), NULL, datetime('now','-5 days')),
    (4, 'archive.zip', 'application/zip', NULL, 0, 3, datetime('now','-1 day')),
    (5, 'report.csv', 'text/csv', X'69642C6E616D650A312C616C696365', length(X'69642C6E616D650A312C616C696365'), 1, datetime('now','-4 hours'));

    INSERT INTO page_views (url, session_id, user_agent, viewed_at) SELECT * FROM (
    VALUES
    ('/products', 'sess-001', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0', datetime('now','-23 hours')),
    ('/products/1', 'sess-001', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0', datetime('now','-22 hours')),
    ('/cart', 'sess-002', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit/605.1.15 Safari/604.1', datetime('now','-18 hours')),
    ('/checkout', 'sess-002', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit/605.1.15 Safari/604.1', datetime('now','-18 hours')),
    ('/orders', 'sess-003', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/127.0', datetime('now','-12 hours')),
    ('/products/8', 'sess-004', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/125.0', datetime('now','-8 hours')),
    ('/login', 'sess-004', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/125.0', datetime('now','-8 hours')),
    ('/settings', 'sess-001', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0', datetime('now','-5 hours')),
    ('/categories/electronics', 'sess-005', 'curl/8.4.0', datetime('now','-3 hours')),
    ('/products/4', 'sess-002', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit/605.1.15 Safari/604.1', datetime('now','-2 hours')),
    ('/checkout', 'sess-006', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0', datetime('now','-1 hour')),
    ('/orders', 'sess-002', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit/605.1.15 Safari/604.1', datetime('now','-30 minutes'))
    ) WHERE NOT EXISTS (SELECT 1 FROM page_views);

    INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
    ('site_name', 'Gridline Demo Store', datetime('now','-30 days')),
    ('maintenance_mode', 'false', datetime('now','-2 days')),
    ('max_cart_items', '50', datetime('now','-14 days')),
    ('currency', 'USD', datetime('now','-30 days'));
    "#
    .to_string()
}

#[cfg(test)]
#[path = "demo.test.rs"]
mod tests;