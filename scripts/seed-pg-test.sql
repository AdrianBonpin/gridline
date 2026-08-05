-- Gridline v0.7.5 integration-test seed (idempotent).
-- Target: the FIRST PG test DB (GRIDLINE_TEST_SRC @ :7501), db=postgres.
-- Objects are chosen to satisfy the assertions in src-tauri/src/commands/objects.test.rs:
--   search_objects: 'users' TABLE hit, 'get*' function hit, empty-needle <= 100
--   get_object_ddl: users_id_seq -> CREATE SEQUENCE; audit_log -> CREATE FUNCTION
--   get_object_dependencies: orders -> order_summary VIEW; schema contents non-empty
-- Run with:  psql ... -f scripts/seed-pg-test.sql

BEGIN;

-- 1. users table with serial -> creates users_id_seq in public
DROP VIEW IF EXISTS order_summary CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;
DROP FUNCTION IF EXISTS audit_log(text) CASCADE;
DROP FUNCTION IF EXISTS get_user(bigint) CASCADE;

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO users (email, role) VALUES ('a@example.com', 'admin'), ('b@example.com', 'member');

-- 2. enum type (for enum search + enum DDL)
CREATE TYPE user_role AS ENUM ('admin', 'member', 'guest');

-- 3. products (backup tests assert 3 rows)
CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL
);
INSERT INTO products (name, price) VALUES ('Widget', 9.99), ('Gadget', 19.99), ('Gizmo', 29.99);

-- 4. orders + a dependent VIEW (what-depends-on-this test: dropping orders must surface order_summary)
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    total NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO orders (user_id, total) VALUES (1, 99.50), (2, 12.00), (1, 45.25);

CREATE VIEW order_summary AS
    SELECT u.email, count(o.id) AS order_count, sum(o.total) AS total
    FROM users u LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.email;

-- 4. functions: audit_log (DDL test) + get_user (search 'get' hit)
CREATE FUNCTION audit_log(msg text) RETURNS void AS $$
    SELECT pg_sleep(0);  -- placeholder body so the function is real
$$ LANGUAGE sql;

CREATE FUNCTION get_user(uid bigint) RETURNS TABLE(email text, role text) AS $$
    SELECT u.email, u.role FROM users u WHERE u.id = uid;
$$ LANGUAGE sql STABLE;

COMMIT;

-- Verify
\echo '--- seeded objects ---'
SELECT c.relkind::text || ' ' || c.relname
FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND c.relkind IN ('r','v','S')
ORDER BY 1;
\echo '--- public functions ---'
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' ORDER BY 1;
\echo '--- enums ---'
SELECT t.typname FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'public' AND t.typtype = 'e';