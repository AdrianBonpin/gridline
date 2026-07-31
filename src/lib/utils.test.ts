import { describe, it, expect } from "vitest";
import {
  validateConnectionInput,
  validateFolderInput,
  validateTagInput,
  filterConnections,
  getDescendantFolderIds,
  getFolderPathLabel,
  isDestructiveQuery,
} from "./utils";
import type { Connection, Folder, Tag } from "./types";

const makeConnection = (over: Partial<Connection> = {}): Connection => ({
  id: "c1",
  name: "Prod DB",
  db_type: "postgresql",
  host: "prod.example.com",
  port: 5432,
  username: "admin",
  folder_id: null,
  keychain_ref: null,
  tag_ids: [],
  created_at: "2026-07-26T00:00:00Z",
  updated_at: "2026-07-26T00:00:00Z",
  ...over,
});

describe("validateConnectionInput", () => {
  it("accepts a valid postgresql connection", () => {
    const result = validateConnectionInput({
      name: "Prod DB",
      db_type: "postgresql",
      host: "prod.example.com",
      port: 5432,
      username: "admin",
      folder_id: null,
      tag_ids: [],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects empty name", () => {
    const result = validateConnectionInput({
      name: "",
      db_type: "postgresql",
      host: "h",
      port: 5432,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("name");
  });

  it("rejects name longer than 100 chars", () => {
    const result = validateConnectionInput({
      name: "x".repeat(101),
      db_type: "postgresql",
      host: "h",
      port: 5432,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid db_type", () => {
    const result = validateConnectionInput({
      name: "X",
      db_type: "mongodb" as any,
      host: "h",
      port: 5432,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("db_type");
  });

  it("rejects port out of range", () => {
    const result = validateConnectionInput({
      name: "X",
      db_type: "postgresql",
      host: "h",
      port: 99999,
    });
    expect(result.ok).toBe(false);
  });

  it("allows null port for sqlite", () => {
    const result = validateConnectionInput({
      name: "Local",
      db_type: "sqlite",
      host: "/data/analytics.db",
      port: null,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects host longer than 255 chars", () => {
    const result = validateConnectionInput({
      name: "X",
      db_type: "postgresql",
      host: "h".repeat(256),
      port: 5432,
    });
    expect(result.ok).toBe(false);
  });

  describe("SSH/SSL validation", () => {
    it("rejects SSH host longer than 255 chars", () => {
      const result = validateConnectionInput({
        name: "Test",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        ssh_host: "x".repeat(256),
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSH host");
    });

    it("rejects SSH port below 1", () => {
      const result = validateConnectionInput({
        name: "Test",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        ssh_host: "bastion.example.com",
        ssh_port: 0,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSH port");
    });

    it("rejects SSH port above 65535", () => {
      const result = validateConnectionInput({
        name: "Test",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        ssh_host: "bastion.example.com",
        ssh_port: 70000,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSH port");
    });

    it("accepts valid SSH port", () => {
      const result = validateConnectionInput({
        name: "Test",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        ssh_host: "bastion.example.com",
        ssh_port: 2222,
      });
      expect(result.ok).toBe(true);
    });

    it("accepts null SSH port", () => {
      const result = validateConnectionInput({
        name: "Test",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        ssh_host: "bastion.example.com",
        ssh_port: null,
      });
      expect(result.ok).toBe(true);
    });

    it("rejects SSH user longer than 100 chars", () => {
      const result = validateConnectionInput({
        name: "Test",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        ssh_host: "bastion.example.com",
        ssh_user: "u".repeat(101),
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSH user");
    });

    it("rejects invalid ssl_mode", () => {
      const result = validateConnectionInput({
        name: "Test",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        ssl_mode: "invalid" as any,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSL mode");
    });

    it("accepts valid ssl_mode values", () => {
      const validModes = ["disable", "require", "verify-ca", "verify-full"];
      for (const mode of validModes) {
        const result = validateConnectionInput({
          name: "Test",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          ssl_mode: mode as any,
        });
        expect(result.ok).toBe(true);
      }
    });

    it("accepts input without SSH fields", () => {
      const result = validateConnectionInput({
        name: "Test",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
      });
      expect(result.ok).toBe(true);
    });
  });
});

describe("validateFolderInput", () => {
  it("accepts valid folder", () => {
    expect(validateFolderInput({ name: "Work", parent_id: null }).ok).toBe(true);
  });
  it("rejects empty name", () => {
    expect(validateFolderInput({ name: "", parent_id: null }).ok).toBe(false);
  });
  it("rejects name longer than 100 chars", () => {
    expect(validateFolderInput({ name: "x".repeat(101), parent_id: null }).ok).toBe(false);
  });
});

describe("validateTagInput", () => {
  it("accepts valid tag", () => {
    expect(validateTagInput({ name: "production", color: "#ef4444" }).ok).toBe(true);
  });
  it("rejects empty name", () => {
    expect(validateTagInput({ name: "", color: "#ef4444" }).ok).toBe(false);
  });
  it("rejects name longer than 50 chars", () => {
    expect(validateTagInput({ name: "x".repeat(51), color: "#ef4444" }).ok).toBe(false);
  });
});

describe("getDescendantFolderIds", () => {
  const folders: Folder[] = [
    { id: "f1", name: "root", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
    { id: "f2", name: "child", parent_id: "f1", tag_ids: [], created_at: "", updated_at: "" },
    { id: "f3", name: "grandchild", parent_id: "f2", tag_ids: [], created_at: "", updated_at: "" },
    { id: "f4", name: "other", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
  ];
  it("returns all descendant ids including self", () => {
    expect(getDescendantFolderIds(folders, "f1").sort()).toEqual(["f1", "f2", "f3"]);
  });
  it("returns only self for leaf folder", () => {
    expect(getDescendantFolderIds(folders, "f3")).toEqual(["f3"]);
  });
});

describe("filterConnections", () => {
  const tags: Tag[] = [
    { id: "t1", name: "production", color: "#ef4444", created_at: "" },
    { id: "t2", name: "cache", color: "#3b82f6", created_at: "" },
  ];
  const conns: Connection[] = [
    makeConnection({ id: "c1", name: "Prod", host: "prod.example.com", db_type: "postgresql", tag_ids: ["t1"], folder_id: "f1" }),
    makeConnection({ id: "c2", name: "Redis", host: "redis.internal", db_type: "redis", tag_ids: ["t2"], folder_id: "f2" }),
  ];
  it("filters by search query on name", () => {
    expect(filterConnections(conns, tags, { query: "prod" })).toEqual([conns[0]]);
  });
  it("filters by search query on host", () => {
    expect(filterConnections(conns, tags, { query: "redis.internal" })).toEqual([conns[1]]);
  });
  it("search is case-insensitive", () => {
    expect(filterConnections(conns, tags, { query: "PROD" })).toEqual([conns[0]]);
  });
  it("filters by tag id", () => {
    expect(filterConnections(conns, tags, { query: "", activeTagIds: ["t1"] })).toEqual([conns[0]]);
  });
  it("filters by db_type", () => {
    expect(filterConnections(conns, tags, { query: "", activeDbTypes: ["redis"] })).toEqual([conns[1]]);
  });
  it("returns all when no filters", () => {
    expect(filterConnections(conns, tags, { query: "" })).toEqual(conns);
  });
  it("search matches tag name", () => {
    expect(filterConnections(conns, tags, { query: "cache" })).toEqual([conns[1]]);
  });
});

describe("getFolderPathLabel", () => {
  const folders: Folder[] = [
    { id: "a", name: "FolderA", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
    { id: "b", name: "Folder1", parent_id: "a", tag_ids: [], created_at: "", updated_at: "" },
  ];

  it("returns root label for null", () => {
    expect(getFolderPathLabel(folders, null)).toBe("Root");
  });

  it("returns nested path", () => {
    expect(getFolderPathLabel(folders, "b")).toBe("FolderA → Folder1");
  });

  it("returns root label for non-existent folder", () => {
    expect(getFolderPathLabel(folders, "missing")).toBe("Root");
  });
});

describe("isDestructiveQuery", () => {
  it("returns true for INSERT", () => {
    expect(isDestructiveQuery("INSERT INTO users VALUES (1)")).toBe(true);
  });
  it("returns true for UPDATE", () => {
    expect(isDestructiveQuery("UPDATE users SET name = 'x'")).toBe(true);
  });
  it("returns true for DELETE", () => {
    expect(isDestructiveQuery("DELETE FROM users")).toBe(true);
  });
  it("returns true for DROP", () => {
    expect(isDestructiveQuery("DROP TABLE users")).toBe(true);
  });
  it("returns true for ALTER", () => {
    expect(isDestructiveQuery("ALTER TABLE users ADD COLUMN age int")).toBe(true);
  });
  it("returns true for TRUNCATE", () => {
    expect(isDestructiveQuery("TRUNCATE TABLE users")).toBe(true);
  });
  it("returns true for CREATE", () => {
    expect(isDestructiveQuery("CREATE TABLE t (id int)")).toBe(true);
  });
  it("returns true for REPLACE", () => {
    expect(isDestructiveQuery("REPLACE INTO users VALUES (1)")).toBe(true);
  });
  it("returns false for SELECT", () => {
    expect(isDestructiveQuery("SELECT * FROM users")).toBe(false);
  });
  it("returns false for EXPLAIN", () => {
    expect(isDestructiveQuery("EXPLAIN SELECT * FROM users")).toBe(false);
  });
  it("returns false for WITH (CTE SELECT)", () => {
    expect(isDestructiveQuery("WITH cte AS (SELECT 1) SELECT * FROM cte")).toBe(false);
  });
  it("returns false for SHOW", () => {
    expect(isDestructiveQuery("SHOW search_path")).toBe(false);
  });
  it("strips line comments before checking", () => {
    expect(isDestructiveQuery("-- harmless comment\nDROP TABLE users")).toBe(true);
  });
  it("strips block comments before checking", () => {
    expect(isDestructiveQuery("/* harmless */ DROP TABLE users")).toBe(true);
  });
  it("returns false for empty string", () => {
    expect(isDestructiveQuery("")).toBe(false);
  });
  it("returns false for whitespace only", () => {
    expect(isDestructiveQuery("   \n\t  ")).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(isDestructiveQuery("drop table users")).toBe(true);
    expect(isDestructiveQuery("Drop Table users")).toBe(true);
  });
});