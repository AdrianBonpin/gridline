PRAGMA user_version = 3;

-- ═══════════════════════════════════════════════════════════════════════
-- Gridline Demo (SQLite) — realistic e-commerce dataset
--
-- Designed to exercise every SQLite-aware Gridline feature:
--   • PK/FK/composite-PK/self-FK metadata
--   • JSON cells + JSON popover
--   • BLOBs
--   • CHECK / UNIQUE constraints, defaults
--   • indexes
--   • views
--   • an empty table (Empty Table change demo)
--   • a no-PK table (rowid row-locator editing)
--   • a TEXT primary key
--   • a 500-row table for pagination / virtualization / filtering
--   • nullable columns, long text, smart-sort tiers
-- ═══════════════════════════════════════════════════════════════════════

-- ── Core: users ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','moderator','customer','guest')),
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
    rating REAL CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
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
    state TEXT,
    zip TEXT,
    country TEXT NOT NULL DEFAULT 'USA',
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Core: orders (FKs -> users and addresses; CHECK status) ─────────────
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    shipping_address_id INTEGER REFERENCES addresses(id),
    total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','shipped','delivered','completed','cancelled','refunded')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    shipped_at TEXT
);

-- ── Core: order_items (composite PRIMARY KEY; CHECK) ───────────────────
CREATE TABLE IF NOT EXISTS order_items (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price REAL NOT NULL,
    PRIMARY KEY (order_id, product_id)
);

-- ── Big table for pagination / virtualization / filtering (500 rows) ──
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

-- ── Non-integer (TEXT) primary key ─────────────────────────────────────
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
        CHECK (status IN ('draft','active','paused','completed','cancelled'))
);

-- ── Read-only view for the query editor / ER diagram ───────────────────
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
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at ON page_views(viewed_at);

-- ═══════════════════════════════════════════════════════════════════════
-- Seed data
-- ═══════════════════════════════════════════════════════════════════════

-- ── Categories ──────────────────────────────────────────────────────────
INSERT OR IGNORE INTO categories (id, name, parent_id, slug, sort_order, description, created_at) VALUES
(1, 'Electronics', NULL, 'electronics', 1, 'Computers, phones, and peripherals.', datetime('now','-400 days')),
(2, 'Accessories', NULL, 'accessories', 2, 'Cables, cases, hubs, and add-ons.', datetime('now','-400 days')),
(3, 'Office', NULL, 'office', 3, 'Furniture, lighting, and desk essentials.', datetime('now','-400 days')),
(4, 'Furniture', NULL, 'furniture', 4, 'Chairs, desks, shelves, and storage.', datetime('now','-380 days')),
(5, 'Keyboards', 1, 'keyboards', 1, 'Mechanical and membrane keyboards.', datetime('now','-300 days')),
(6, 'Monitors', 1, 'monitors', 2, 'External displays and monitor arms.', datetime('now','-300 days'));

-- ── Users: a realistic mix of admins, moderators, customers, and guests ───
INSERT OR IGNORE INTO users (id, name, email, role, phone, birth_date, bio, preferences, balance, is_active, last_login_at, created_at, updated_at) VALUES
(1, 'Sarah Chen', 'sarah.chen@acme.dev', 'admin', '+1-415-555-0101', '1990-04-12',
 'Founding engineer at Acme Dev. Manages the catalog, reviews flagged orders, and keeps the demo data looking sharp.',
 '{"theme":"dark","notifications":{"email":true,"push":true},"locale":"en-US","timezone":"America/Los_Angeles"}',
 1240.75, 1, datetime('now','-35 minutes'), datetime('now','-540 days'), datetime('now','-35 minutes')),
(2, 'Marcus Johnson', 'marcus.j@pixelforge.studio', 'moderator', '+1-512-555-0192', '1985-11-30',
 'Customer-success lead and part-time photographer. Moderates reviews, handles refunds, and tracks the weekly audit log.',
 '{"theme":"system","notifications":{"email":true,"push":false},"locale":"en-GB","timezone":"America/Chicago"}',
 48.20, 1, datetime('now','-6 hours'), datetime('now','-510 days'), datetime('now','-6 hours')),
(3, 'Emily Rodriguez', 'emily.r@techbloom.io', 'customer', '+1-206-555-0143', '1993-07-19',
 'Remote frontend developer based in Seattle. Buys desk accessories in bulk and leaves detailed product reviews.',
 '{"theme":"light","notifications":{"email":true,"push":true},"locale":"en-US","timezone":"America/Los_Angeles"}',
 315.50, 1, datetime('now','-2 days'), datetime('now','-480 days'), datetime('now','-2 days')),
(4, 'David Kim', 'david.kim@outlook.com', 'customer', '+1-212-555-0178', '1988-03-04',
 'Freelance sound engineer in New York. Orders AV gear and cables regularly for his home studio.',
 '{"theme":"dark","notifications":{"email":false,"push":true},"locale":"ko-KR","timezone":"America/New_York"}',
 0.00, 1, datetime('now','-4 days'), datetime('now','-450 days'), datetime('now','-4 days')),
(5, 'Aisha Patel', 'aisha.patel@horizonlabs.co', 'customer', '+1-303-555-0165', '1996-02-08',
 'Data analyst and ergonomic-chair evangelist. Currently outfitting a standing-desk setup for her team.',
 '{"theme":"dark","notifications":{"email":true,"push":false},"locale":"en-US","timezone":"America/Denver"}',
 892.10, 1, datetime('now','-12 hours'), datetime('now','-420 days'), datetime('now','-12 hours')),
(6, 'James O’Brien', 'james.obrien@fastmail.com', 'customer', '+1-617-555-0134', '1991-09-23',
 'DevOps contractor. Bought a monitor arm and never looked back. Always asks for gift receipts.',
 NULL,
 67.99, 1, datetime('now','-1 day'), datetime('now','-390 days'), datetime('now','-1 day')),
(7, 'Yuki Tanaka', 'yuki.tanaka@me.com', 'customer', '+1-650-555-0189', '1994-05-17',
 'Product designer at a fintech startup. Switches between light and dark mode depending on the weather.',
 '{"theme":"system","notifications":{"email":true,"push":true},"locale":"ja-JP","timezone":"America/Los_Angeles"}',
 150.00, 0, datetime('now','-28 days'), datetime('now','-360 days'), datetime('now','-28 days')),
(8, 'Olivia Müller', 'olivia.mueller@werkstatt.de', 'customer', '+49-30-555-0921', '1987-12-01',
 'Berlin-based architect. Orders office lamps and cable organizers for her co-working space.',
 '{"theme":"light","notifications":{"email":true,"push":false},"locale":"de-DE","timezone":"Europe/Berlin"}',
 540.30, 1, datetime('now','-5 days'), datetime('now','-330 days'), datetime('now','-5 days')),
(9, 'Carlos Rivera', 'carlos.rivera@openmail.net', 'customer', '+1-305-555-0156', '1992-08-30',
 'Miami-based content creator. Replaced his entire streaming setup through the store last quarter.',
 '{"theme":"dark","notifications":{"email":false,"push":false},"locale":"es-MX","timezone":"America/New_York"}',
 28.50, 1, datetime('now','-3 hours'), datetime('now','-300 days'), datetime('now','-3 hours')),
(10, 'Priya Sharma', 'priya.sharma@nimbus.team', 'customer', '+1-408-555-0127', '1995-01-14',
 'Engineering manager at Nimbus. Buys team gear in batches and expects invoices by email.',
 '{"theme":"dark","notifications":{"email":true,"push":true},"locale":"en-IN","timezone":"America/Los_Angeles"}',
 2100.00, 1, datetime('now','-50 minutes'), datetime('now','-270 days'), datetime('now','-50 minutes')),
(11, 'Liam Thompson', 'liam.t@rivermail.com', 'guest', NULL, '1999-06-05',
 'University student window-shopping for a first mechanical keyboard. Has not completed a purchase yet.',
 '{"theme":"system","notifications":{"email":false,"push":false},"locale":"en-US","timezone":"America/New_York"}',
 0.00, 1, datetime('now','-7 days'), datetime('now','-240 days'), datetime('now','-7 days')),
(12, 'Sofia Andersen', 'sofia.andersen@nordic.design', 'customer', '+46-8-555-0733', '1989-10-28',
 'Scandinavian design consultant. Values minimal packaging and fast, trackable shipping.',
 '{"theme":"light","notifications":{"email":true,"push":false},"locale":"sv-SE","timezone":"Europe/Stockholm"}',
 175.80, 1, datetime('now','-10 hours'), datetime('now','-210 days'), datetime('now','-10 hours')),
(13, 'Benjamin Wright', 'ben.wright@compose.ly', 'customer', '+1-503-555-0198', '1993-04-11',
 'Music producer and software tinkerer. Always adds a USB-C cable to every order just in case.',
 '{"theme":"dark","notifications":{"email":true,"push":true},"locale":"en-US","timezone":"America/Los_Angeles"}',
 430.25, 1, datetime('now','-18 hours'), datetime('now','-180 days'), datetime('now','-18 hours')),
(14, 'Hannah Lee', 'hannah.lee@cloudscale.io', 'admin', '+1-206-555-0204', '1990-07-22',
 'Platform reliability lead. Monitors the audit log and keeps the demo app settings up to date.',
 '{"theme":"dark","notifications":{"email":true,"push":true},"locale":"en-US","timezone":"America/Los_Angeles"}',
 3500.00, 1, datetime('now','-15 minutes'), datetime('now','-150 days'), datetime('now','-15 minutes')),
(15, 'Noah Fischer', 'noah.fischer@bytehaus.at', 'customer', '+43-1-555-0817', '1997-03-15',
 'Vienna-based indie game dev. Needs low-latency peripherals and a quiet mechanical keyboard.',
 '{"theme":"system","notifications":{"email":false,"push":true},"locale":"de-AT","timezone":"Europe/Vienna"}',
 95.00, 1, datetime('now','-2 days'), datetime('now','-120 days'), datetime('now','-2 days')),
(16, 'Grace Okafor', 'grace.okafor@lift.ng', 'customer', '+234-1-555-0294', '1986-11-09',
 'Remote team lead in Lagos. Orders standing desks and monitor arms for distributed teammates.',
 '{"theme":"dark","notifications":{"email":true,"push":false},"locale":"en-NG","timezone":"Africa/Lagos"}',
 1280.00, 1, datetime('now','-9 hours'), datetime('now','-90 days'), datetime('now','-9 hours')),
(17, 'Ethan Brooks', 'ethan.brooks@nullsecurity.dev', 'customer', '+1-720-555-0112', '1994-12-30',
 'Security researcher with a dry sense of humor. Tests the demo with suspiciously long JSON blobs.',
 '{"theme":"dark","notifications":{"email":false,"push":false},"locale":"en-US","timezone":"America/Denver"}',
 12.49, 1, datetime('now','-5 days'), datetime('now','-60 days'), datetime('now','-5 days')),
(18, 'Mia Rossi', 'mia.rossi@artigiano.it', 'customer', '+39-02-555-0366', '1991-05-03',
 'Graphic designer from Milan. Cares a lot about color-accurate monitors and clean desk lighting.',
 '{"theme":"light","notifications":{"email":true,"push":true},"locale":"it-IT","timezone":"Europe/Rome"}',
 725.60, 1, datetime('now','-1 day'), datetime('now','-30 days'), datetime('now','-1 day')),
(19, 'Alexander Petrov', 'alex.petrov@polycode.ru', 'customer', '+7-495-555-0412', '1984-08-18',
 'Backend engineer in Moscow. Maintains a home lab and buys networking accessories in pairs.',
 '{"theme":"system","notifications":{"email":true,"push":false},"locale":"ru-RU","timezone":"Europe/Moscow"}',
 199.00, 0, datetime('now','-45 days'), datetime('now','-15 days'), datetime('now','-45 days')),
(20, 'Zoe Williams', 'zoe.williams@greenleaf.org', 'moderator', '+1-510-555-0285', '1992-02-25',
 'Sustainability coordinator. Reviews product descriptions and pushes for paperless invoices.',
 '{"theme":"light","notifications":{"email":true,"push":false},"locale":"en-US","timezone":"America/Los_Angeles"}',
 88.00, 1, datetime('now','-6 hours'), datetime('now','-7 days'), datetime('now','-6 hours'));

-- ── Products: realistic SKUs, descriptions, and attributes ──────────────
INSERT OR IGNORE INTO products (id, sku, name, description, price, category_id, stock, rating, discontinued, attributes, created_at, updated_at) VALUES
(1, 'GL-MSE-001', 'Gridline Wireless Mouse', 'Ergonomic wireless mouse with silent switches, 2.4 GHz and Bluetooth 5.0, adjustable 800-1600 DPI, and a 12-month battery life.', 34.99, 1, 142, 4.6, 0, '{"color":"Graphite","wireless":true,"dpi_max":1600,"buttons":5}', datetime('now','-360 days'), datetime('now','-3 days')),
(2, 'GL-KBD-001', 'Gridline Mechanical Keyboard', 'Hot-swappable TKL board with tactile brown switches, per-key RGB, PBT keycaps, and a USB-C braided cable.', 119.99, 5, 68, 4.8, 0, '{"layout":"US ANSI","switches":"brown","backlit":true,"connection":"wired"}', datetime('now','-350 days'), datetime('now','-5 days')),
(3, 'GL-HUB-001', 'Gridline 7-in-1 USB-C Hub', 'Aluminium hub with 4K HDMI, 100 W power delivery, two USB-A 3.2 ports, SD/microSD slots, and a braided cable.', 44.99, 2, 215, 4.4, 0, '{"ports":7,"hdmi":"4K60","power_delivery":"100W","material":"aluminium"}', datetime('now','-340 days'), datetime('now','-2 days')),
(4, 'GL-MON-001', 'Gridline 27" 4K USB-C Monitor', '27-inch IPS panel, 3840×2160, 60 Hz, 99% sRGB, USB-C upstream with 90 W charging, fully adjustable stand.', 499.99, 6, 28, 4.7, 0, '{"resolution":"3840x2160","refresh_hz":60,"panel":"IPS","usb_c_power":90}', datetime('now','-330 days'), datetime('now','-8 days')),
(5, 'GL-STD-001', 'Gridline Aluminium Laptop Stand', 'Foldable aluminium stand with six height positions, ventilated design and silicone pads. Fits 12-16 inch laptops.', 54.99, 2, 108, 4.2, 0, '{"color":"Silver","max_height_mm":280,"foldable":true}', datetime('now','-320 days'), datetime('now','-10 days')),
(6, 'GL-CAM-001', 'Gridline 1080p Webcam', 'Full HD webcam with privacy shutter, dual noise-reducing mics, autofocus, and plug-and-play compatibility.', 69.99, 1, 0, 4.1, 1, '{"resolution":"1920x1080","fps":30,"microphone":true,"autofocus":true}', datetime('now','-310 days'), datetime('now','-60 days')),
(7, 'GL-LMP-001', 'Gridline LED Desk Lamp', 'Dimmable LED lamp with 2700-6500 K colour temperature, flexible neck, and a built-in USB-A charging port.', 42.99, 3, 134, 4.5, 0, '{"color_temp_k":"2700-6500","dimmable":true,"usb_port":true}', datetime('now','-300 days'), datetime('now','-6 days')),
(8, 'GL-CHR-001', 'Gridline Ergonomic Mesh Chair', 'Breathable mesh back, adjustable lumbar support, 4D armrests, and a gas lift rated up to 150 kg.', 649.99, 4, 12, 4.7, 0, '{"material":"mesh","lumbar_support":true,"max_weight_kg":150}', datetime('now','-290 days'), datetime('now','-15 days')),
(9, 'GL-CBL-001', 'Gridline Braided USB-C Cable 2 m', 'Braided USB-C to USB-C cable rated for 100 W charging and USB 3.2 data. Tested to 10,000 bends.', 16.99, 2, 480, 4.3, 0, '{"length_m":2,"charging_w":100,"data_speed":"USB 3.2","color":"Midnight"}', datetime('now','-280 days'), datetime('now','-4 days')),
(10, 'GL-ARM-001', 'Gridline Single Monitor Arm', 'Gas-spring monitor arm with 75/100 mm VESA, 360° rotation, and cable management. Supports up to 9 kg.', 89.99, 6, 36, 4.5, 0, '{"weight_capacity_kg":9,"vesa":"75/100","rotation":"360"}', datetime('now','-270 days'), datetime('now','-9 days')),
(11, 'GL-MSE-002', 'Gridline Pro Wireless Mouse', 'Premium wireless mouse with 4000 DPI sensor, USB-C rechargeable battery, and magnetic storage case.', 79.99, 1, 64, 4.7, 0, '{"color":"Pearl","wireless":true,"dpi_max":4000,"rechargeable":true}', datetime('now','-260 days'), datetime('now','-7 days')),
(12, 'GL-KBD-002', 'Gridline Compact Keyboard', '65% low-profile mechanical keyboard with red linear switches, white backlight, and Bluetooth/wired dual mode.', 94.99, 5, 91, 4.4, 0, '{"layout":"65%","switches":"red linear","backlit":true,"wireless":true}', datetime('now','-250 days'), datetime('now','-6 days')),
(13, 'GL-HUB-002', 'Gridline 10-in-1 Docking Station', 'Thunderbolt-compatible dock with dual 4K display support, 2.5 GbE, and 140 W power delivery.', 219.99, 2, 41, 4.6, 0, '{"ports":10,"ethernet":"2.5G","power_delivery":"140W","displays":2}', datetime('now','-240 days'), datetime('now','-3 days')),
(14, 'GL-MON-002', 'Gridline 32" Curved Monitor', '32-inch curved VA panel, 2560×1440, 165 Hz refresh rate, HDR400, and adaptive sync.', 429.99, 6, 19, 4.5, 0, '{"resolution":"2560x1440","refresh_hz":165,"panel":"VA","curved":true}', datetime('now','-230 days'), datetime('now','-11 days')),
(15, 'GL-DES-001', 'Gridline Standing Desk Frame', 'Electric sit-stand desk frame with dual motors, memory presets, and a quiet 45 dB lift mechanism.', 549.99, 4, 8, 4.6, 0, '{"width_adjustable":true,"memory_presets":4,"noise_db":45}', datetime('now','-220 days'), datetime('now','-12 days')),
(16, 'GL-KEY-001', 'Gridline Keycap Set', 'PBT dye-sub keycap set with 140 keys, compatible with most ANSI and ISO layouts.', 39.99, 5, 77, 4.3, 0, '{"keys":140,"material":"PBT","profile":"Cherry"}', datetime('now','-210 days'), datetime('now','-5 days')),
(17, 'GL-PAD-001', 'Gridline Desk Mat', 'Oversized felt desk mat with stitched edges and anti-slip base. 900 × 400 mm.', 29.99, 3, 156, 4.4, 0, '{"material":"felt","size_mm":"900x400","anti_slip":true}', datetime('now','-200 days'), datetime('now','-8 days')),
(18, 'GL-MIC-001', 'Gridline USB Microphone', 'Cardioid condenser mic with built-in pop filter, mute button, and 24-bit/96 kHz sampling.', 119.99, 1, 33, 4.5, 0, '{"pattern":"cardioid","sample_rate":"96kHz","bit_depth":24}', datetime('now','-190 days'), datetime('now','-9 days')),
(19, 'GL-LGT-001', 'Gridline Monitor Light Bar', 'Screen-hanging light bar with auto-dimming, warm/cool temperature control, and no glare on the panel.', 59.99, 3, 88, 4.2, 0, '{"mount":"screen_hanging","auto_dim":true,"color_temp_k":"3000-6500"}', datetime('now','-180 days'), datetime('now','-7 days')),
(20, 'GL-CBL-002', 'Gridline Magnetic Cable Trio', 'Set of three braided magnetic cables (USB-C, Lightning, Micro-USB) with one interchangeable tip dock.', 34.99, 2, 203, 4.0, 0, '{"cables":3,"tips":["USB-C","Lightning","Micro-USB"],"magnetic":true}', datetime('now','-170 days'), datetime('now','-6 days')),
(21, 'GL-BAG-001', 'Gridline Tech Pouch', 'Water-resistant tech pouch with elastic loops, mesh pockets, and a cable pass-through.', 44.99, 2, 119, 4.5, 0, '{"water_resistant":true,"compartments":8,"color":"Charcoal"}', datetime('now','-160 days'), datetime('now','-4 days')),
(22, 'GL-SPK-001', 'Gridline Desktop Speakers', 'Pair of powered bookshelf speakers with Bluetooth input, RCA/AUX, and solid wood enclosures.', 149.99, 1, 22, 4.3, 0, '{"pair":true,"inputs":["Bluetooth","RCA","AUX"],"enclosure":"wood"}', datetime('now','-150 days'), datetime('now','-10 days')),
(23, 'GL-TRP-001', 'Gridline Tripod Desk Lamp', 'Minimal tripod desk lamp with touch dimming, USB-C power, and a 360° rotating head.', 49.99, 3, 62, 4.1, 0, '{"base":"tripod","touch_dim":true,"power":"USB-C"}', datetime('now','-140 days'), datetime('now','-8 days')),
(24, 'GL-HDM-001', 'Gridline HDMI 2.1 Cable 1.5 m', 'Certified Ultra High Speed HDMI 2.1 cable supporting 8K@60 Hz and 4K@120 Hz, 48 Gbps.', 24.99, 2, 312, 4.4, 0, '{"length_m":1.5,"hdmi_version":"2.1","bandwidth_gbps":48}', datetime('now','-130 days'), datetime('now','-3 days'));

-- ── Addresses: 1-3 realistic addresses per user ────────────────────────
INSERT OR IGNORE INTO addresses (id, user_id, label, street, city, state, zip, country, is_primary, created_at) VALUES
(1, 1, 'Home', '1234 Mission Street, Apt 42', 'San Francisco', 'CA', '94103', 'USA', 1, datetime('now','-500 days')),
(2, 1, 'Work', '555 Montgomery Street, Floor 8', 'San Francisco', 'CA', '94111', 'USA', 0, datetime('now','-480 days')),
(3, 2, 'Home', '2100 Barton Creek Blvd', 'Austin', 'TX', '78735', 'USA', 1, datetime('now','-490 days')),
(4, 3, 'Home', '4542 11th Avenue NE', 'Seattle', 'WA', '98105', 'USA', 1, datetime('now','-470 days')),
(5, 3, 'Office', '7200 Woodlawn Ave NE', 'Seattle', 'WA', '98115', 'USA', 0, datetime('now','-460 days')),
(6, 4, 'Home', '850 7th Avenue, Apt 12B', 'New York', 'NY', '10019', 'USA', 1, datetime('now','-440 days')),
(7, 5, 'Home', '1600 Glenarm Place', 'Denver', 'CO', '80202', 'USA', 1, datetime('now','-410 days')),
(8, 5, 'Warehouse', '4650 Paris Street', 'Denver', 'CO', '80239', 'USA', 0, datetime('now','-400 days')),
(9, 6, 'Home', '44 Prince Street', 'Boston', 'MA', '02113', 'USA', 1, datetime('now','-380 days')),
(10, 7, 'Home', '1080 Arastradero Road', 'Palo Alto', 'CA', '94304', 'USA', 1, datetime('now','-350 days')),
(11, 8, 'Office', 'Friedrichstraße 123', 'Berlin', 'Berlin', '10117', 'Germany', 1, datetime('now','-320 days')),
(12, 9, 'Home', '1500 Ocean Drive, Apt 805', 'Miami Beach', 'FL', '33139', 'USA', 1, datetime('now','-290 days')),
(13, 10, 'Work', '555 Ellis Street', 'Mountain View', 'CA', '94043', 'USA', 1, datetime('now','-260 days')),
(14, 11, 'Home', '1925 SE Hawthorne Blvd', 'Portland', 'OR', '97214', 'USA', 1, datetime('now','-230 days')),
(15, 12, 'Office', 'Birger Jarlsgatan 58', 'Stockholm', 'Stockholm', '111 45', 'Sweden', 1, datetime('now','-200 days')),
(16, 13, 'Home', '925 W 5th Avenue', 'Chicago', 'IL', '60642', 'USA', 1, datetime('now','-170 days')),
(17, 14, 'Home', '2211 7th Avenue', 'Seattle', 'WA', '98121', 'USA', 1, datetime('now','-140 days')),
(18, 15, 'Home', 'Opernring 5', 'Vienna', 'Vienna', '1010', 'Austria', 1, datetime('now','-110 days')),
(19, 16, 'Home', '12 Ikoyi Crescent', 'Lagos', 'Lagos', '101233', 'Nigeria', 1, datetime('now','-80 days')),
(20, 17, 'Home', '1600 Walnut Street, Unit 300', 'Denver', 'CO', '80202', 'USA', 1, datetime('now','-50 days')),
(21, 18, 'Home', 'Via Tortona 12', 'Milan', 'MI', '20144', 'Italy', 1, datetime('now','-25 days')),
(22, 19, 'Home', 'Ulitsa Bolshaya Dmitrovka 9', 'Moscow', 'Moscow', '125009', 'Russia', 1, datetime('now','-10 days')),
(23, 20, 'Home', '1900 Broadway', 'Oakland', 'CA', '94612', 'USA', 1, datetime('now','-5 days'));

-- ── Files: realistic file attachments with BLOB headers ─────────────────
INSERT OR IGNORE INTO files (id, name, mime_type, content, size_bytes, uploaded_by, uploaded_at) VALUES
(1, 'gridline_logo.png', 'image/png', X'89504E470D0A1A0A0000000D49484452000001000000010008060000005C72A866000000017352474200AECE1CE90000000467414D410000B18F0BFC61050000', 14256, 1, datetime('now','-45 days')),
(2, 'product_photos.zip', 'application/zip', X'504B03040A00000000008B6B2D570000000000000000000000000800000070726F64756374732F504B0102001F000A00000000008B6B2D57000000000000000000000000080000000000000000000000A4810000000070726F64756374732F504B050600000000010001003A0000001A0000000000', 28934, 2, datetime('now','-42 days')),
(3, 'invoice_2026_001.pdf', 'application/pdf', X'255044462D312E340A25E2E3CFD30A342030206F626A0A3C3C202F4C696E656172697A65642031202F4C2031203E3E0A3E3E0A73747265616D0A0A42510A0A656E6473747265616D0A656E646F626A0A', 18432, 10, datetime('now','-38 days')),
(4, 'shipping_labels.pdf', 'application/pdf', X'255044462D312E340A25E2E3CFD30A342030206F626A0A3C3C202F54797065202F436174616C6F67202F50616765732031302020302020520A2F4F75746C696E65732032302020302020520A3E3E0A656E646F626A0A', 12288, 14, datetime('now','-30 days')),
(5, 'user_avatars.jpg', 'image/jpeg', X'FFD8FFE000104A46494600010100000100010000FFDB004300080606070605080707070909080A0C140D0C0B0B0C1912130F14311A1F1F1A1C232D', 8934, 1, datetime('now','-25 days')),
(6, 'q4_inventory.csv', 'text/csv', X'69642C6E616D652C73746F636B2C72657365727665640A312C47726E646C696E6520576972656C657373204D6F7573652C3134322C300A322C47726E646C696E65204D656368616E6963616C204B6579626F6172642C36382C350A', 5632, 14, datetime('now','-18 days')),
(7, 'backup.sql', 'application/sql', X'2D2D20477269646C696E652064656D6F206261636B75700A50524F4752416D757365725F76657273696F6E203D20333B0A435245415445205441424C45204946204E4F542045584953545320757365727320282E2E2E293B', 4096, 14, datetime('now','-7 days')),
(8, 'favicon.ico', 'image/x-icon', X'00000100010010100000000020006804000016000000280000001000000020000000010008', 4286, 1, datetime('now','-3 days'));

-- ── App settings: TEXT primary key ──────────────────────────────────────
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
('site_name', 'Gridline Demo Store', datetime('now','-60 days')),
('maintenance_mode', 'false', datetime('now','-5 days')),
('max_cart_items', '50', datetime('now','-30 days')),
('currency', 'USD', datetime('now','-60 days')),
('default_shipping_country', 'USA', datetime('now','-20 days')),
('support_email', 'support@gridline.dev', datetime('now','-10 days'));

-- ═══════════════════════════════════════════════════════════════════════
-- Generated data: orders, line items, page views, audit log
-- ═══════════════════════════════════════════════════════════════════════

-- 50 realistic orders across the user base with varied statuses and dates.
WITH RECURSIVE order_seq(n) AS (
    SELECT 1 UNION ALL SELECT n + 1 FROM order_seq WHERE n < 50
)
INSERT OR IGNORE INTO orders (id, user_id, shipping_address_id, total, status, notes, created_at, updated_at, shipped_at)
SELECT
    n,
    -- Distribute orders across users 1-18; users 19 (inactive) and 20 (recent) get fewer.
    CASE
        WHEN n <= 35 THEN ((n - 1) % 18) + 1
        WHEN n <= 45 THEN ((n - 1) % 12) + 1
        ELSE ((n - 1) % 8) + 1
    END,
    -- Pick a primary or secondary address for that user if one exists.
    NULL,
    0, -- total recalculated from line items below
    CASE n % 12
        WHEN 0 THEN 'pending'
        WHEN 1 THEN 'processing'
        WHEN 2 THEN 'shipped'
        WHEN 3 THEN 'delivered'
        WHEN 4 THEN 'completed'
        WHEN 5 THEN 'cancelled'
        WHEN 6 THEN 'refunded'
        WHEN 7 THEN 'shipped'
        WHEN 8 THEN 'processing'
        WHEN 9 THEN 'completed'
        WHEN 10 THEN 'pending'
        ELSE 'delivered'
    END,
    CASE n % 8
        WHEN 0 THEN 'Please leave the package at the front desk.'
        WHEN 1 THEN 'Gift wrap, please.'
        WHEN 2 THEN 'Customer requested eco-friendly packaging.'
        WHEN 3 THEN 'Ship after the 15th — office move in progress.'
        WHEN 4 THEN NULL
        WHEN 5 THEN 'Call before delivery.'
        WHEN 6 THEN 'Authority to leave if not home.'
        ELSE NULL
    END,
    datetime('now', printf('-%d days', 60 - (n % 58))),
    datetime('now', printf('-%d days', 58 - (n % 56))),
    CASE WHEN n % 12 IN (2,3,4,7,11) THEN datetime('now', printf('-%d days', 55 - (n % 53))) ELSE NULL END
FROM order_seq;

-- Assign a realistic shipping address to each order from the user's address set.
UPDATE orders SET shipping_address_id = (
    SELECT a.id FROM addresses a
    WHERE a.user_id = orders.user_id
    ORDER BY a.is_primary DESC, a.id
    LIMIT 1
);

-- 100+ order line items: 1-3 products per order.
WITH RECURSIVE line_seq(n) AS (
    SELECT 1 UNION ALL SELECT n + 1 FROM line_seq WHERE n < 105
)
INSERT OR IGNORE INTO order_items (order_id, product_id, quantity, unit_price)
SELECT
    ((n - 1) % 50) + 1,
    ((n - 1) % 24) + 1,
    CASE n % 5 WHEN 0 THEN 3 WHEN 1 THEN 2 ELSE 1 END,
    (SELECT price FROM products WHERE id = ((n - 1) % 24) + 1)
FROM line_seq;

-- Recalculate order totals from line items.
UPDATE orders SET total = (
    SELECT ROUND(SUM(quantity * unit_price), 2)
    FROM order_items
    WHERE order_items.order_id = orders.id
);

-- 100 page views with realistic user agents and URLs.
WITH RECURSIVE pv_seq(n) AS (
    SELECT 1 UNION ALL SELECT n + 1 FROM pv_seq WHERE n < 100
)
INSERT INTO page_views (url, session_id, user_agent, viewed_at)
SELECT
    CASE n % 10
        WHEN 0 THEN '/products'
        WHEN 1 THEN '/products/' || ((n % 24) + 1)
        WHEN 2 THEN '/cart'
        WHEN 3 THEN '/checkout'
        WHEN 4 THEN '/orders'
        WHEN 5 THEN '/settings'
        WHEN 6 THEN '/categories/electronics'
        WHEN 7 THEN '/categories/office'
        WHEN 8 THEN '/search?q=keyboard'
        ELSE '/'
    END,
    'sess-' || printf('%03d', (n % 30) + 1),
    CASE n % 6
        WHEN 0 THEN 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        WHEN 1 THEN 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        WHEN 2 THEN 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
        WHEN 3 THEN 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
        WHEN 4 THEN 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0'
        ELSE 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    END,
    datetime('now', printf('-%d minutes', n * 13))
FROM pv_seq
WHERE NOT EXISTS (SELECT 1 FROM page_views);

-- 500 audit-log rows for pagination / virtualization / filtering demos.
WITH RECURSIVE audit_seq(n) AS (
    SELECT 1 UNION ALL SELECT n + 1 FROM audit_seq WHERE n < 500
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, severity, details, duration_ms, created_at)
SELECT
    CASE WHEN n % 9 = 0 THEN NULL ELSE ((n - 1) % 18) + 1 END,
    CASE n % 8
        WHEN 0 THEN 'login'
        WHEN 1 THEN 'page_view'
        WHEN 2 THEN 'update'
        WHEN 3 THEN 'create'
        WHEN 4 THEN 'delete'
        WHEN 5 THEN 'export'
        WHEN 6 THEN 'refund'
        ELSE 'ship'
    END,
    CASE n % 5
        WHEN 0 THEN 'order'
        WHEN 1 THEN 'product'
        WHEN 2 THEN 'user'
        WHEN 3 THEN 'address'
        ELSE 'report'
    END,
    (n % 50) + 1,
    CASE n % 6
        WHEN 0 THEN 'info'
        WHEN 1 THEN 'info'
        WHEN 2 THEN 'warning'
        WHEN 3 THEN 'error'
        WHEN 4 THEN 'critical'
        ELSE 'warning'
    END,
    CASE WHEN n % 7 = 0 THEN NULL
         ELSE '{"page":"' ||
              CASE n % 4 WHEN 0 THEN '/' WHEN 1 THEN '/products' WHEN 2 THEN '/checkout' ELSE '/orders' END ||
              '","retries":' || (n % 3) || ',"row":' || n || ',"region":"' ||
              CASE n % 5 WHEN 0 THEN 'us-east' WHEN 1 THEN 'us-west' WHEN 2 THEN 'eu-central' WHEN 3 THEN 'ap-south' ELSE 'sa-east' END ||
              '"}'
    END,
    (n * 37) % 2500,
    datetime('now', printf('-%d minutes', n * 7))
FROM audit_seq
WHERE NOT EXISTS (SELECT 1 FROM audit_log);