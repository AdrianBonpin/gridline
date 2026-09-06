import { describe, it, expect } from "vitest";
import { buildChangePayload, buildChangeSql } from "./changePayload";
import type { QueueItem } from "../stores/dbViewerStore";

const base = { id: "c1", status: "pending" as const, createdAt: 0 };

describe("buildChangePayload", () => {
  it("insert -> {schema, table, data}", () => {
    const item: QueueItem = { ...base, type: "insert", sql: "", schema: "public", table: "t",
      newData: { a: 1 } } as unknown as QueueItem;
    const p = buildChangePayload(item);
    expect(p).toEqual({ id: "c1", type: "insert", schema: "public", table: "t", data: "{\"a\":1}" });
  });

  it("delete -> {schema, table, primary_key}", () => {
    const item = { ...base, type: "delete", sql: "", schema: "public", table: "t",
      primaryKey: { id: 5 } } as unknown as QueueItem;
    expect(buildChangePayload(item)).toEqual({ id: "c1", type: "delete", schema: "public", table: "t", primary_key: "{\"id\":5}" });
  });

  it("bulk_insert -> {schema, table, columns, rows}", () => {
    const item = { ...base, type: "bulk_insert", sql: "", schema: "public", table: "t",
      columns: ["a", "b"], rows: [[1, 2], [3, 4]] } as unknown as QueueItem;
    expect(buildChangePayload(item)).toEqual({ id: "c1", type: "bulk_insert", schema: "public", table: "t", columns: ["a", "b"], rows: [[1, 2], [3, 4]] });
  });

  it("drop_table -> {schema, table}", () => {
    const item = { ...base, type: "drop_table", sql: "", schema: "public", table: "t" } as unknown as QueueItem;
    expect(buildChangePayload(item)).toEqual({ id: "c1", type: "drop_table", schema: "public", table: "t" });
  });

  it("empty_table -> {schema, table}", () => {
    const item = { ...base, type: "empty_table", sql: "", schema: "public", table: "t" } as unknown as QueueItem;
    expect(buildChangePayload(item)).toEqual({ id: "c1", type: "empty_table", schema: "public", table: "t" });
  });

  it("alter_table -> {schema, table, sql, rollback_sql}", () => {
    const item = { ...base, type: "alter_table", sql: "ALTER TABLE t ADD c int", schema: "public", table: "t" } as unknown as QueueItem;
    expect(buildChangePayload(item)).toEqual({ id: "c1", type: "alter_table", schema: "public", table: "t", sql: "ALTER TABLE t ADD c int", rollback_sql: "" });
  });
});

describe("buildChangeSql", () => {
  it("insert", () => {
    const item = { id: "1", type: "insert", schema: "public", table: "t", newData: { a: 1, b: "x" } } as any;
    expect(buildChangeSql(item)).toBe('INSERT INTO "public"."t" ("a", "b") VALUES (1, \'x\')');
  });
  it("insert with no columns falls back to DEFAULT VALUES", () => {
    const item = { id: "1", type: "insert", schema: "public", table: "t", newData: {} } as any;
    expect(buildChangeSql(item)).toBe('INSERT INTO "public"."t" DEFAULT VALUES');
  });
  it("update", () => {
    const item = { id: "1", type: "update", schema: "public", table: "t", primaryKey: { id: 5 }, newData: { name: "O'Brien" } } as any;
    expect(buildChangeSql(item)).toBe('UPDATE "public"."t" SET "name" = \'O\'\'Brien\' WHERE "id" = 5');
  });
  it("delete", () => {
    const item = { id: "1", type: "delete", schema: "public", table: "t", primaryKey: { id: 5 } } as any;
    expect(buildChangeSql(item)).toBe('DELETE FROM "public"."t" WHERE "id" = 5');
  });
  it("bulk_insert", () => {
    const item = { id: "1", type: "bulk_insert", schema: "public", table: "t", columns: ["a", "b"], rows: [[1, "y"], [2, null]] } as any;
    expect(buildChangeSql(item)).toBe('INSERT INTO "public"."t" ("a", "b") VALUES (1, \'y\'), (2, NULL)');
  });
  it("empty_table / drop_table", () => {
    expect(buildChangeSql({ id: "1", type: "empty_table", schema: "public", table: "t" } as any)).toBe('DELETE FROM "public"."t"');
    expect(buildChangeSql({ id: "1", type: "drop_table", schema: "public", table: "t" } as any)).toBe('DROP TABLE "public"."t"');
  });
});

function rebuildItem(sql: string): QueueItem {
  return {
    id: "ch-rb1", type: "rebuild_table", sql, status: "pending",
    createdAt: 0,
  } as unknown as QueueItem;
}

describe("rebuild_table payload", () => {
  it("builds a rebuild_table payload with the script", () => {
    const p = buildChangePayload(rebuildItem("CREATE TABLE _t();"));
    expect(p).toEqual({ id: "ch-rb1", type: "rebuild_table", sql: "CREATE TABLE _t();" });
  });
  it("buildChangeSql returns the script verbatim", () => {
    expect(buildChangeSql(rebuildItem("SELECT 1;"))).toBe("SELECT 1;");
  });
});

const ddlItem: QueueItem = {
  id: "ch-1", type: "ddl",
  sql: "CREATE TYPE public.role AS ENUM ('admin')",
  status: "pending", createdAt: 0,
};
describe("ddl change", () => {
  it("builds a ddl payload with id + type + sql", () => {
    expect(buildChangePayload(ddlItem)).toEqual({
      id: "ch-1", type: "ddl", sql: "CREATE TYPE public.role AS ENUM ('admin')",
    });
  });
  it("preview SQL is the raw sql", () => {
    expect(buildChangeSql(ddlItem)).toBe("CREATE TYPE public.role AS ENUM ('admin')");
  });
});