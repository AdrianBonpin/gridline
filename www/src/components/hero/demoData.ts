// Hardcoded sample data for the interactive DB viewer hero mockup.
// No real database — just realistic-looking rows so the grid feels alive.

export interface DemoColumn {
  name: string;
  data_type: string;
  is_pk?: boolean;
  is_fk?: boolean;
  fk_ref?: [string, string];
  is_nullable?: boolean;
}

export interface DemoTable {
  name: string;
  table_type: "TABLE" | "VIEW";
  columns: DemoColumn[];
  rows: unknown[][];
}

export const demoTables: DemoTable[] = [
  {
    name: "users",
    table_type: "TABLE",
    columns: [
      { name: "id", data_type: "int4", is_pk: true },
      { name: "name", data_type: "text" },
      { name: "email", data_type: "text" },
      { name: "role", data_type: "text" },
      { name: "created_at", data_type: "timestamptz" },
      { name: "metadata", data_type: "jsonb" },
    ],
    rows: [
      [1, "Ada Lovelace", "ada@example.com", "admin", "2024-01-15 09:30:00+00", { active: true, plan: "pro" }],
      [2, "Grace Hopper", "grace@example.com", "editor", "2024-02-03 14:12:00+00", { active: true, plan: "free" }],
      [3, "Alan Turing", "alan@example.com", "viewer", "2024-03-22 08:45:00+00", { active: false, plan: "free" }],
      [4, "Katherine Johnson", "katherine@example.com", "editor", "2024-04-10 18:20:00+00", { active: true, plan: "pro" }],
      [5, "Margaret Hamilton", "margaret@example.com", "admin", "2024-05-01 11:05:00+00", { active: true, plan: "enterprise" }],
      [6, "Tim Berners-Lee", "tim@example.com", "viewer", "2024-06-19 16:40:00+00", { active: true, plan: "free" }],
      [7, "Barbara Liskov", "barbara@example.com", "editor", "2024-07-07 10:15:00+00", { active: false, plan: "pro" }],
      [8, "Donald Knuth", "donald@example.com", "viewer", "2024-08-25 13:55:00+00", { active: true, plan: "free" }],
    ],
  },
  {
    name: "orders",
    table_type: "TABLE",
    columns: [
      { name: "id", data_type: "int4", is_pk: true },
      { name: "user_id", data_type: "int4", is_fk: true, fk_ref: ["users", "id"] },
      { name: "total", data_type: "numeric" },
      { name: "status", data_type: "text" },
      { name: "created_at", data_type: "timestamptz" },
    ],
    rows: [
      [1, 1, 129.99, "completed", "2024-05-12 10:00:00+00"],
      [2, 2, 45.5, "pending", "2024-06-01 09:30:00+00"],
      [3, 1, 89.0, "shipped", "2024-06-15 14:20:00+00"],
      [4, 4, 250.0, "completed", "2024-07-02 11:45:00+00"],
      [5, 6, 19.99, "cancelled", "2024-07-20 08:10:00+00"],
      [6, 2, 320.75, "completed", "2024-08-08 17:05:00+00"],
    ],
  },
  {
    name: "products",
    table_type: "TABLE",
    columns: [
      { name: "id", data_type: "int4", is_pk: true },
      { name: "name", data_type: "text" },
      { name: "price", data_type: "numeric" },
      { name: "stock", data_type: "int4" },
      { name: "category_id", data_type: "int4", is_fk: true, fk_ref: ["categories", "id"] },
    ],
    rows: [
      [1, "Wireless Mouse", 29.99, 150, 1],
      [2, "Mechanical Keyboard", 89.0, 42, 1],
      [3, '27" Monitor', 249.99, 18, 3],
      [4, "USB-C Hub", 45.5, 200, 1],
      [5, "Laptop Stand", 39.0, 75, 2],
      [6, "Desk Mat", 24.99, 120, 2],
    ],
  },
  {
    name: "categories",
    table_type: "TABLE",
    columns: [
      { name: "id", data_type: "int4", is_pk: true },
      { name: "name", data_type: "text" },
    ],
    rows: [
      [1, "Accessories"],
      [2, "Furniture"],
      [3, "Electronics"],
    ],
  },
  {
    name: "audit_log",
    table_type: "TABLE",
    columns: [
      { name: "id", data_type: "int4", is_pk: true },
      { name: "action", data_type: "text" },
      { name: "details", data_type: "jsonb" },
      { name: "created_at", data_type: "timestamptz" },
    ],
    rows: [
      [1, "user.login", { ip: "192.168.1.10", device: "macos" }, "2024-08-01 09:00:00+00"],
      [2, "order.created", { order_id: 6, total: 320.75 }, "2024-08-08 17:05:00+00"],
      [3, "user.updated", { user_id: 3, field: "role" }, "2024-08-10 12:30:00+00"],
      [4, "export.run", { format: "csv", rows: 500 }, "2024-08-12 15:45:00+00"],
    ],
  },
  {
    name: "order_summary",
    table_type: "VIEW",
    columns: [
      { name: "user_id", data_type: "int4" },
      { name: "total_orders", data_type: "int8" },
      { name: "total_spent", data_type: "numeric" },
    ],
    rows: [
      [1, 2, 218.99],
      [2, 2, 366.25],
      [4, 1, 250.0],
      [6, 1, 19.99],
    ],
  },
];

// Canned result shown when the user hits "Run Query" in the mockup.
export const cannedQueryResult: { columns: DemoColumn[]; rows: unknown[][] } = {
  columns: [
    { name: "id", data_type: "int4", is_pk: true },
    { name: "name", data_type: "text" },
    { name: "email", data_type: "text" },
    { name: "role", data_type: "text" },
    { name: "created_at", data_type: "timestamptz" },
  ],
  rows: [
    [1, "Ada Lovelace", "ada@example.com", "admin", "2024-01-15 09:30:00+00"],
    [2, "Grace Hopper", "grace@example.com", "editor", "2024-02-03 14:12:00+00"],
    [3, "Alan Turing", "alan@example.com", "viewer", "2024-03-22 08:45:00+00"],
    [4, "Katherine Johnson", "katherine@example.com", "editor", "2024-04-10 18:20:00+00"],
    [5, "Margaret Hamilton", "margaret@example.com", "admin", "2024-05-01 11:05:00+00"],
  ],
};

export const defaultQuery = `SELECT id, name, email, role, created_at
FROM users
ORDER BY created_at DESC
LIMIT 5;`;

export function abbreviateType(t: string): string {
  const map: Record<string, string> = {
    int4: "int4",
    int8: "int8",
    text: "text",
    numeric: "num",
    timestamptz: "ts",
    jsonb: "jsonb",
  };
  return map[t] ?? t;
}

// ─── Queries history (Queries view) ─────────────────────

export interface DemoQuery {
  sql: string;
  ms: number;
  rows: number;
  favorite?: boolean;
}

export const demoQueries: DemoQuery[] = [
  { sql: "SELECT * FROM users WHERE role = 'admin';", ms: 12, rows: 2, favorite: true },
  { sql: "SELECT id, name, price FROM products ORDER BY price DESC;", ms: 8, rows: 6 },
  { sql: "SELECT status, COUNT(*) FROM orders GROUP BY status;", ms: 15, rows: 4 },
  { sql: "SELECT u.name, o.total FROM users u JOIN orders o ON o.user_id = u.id;", ms: 21, rows: 6 },
  { sql: "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 10;", ms: 9, rows: 4, favorite: true },
  { sql: "VACUUM ANALYZE;", ms: 340, rows: 0 },
];

// ─── Objects (Objects view) ─────────────────────────────

export interface DemoObjectItem {
  name: string;
  schema?: string;
  signature?: string;
  detail: { label: string; value: string; mono?: boolean; accent?: boolean }[];
  source?: string;
  labels?: string[];
}

export type ObjectType = "functions" | "triggers" | "sequences" | "enums" | "extensions";

export const demoObjects: Record<ObjectType, DemoObjectItem[]> = {
  functions: [
    {
      name: "get_user_orders",
      schema: "public",
      signature: "(uid int4)",
      detail: [
        { label: "Returns", value: "SETOF orders", mono: true, accent: true },
        { label: "Language", value: "plpgsql" },
        { label: "Kind", value: "Function" },
        { label: "Schema", value: "public", mono: true },
      ],
      source: `CREATE OR REPLACE FUNCTION public.get_user_orders(uid int4)
RETURNS SETOF orders
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT *
    FROM orders
    WHERE user_id = uid
    ORDER BY created_at DESC;
END;
$function$;`,
    },
    {
      name: "total_spent",
      schema: "public",
      signature: "(uid int4)",
      detail: [
        { label: "Returns", value: "numeric", mono: true, accent: true },
        { label: "Language", value: "sql" },
        { label: "Kind", value: "Function" },
        { label: "Schema", value: "public", mono: true },
      ],
      source: `CREATE FUNCTION public.total_spent(uid int4)
RETURNS numeric
LANGUAGE sql
AS $function$
  SELECT COALESCE(SUM(total), 0)
  FROM orders
  WHERE user_id = uid
    AND status <> 'cancelled';
$function$;`,
    },
  ],
  triggers: [
    {
      name: "set_updated_at",
      schema: "public",
      detail: [
        { label: "Table", value: "users", mono: true },
        { label: "Event", value: "UPDATE" },
        { label: "Timing", value: "BEFORE" },
        { label: "Orientation", value: "ROW" },
        { label: "Status", value: "ENABLED" },
      ],
      source: `CREATE TRIGGER set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();`,
    },
  ],
  sequences: [
    { name: "users_id_seq", schema: "public", signature: "users.id", detail: [
      { label: "Current value", value: "8", mono: true, accent: true },
      { label: "Increment", value: "1", mono: true },
      { label: "Start", value: "1", mono: true },
      { label: "Min", value: "1", mono: true },
      { label: "Max", value: "9223372036854775807", mono: true },
      { label: "Cycle", value: "No" },
    ] },
    { name: "orders_id_seq", schema: "public", signature: "orders.id", detail: [
      { label: "Current value", value: "6", mono: true, accent: true },
      { label: "Increment", value: "1", mono: true },
      { label: "Start", value: "1", mono: true },
      { label: "Min", value: "1", mono: true },
      { label: "Max", value: "9223372036854775807", mono: true },
      { label: "Cycle", value: "No" },
    ] },
  ],
  enums: [
    {
      name: "user_role",
      schema: "public",
      labels: ["admin", "editor", "viewer"],
      detail: [],
    },
  ],
  extensions: [
    { name: "pgcrypto", schema: "public", signature: "1.3", detail: [
      { label: "Version", value: "1.3", mono: true, accent: true },
      { label: "Schema", value: "public", mono: true },
      { label: "Comment", value: "cryptographic functions" },
    ] },
    { name: "pg_stat_statements", schema: "public", signature: "1.10", detail: [
      { label: "Version", value: "1.10", mono: true, accent: true },
      { label: "Schema", value: "public", mono: true },
      { label: "Comment", value: "track execution statistics of all SQL statements" },
    ] },
  ],
};

export const objectTypeLabels: Record<ObjectType, string> = {
  functions: "Functions",
  triggers: "Triggers",
  sequences: "Sequences",
  enums: "Enums",
  extensions: "Extensions",
};
