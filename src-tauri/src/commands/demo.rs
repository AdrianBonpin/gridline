use crate::models::ConnectionInput;
use crate::store::Store;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

const DEMO_DB_FILENAME: &str = "demo.db";
const DEMO_CONNECTION_NAME: &str = "Demo (SQLite)";

/// Ensure the demo SQLite database exists and a corresponding connection is
/// registered. Safe to call on every app start — it's idempotent.
pub fn ensure_demo_db(app_handle: &tauri::AppHandle, store: &Mutex<Store>) -> Result<(), String> {
    // Check if the demo connection already exists
    {
        let s = store.lock().map_err(|e| e.to_string())?;
        let existing = s.get_connections()?;
        if existing.iter().any(|c| c.name == DEMO_CONNECTION_NAME) {
            return Ok(()); // already set up
        }
    }

    // Resolve app data directory
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let db_path = data_dir.join(DEMO_DB_FILENAME);

    // Create the demo SQLite file if it doesn't exist
    if !db_path.exists() {
        let conn =
            Connection::open(&db_path).map_err(|e| format!("Failed to create demo DB: {e}"))?;

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                category TEXT NOT NULL,
                stock INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                total REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL REFERENCES orders(id),
                product_id INTEGER NOT NULL REFERENCES products(id),
                quantity INTEGER NOT NULL DEFAULT 1,
                unit_price REAL NOT NULL
            );

            -- Sample users
            INSERT OR IGNORE INTO users (id, name, email, role) VALUES
                (1, 'Alice Johnson', 'alice@example.com', 'admin'),
                (2, 'Bob Smith',     'bob@example.com',   'user'),
                (3, 'Carol Davis',   'carol@example.com', 'user'),
                (4, 'Dan Wilson',    'dan@example.com',   'user'),
                (5, 'Eve Martinez',  'eve@example.com',   'moderator');

            -- Sample products
            INSERT OR IGNORE INTO products (id, name, price, category, stock) VALUES
                (1, 'Wireless Mouse',     29.99, 'Electronics', 150),
                (2, 'Mechanical Keyboard', 89.99, 'Electronics',  75),
                (3, 'USB-C Hub',          34.99, 'Accessories', 200),
                (4, '27\" 4K Monitor',     449.99, 'Electronics',  30),
                (5, 'Laptop Stand',        49.99, 'Accessories', 100),
                (6, 'Webcam 1080p',        59.99, 'Electronics',  60),
                (7, 'Desk Lamp LED',       39.99, 'Office',      120),
                (8, 'Ergonomic Chair',    599.99, 'Office',       15);

            -- Sample orders
            INSERT OR IGNORE INTO orders (id, user_id, total, status) VALUES
                (1, 1, 119.98, 'completed'),
                (2, 2, 484.98, 'pending'),
                (3, 3,  59.99, 'completed'),
                (4, 1,  89.99, 'shipped'),
                (5, 4, 689.98, 'pending');

            -- Sample order items
            INSERT OR IGNORE INTO order_items (order_id, product_id, quantity, unit_price) VALUES
                (1, 1, 2, 29.99),
                (1, 3, 1, 34.99),
                (2, 4, 1, 449.99),
                (2, 5, 1, 49.99),
                (3, 6, 1, 59.99),
                (4, 2, 1, 89.99),
                (5, 8, 1, 599.99),
                (5, 1, 3, 29.99);
            ",
        )
        .map_err(|e| format!("Failed to seed demo DB: {e}"))?;
    }

    // Create the demo connection
    let input = ConnectionInput {
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
        ssh_passphrase: None,
        ssl_mode: None,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
    };

    let s = store.lock().map_err(|e| e.to_string())?;
    s.create_connection(input)?;

    Ok(())
}