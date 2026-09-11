import { describe, it, expect } from "vitest";
import { DB_CAPABILITIES, getCapabilities, type DbCapabilities } from "./dbCapabilities";

describe("dbCapabilities", () => {
  it("gives PostgreSQL every capability", () => {
    const c = DB_CAPABILITIES.postgresql;
    expect(c).toEqual<DbCapabilities>({
      explorer: true, queries: true, objects: true, visualizer: true,
      tools: true, editing: true, import: true, ddl: true, objectCrud: true,
      maintenance: true, roles: true, tableManagement: true,
    });
  });

  it("gives MySQL explorer/queries/editing/import/ddl/tools but not objects/visualizer", () => {
    const c = DB_CAPABILITIES.mysql;
    expect(c.explorer).toBe(true);
    expect(c.queries).toBe(true);
    expect(c.editing).toBe(true);
    expect(c.import).toBe(true);
    expect(c.ddl).toBe(true);
    expect(c.tools).toBe(true);
    expect(c.objects).toBe(false);
    expect(c.visualizer).toBe(false);
  });

  it("gives MariaDB the same capability set as MySQL", () => {
    expect(DB_CAPABILITIES.mariadb).toEqual(DB_CAPABILITIES.mysql);
  });

  it("covers exactly the five DbTypes", () => {
    expect(Object.keys(DB_CAPABILITIES).sort()).toEqual(
      ["mariadb", "mysql", "postgresql", "redis", "sqlite"],
    );
  });

  it("gives SQLite explorer/queries/visualizer/editing/import/ddl/tools/tableManagement but not objects", () => {
    const c = DB_CAPABILITIES.sqlite;
    expect(c.explorer).toBe(true);
    expect(c.queries).toBe(true);
    expect(c.visualizer).toBe(true);
    expect(c.editing).toBe(true);
    expect(c.import).toBe(true);
    expect(c.ddl).toBe(true);
    expect(c.tools).toBe(true);
    expect(c.tableManagement).toBe(true);
    expect(c.objects).toBe(false);
  });

  it("gives Redis nothing (connection+test only)", () => {
    expect(DB_CAPABILITIES.redis).toEqual<DbCapabilities>({
      explorer: false, queries: false, objects: false, visualizer: false,
      tools: false, editing: false, import: false, ddl: false, objectCrud: false,
      maintenance: false, roles: false, tableManagement: false,
    });
  });

  it("getCapabilities returns all-false for an unknown type", () => {
    const c = getCapabilities("postgres" as never);
    expect(Object.values(c).every((v) => v === false)).toBe(true);
  });

  it("getCapabilities returns the matrix entry for known types", () => {
    expect(getCapabilities("postgresql")).toBe(DB_CAPABILITIES.postgresql);
    expect(getCapabilities("redis")).toBe(DB_CAPABILITIES.redis);
  });

  it("objects capability (search/ddl/dependencies) is PG-only", () => {
    expect(getCapabilities("postgresql").objects).toBe(true);
    expect(getCapabilities("mysql").objects).toBe(false);
    expect(getCapabilities("sqlite").objects).toBe(false);
    expect(getCapabilities("redis").objects).toBe(false);
  });
});

describe("objectCrud capability", () => {
  it("is true only for postgresql", () => {
    expect(DB_CAPABILITIES.postgresql.objectCrud).toBe(true);
    expect(DB_CAPABILITIES.mysql.objectCrud).toBe(false);
    expect(DB_CAPABILITIES.sqlite.objectCrud).toBe(false);
    expect(DB_CAPABILITIES.redis.objectCrud).toBe(false);
  });
  it("unknown types get objectCrud false", () => {
    expect(getCapabilities("oracle").objectCrud).toBe(false);
  });
});

describe("v0.7.7 capabilities", () => {
  it("postgresql has maintenance, roles, tableManagement", () => {
    expect(DB_CAPABILITIES.postgresql.maintenance).toBe(true);
    expect(DB_CAPABILITIES.postgresql.roles).toBe(true);
    expect(DB_CAPABILITIES.postgresql.tableManagement).toBe(true);
  });
  it("mysql/sqlite/redis disable maintenance and roles; only sqlite also gets tableManagement", () => {
    for (const t of ["mysql", "sqlite", "redis"] as const) {
      expect(DB_CAPABILITIES[t].maintenance).toBe(false);
      expect(DB_CAPABILITIES[t].roles).toBe(false);
    }
    expect(DB_CAPABILITIES.sqlite.tableManagement).toBe(true);
    expect(DB_CAPABILITIES.mysql.tableManagement).toBe(false);
    expect(DB_CAPABILITIES.redis.tableManagement).toBe(false);
  });
  it("getCapabilities is safe for unknown types", () => {
    expect(getCapabilities("bogus").maintenance).toBe(false);
  });
});

describe("dbCapabilities v0.7.8", () => {
  it("enables tools for mysql and sqlite", () => {
    expect(DB_CAPABILITIES.mysql.tools).toBe(true);
    expect(DB_CAPABILITIES.sqlite.tools).toBe(true);
    expect(DB_CAPABILITIES.postgresql.tools).toBe(true);
  });

  it("enables tableManagement for sqlite", () => {
    expect(DB_CAPABILITIES.sqlite.tableManagement).toBe(true);
    expect(DB_CAPABILITIES.mysql.tableManagement).toBe(false);
  });

  it("still reports editing/import/ddl for mysql and sqlite", () => {
    expect(DB_CAPABILITIES.mysql.editing).toBe(true);
    expect(DB_CAPABILITIES.mysql.import).toBe(true);
    expect(DB_CAPABILITIES.mysql.ddl).toBe(true);
    expect(DB_CAPABILITIES.sqlite.editing).toBe(true);
    expect(DB_CAPABILITIES.sqlite.objects).toBe(false);
  });
});