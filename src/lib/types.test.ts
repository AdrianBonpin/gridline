import { describe, it, expect } from "vitest";
import type {
  Connection,
  ConnectionInput,
  ActiveView,
  TableInfo,
  ColumnInfo,
  QueryResult,
  ChangeItem,
  ChangeItemType,
  ChangeStatus,
  DbViewerTab,
  ConnectionTestResult,
  SchemaGraph,
  TableNode,
  GraphColumn,
  Relationship,
  Settings,
} from "./types";

describe("ActiveView", () => {
  it("includes db-viewer", () => {
    const view: ActiveView = "db-viewer";
    expect(view).toBe("db-viewer");
  });
});

describe("Connection", () => {
  it("accepts new SSH/SSL fields", () => {
    const conn: Connection = {
      id: "c1",
      name: "Test",
      db_type: "postgresql",
      host: "localhost",
      port: 5432,
      username: "admin",
      folder_id: null,
      keychain_ref: null,
      tag_ids: [],
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      // new SSH/SSL fields
      database: "mydb",
      ssh_host: "bastion.example.com",
      ssh_port: 22,
      ssh_user: "tunnel",
      ssh_auth_method: "key",
      ssh_private_key_path: "/home/user/.ssh/id_rsa",
      ssl_mode: "require",
      ssl_ca_path: "/etc/ssl/certs/ca.pem",
      ssl_cert_path: "/etc/ssl/certs/client.crt",
      ssl_key_path: "/etc/ssl/certs/client.key",
    };
    expect(conn.ssh_host).toBe("bastion.example.com");
    expect(conn.database).toBe("mydb");
    expect(conn.ssl_mode).toBe("require");
  });

  it("does not include sensitive SSH/SSL fields (password/ssh_passphrase)", () => {
    // TypeScript compile check: these should not be assignable
    const conn: Connection = {
      id: "c2",
      name: "Minimal",
      db_type: "postgresql",
      host: "localhost",
      port: null,
      username: null,
      folder_id: null,
      keychain_ref: null,
      tag_ids: [],
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    // @ts-expect-error - password must NOT exist on Connection
    conn.password;
    // @ts-expect-error - ssh_passphrase must NOT exist on Connection
    conn.ssh_passphrase;
    expect(conn.host).toBe("localhost");
  });

  it("accepts SSH fields as optional (minimal connection)", () => {
    const conn: Connection = {
      id: "c3",
      name: "Minimal",
      db_type: "postgresql",
      host: "localhost",
      port: null,
      username: null,
      folder_id: null,
      keychain_ref: null,
      tag_ids: [],
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    expect(conn.ssh_host).toBeUndefined();
    expect(conn.database).toBeUndefined();
  });
});

describe("ConnectionInput", () => {
  it("accepts ssh_password", () => {
    const input: ConnectionInput = {
      name: "x", db_type: "postgresql", host: "h", port: 5432, ssh_password: "ssh-pw",
    };
    expect(input.ssh_password).toBe("ssh-pw");
  });

  it("accepts all SSH/SSL fields", () => {
    const input: ConnectionInput = {
      name: "Test",
      db_type: "postgresql",
      host: "localhost",
      port: 5432,
      ssh_host: "bastion.example.com",
      ssh_port: 22,
      ssh_user: "tunnel",
      ssh_auth_method: "key",
      ssh_private_key_path: "/home/user/.ssh/id_rsa",
      ssh_passphrase: "s3cret",
      ssl_mode: "verify-full",
      ssl_ca_path: "/etc/ssl/certs/ca.pem",
      ssl_cert_path: "/etc/ssl/certs/client.crt",
      ssl_key_path: "/etc/ssl/certs/client.key",
      password: "dbpass",
      database: "mydb",
    };
    expect(input.ssh_auth_method).toBe("key");
    expect(input.ssl_mode).toBe("verify-full");
    expect(input.ssh_passphrase).toBe("s3cret");
    expect(input.database).toBe("mydb");
  });

  it("accepts password auth method", () => {
    const input: ConnectionInput = {
      name: "PW SSH",
      db_type: "postgresql",
      host: "db.example.com",
      port: 5432,
      ssh_host: "gateway.example.com",
      ssh_port: 2222,
      ssh_user: "proxy",
      ssh_auth_method: "password",
    };
    expect(input.ssh_auth_method).toBe("password");
  });

  it("allows all SSH/SSL fields to be omitted", () => {
    const input: ConnectionInput = {
      name: "Simple",
      db_type: "sqlite",
      host: "localhost",
      port: null,
    };
    expect(input.ssh_host).toBeUndefined();
    expect(input.ssl_mode).toBeUndefined();
  });
});

describe("TableInfo", () => {
  it("has the correct shape", () => {
    const table: TableInfo = {
      name: "users",
      schema: "public",
      table_type: "TABLE",
    };
    expect(table.name).toBe("users");
    expect(table.schema).toBe("public");
    expect(table.table_type).toBe("TABLE");
  });

  it("accepts view type", () => {
    const table: TableInfo = { name: "v1", schema: "public", table_type: "VIEW" };
    expect(table.table_type).toBe("VIEW");
  });
});

describe("ColumnInfo", () => {
  it("has the correct shape", () => {
    const col: ColumnInfo = {
      name: "id",
      data_type: "integer",
      is_nullable: false,
      is_pk: true,
      is_fk: false,
      fk_ref: null,
      default_value: null,
    };
    expect(col.name).toBe("id");
    expect(col.is_pk).toBe(true);
  });

  it("supports foreign key references", () => {
    const col: ColumnInfo = {
      name: "user_id",
      data_type: "integer",
      is_nullable: true,
      is_pk: false,
      is_fk: true,
      fk_ref: ["users", "id"],
      default_value: null,
    };
    expect(col.fk_ref?.[0]).toBe("users");
  });
});

describe("QueryResult", () => {
  it("is well-typed with columns and rows", () => {
    const result: QueryResult = {
      columns: [{name:"id",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null},{name:"name",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null},{name:"email",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null}],
      rows: [
        [1, "Alice"],
        [2, "Bob"],
      ],
      total_rows: 2, page: 1, page_size: 50,
      execution_time_ms: 12.5,
    };
    expect(result.columns.length).toBe(3);
    expect(result.total_rows).toBe(2);
    expect(result.execution_time_ms).toBe(12.5);
  });

  it("allows error state", () => {
    const result: QueryResult = {
      columns: [],
      rows: [],
      total_rows: 0, page: 1, page_size: 50,
      error: "Syntax error near FROM",
    };
    expect(result.error).toBe("Syntax error near FROM");
  });

  it("can have null execution_time", () => {
    const result: QueryResult = {
      columns: [{name:"id",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null}],
      rows: [],
      total_rows: 0, page: 1, page_size: 50,
      execution_time_ms: null,
    };
    expect(result.execution_time_ms).toBeNull();
  });
});

describe("ChangeItem", () => {
  it("has a discriminated type", () => {
    const createItem: ChangeItem = {
      type: "create_table",
      sql: "CREATE TABLE users (id INT)",
      status: "pending",
      id: "ch1",
      description: "Create users table",
    };
    expect(createItem.type).toBe("create_table");
    expect(createItem.status).toBe("pending");

    const dropItem: ChangeItem = {
      type: "drop_table",
      sql: "DROP TABLE users",
      status: "applied",
      id: "ch2",
    };
    expect(dropItem.type).toBe("drop_table");
    expect(dropItem.status).toBe("applied");
  });

  it("accepts error status with error message", () => {
    const item: ChangeItem = {
      type: "alter_table",
      sql: "ALTER TABLE users ADD COLUMN age INT",
      status: "error",
      error: "Column already exists",
      id: "ch3",
    };
    expect(item.status).toBe("error");
    expect(item.error).toBe("Column already exists");
  });

  it("accepts all ChangeItemType values", () => {
    const types: ChangeItemType[] = [
      "create_table",
      "alter_table",
      "drop_table",
      "insert",
      "update",
      "delete",
      "create_index",
      "drop_index",
    ];
    const item: ChangeItem = {
      type: types[0],
      sql: "test",
      status: "pending",
      id: "ch4",
    };
    expect(types).toContain(item.type);
  });
});

describe("ChangeStatus", () => {
  it("accepts all status values", () => {
    const statuses: ChangeStatus[] = ["pending", "applied", "error"];
    expect(statuses).toHaveLength(3);
  });
});

describe("DbViewerTab", () => {
  it("can be created with required fields", () => {
    const tab: DbViewerTab = {
      id: "tab1",
      connection_id: "c1",
      title: "Query 1",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    expect(tab.title).toBe("Query 1");
    expect(tab.query).toBeUndefined();
    expect(tab.result).toBeUndefined();
    expect(tab.changes).toBeUndefined();
  });

  it("can include query and result", () => {
    const tab: DbViewerTab = {
      id: "tab2",
      connection_id: "c1",
      title: "SELECT * FROM users",
      query: "SELECT * FROM users",
      result: {
        columns: [{name:"id",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null},{name:"name",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null}],
        rows: [],
        total_rows: 0, page: 1, page_size: 50,
      },
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    expect(tab.query).toBe("SELECT * FROM users");
    expect(tab.result?.total_rows).toBe(0);
  });

  it("can include changes array", () => {
    const tab: DbViewerTab = {
      id: "tab3",
      connection_id: "c1",
      title: "Migration",
      changes: [
        { type: "create_table", sql: "CREATE TABLE t (id INT)", status: "pending", id: "ch1" },
      ],
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    expect(tab.changes).toHaveLength(1);
    expect(tab.changes![0].type).toBe("create_table");
  });
});

describe("ConnectionTestResult", () => {
  it("can represent a successful test", () => {
    const result: ConnectionTestResult = {
      ok: true,
      server_version: "16.2",
      latency_ms: 5,
    };
    expect(result.ok).toBe(true);
    expect(result.server_version).toBe("16.2");
  });

  it("can represent a failed test with error", () => {
    const result: ConnectionTestResult = {
      ok: false,
      error: "Connection refused",
    };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Connection refused");
  });
});

describe("Schema graph types", () => {
  it("GraphColumn has correct shape", () => {
    const col: GraphColumn = {
      name: "user_id",
      data_type: "integer",
      is_pk: false,
      is_fk: true,
      is_unique: false,
      is_nullable: false,
      fk_ref: ["public", "users", "id"],
    };
    expect(col.name).toBe("user_id");
    expect(col.is_fk).toBe(true);
    expect(col.fk_ref).toEqual(["public", "users", "id"]);
  });

  it("TableNode has correct shape", () => {
    const node: TableNode = {
      name: "orders",
      schema: "public",
      table_type: "TABLE",
      columns: [
        { name: "id", data_type: "integer", is_pk: true, is_fk: false, is_unique: true, is_nullable: false, fk_ref: null },
        { name: "user_id", data_type: "integer", is_pk: false, is_fk: true, is_unique: false, is_nullable: false, fk_ref: ["public", "users", "id"] },
      ],
    };
    expect(node.name).toBe("orders");
    expect(node.columns).toHaveLength(2);
  });

  it("Relationship has correct shape", () => {
    const rel: Relationship = {
      source_schema: "public",
      source_table: "orders",
      source_column: "user_id",
      target_schema: "public",
      target_table: "users",
      target_column: "id",
      cardinality: "1:N",
    };
    expect(rel.cardinality).toBe("1:N");
  });

  it("SchemaGraph has correct shape", () => {
    const graph: SchemaGraph = {
      tables: [
        { name: "users", schema: "public", table_type: "TABLE", columns: [] },
      ],
      relationships: [],
    };
    expect(graph.tables).toHaveLength(1);
    expect(graph.relationships).toHaveLength(0);
  });

  it("fk_ref can be null for non-FK columns", () => {
    const col: GraphColumn = {
      name: "name",
      data_type: "text",
      is_pk: false,
      is_fk: false,
      is_unique: false,
      is_nullable: true,
      fk_ref: null,
    };
    expect(col.fk_ref).toBeNull();
  });
});

describe("Settings", () => {
  it("includes the five editor option fields", () => {
    const s: Settings = {
      confirm_before_delete: true, default_folder_id: null, theme: "dark",
      font_size: "medium", default_ports: {}, tag_order: null, table_refresh_rate: 0,
      table_page_size: 50, shortcuts: {}, accent_color: "#2563EB",
      editor_font_size: 13, editor_font_family: "Space Mono",
      editor_word_wrap: "off", editor_minimap: false, editor_tab_size: 4,
    };
    expect(s.editor_font_size).toBe(13);
    expect(s.editor_word_wrap).toBe("off");
  });
});