import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  buildObjectDdl,
  dropCrudParams,
  getAvailableExtensions,
  initialCrudParams,
} from "./objectCrud";
import type { CrudItem } from "./objectCrud";

describe("buildObjectDdl", () => {
  afterEach(() => vi.restoreAllMocks());

  it("invokes build_object_ddl with connectionId, kind, params", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      "CREATE TYPE public.role AS ENUM ('admin')",
    ]);
    const sql = await buildObjectDdl("c1", "enum", {
      schema: "public",
      name: "role",
      action: { op: "create", labels: ["admin"] },
    });
    expect(invoke).toHaveBeenCalledWith("build_object_ddl", {
      connectionId: "c1",
      kind: "enum",
      params: {
        schema: "public",
        name: "role",
        action: { op: "create", labels: ["admin"] },
      },
    });
    expect(sql).toEqual(["CREATE TYPE public.role AS ENUM ('admin')"]);
  });

  it("passes through drop params for sequences", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['DROP SEQUENCE "public"."s"']);
    const sql = await buildObjectDdl("c1", "sequence", {
      schema: "public",
      name: "s",
      action: { op: "drop" },
    });
    expect(invoke).toHaveBeenCalledWith("build_object_ddl", {
      connectionId: "c1",
      kind: "sequence",
      params: { schema: "public", name: "s", action: { op: "drop" } },
    });
    expect(sql).toEqual(['DROP SEQUENCE "public"."s"']);
  });
});

describe("getAvailableExtensions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("invokes get_available_extensions with connectionId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "pgcrypto", version: "1.3", comment: null },
    ]);
    const exts = await getAvailableExtensions("c1");
    expect(invoke).toHaveBeenCalledWith("get_available_extensions", {
      connectionId: "c1",
    });
    expect(exts).toEqual([{ name: "pgcrypto", version: "1.3", comment: null }]);
  });

  it("returns empty array when no extensions available", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const exts = await getAvailableExtensions("c2");
    expect(exts).toEqual([]);
  });
});

describe("initialCrudParams", () => {
  it("create shape starts empty with sensible defaults", () => {
    const p = initialCrudParams(
      "sequence",
      { schema: "public", name: "" },
      "create",
    );
    expect(p).toEqual({
      schema: "public",
      name: "",
      action: {
        op: "create",
        increment: "1",
        min_value: "1",
        max_value: "9223372036854775807",
        start: "1",
        cycle: false,
      },
    });
  });

  it("edit prefills the name from the item", () => {
    const p = initialCrudParams(
      "sequence",
      { schema: "public", name: "s" },
      "edit",
    );
    expect(p).toMatchObject({
      schema: "public",
      name: "s",
      action: { op: "create", increment: "1" },
    });
  });

  it("enum edit carries labels through", () => {
    const p = initialCrudParams(
      "enum",
      { schema: "public", name: "role", labels: ["admin"] },
      "edit",
    );
    expect(p.action).toMatchObject({ op: "create", labels: ["admin"] });
  });

  it("index create keeps the owning table and an empty column list", () => {
    const p = initialCrudParams(
      "index",
      { schema: "public", table: "users", name: "" },
      "create",
    );
    expect(p).toEqual({
      schema: "public",
      table: "users",
      name: "",
      action: { op: "create", unique: false, method: "", columns: [], predicate: null },
    });
  });

  it("constraint create starts as a CHECK on the owning table", () => {
    const p = initialCrudParams(
      "constraint",
      { schema: "public", table: "users", name: "" },
      "create",
    );
    expect(p).toEqual({
      schema: "public",
      table: "users",
      name: "",
      action: { op: "check", expression: "" },
    });
  });

  it("procedure edit prefills is_procedure from kind", () => {
    const p = initialCrudParams(
      "procedure",
      { schema: "public", name: "do_thing" },
      "edit",
    );
    expect(p).toMatchObject({
      schema: "public",
      name: "do_thing",
      is_procedure: true,
      action: { op: "create_or_replace", args: [] },
    });
  });

  it("view edit prefills the definition and marks non-materialized", () => {
    const p = initialCrudParams(
      "view",
      { schema: "public", name: "v", definition: "SELECT 1" },
      "edit",
    );
    expect(p).toMatchObject({
      schema: "public",
      name: "v",
      materialized: false,
      action: { op: "create", definition: "SELECT 1" },
    });
  });

  it("function edit prefills body, zipped args, return_type, and language", () => {
    const p = initialCrudParams(
      "function",
      {
        schema: "public",
        name: "add_one",
        return_type: "integer",
        argument_types: ["integer"],
        argument_names: ["x"],
        argument_modes: ["IN"],
        language: "plpgsql",
        source: "BEGIN RETURN x + 1; END",
        kind: "f",
      },
      "edit",
    );
    expect(p).toMatchObject({
      schema: "public",
      name: "add_one",
      is_procedure: false,
      action: {
        op: "create_or_replace",
        args: [{ mode: "IN", name: "x", type: "integer" }],
        return_type: "integer",
        language: "plpgsql",
        body: "BEGIN RETURN x + 1; END",
      },
    });
  });

  it("procedure edit prefills source and zips multiple args", () => {
    const p = initialCrudParams(
      "procedure",
      {
        schema: "public",
        name: "do_thing",
        return_type: "void",
        argument_types: ["int", "text"],
        argument_names: ["a", "b"],
        argument_modes: ["IN", "OUT"],
        language: "plpgsql",
        source: "BEGIN PERFORM a; END",
        kind: "p",
      },
      "edit",
    );
    expect(p).toMatchObject({
      is_procedure: true,
      action: {
        op: "create_or_replace",
        args: [
          { mode: "IN", name: "a", type: "int" },
          { mode: "OUT", name: "b", type: "text" },
        ],
        return_type: "void",
        body: "BEGIN PERFORM a; END",
      },
    });
  });

  it("function create keeps empty args/body and the default language", () => {
    const p = initialCrudParams(
      "function",
      { schema: "public", name: "add_one" },
      "create",
    );
    expect(p.action).toMatchObject({
      op: "create_or_replace",
      args: [],
      return_type: null,
      language: "plpgsql",
      body: "",
    });
  });

  it("sequence edit prefills increment/min/max/start/cycle from the item", () => {
    const p = initialCrudParams(
      "sequence",
      {
        schema: "public",
        name: "s",
        start_value: "5",
        min_value: "1",
        max_value: "999",
        increment: "2",
        cycle: true,
      },
      "edit",
    );
    expect(p.action).toMatchObject({
      op: "create",
      increment: "2",
      min_value: "1",
      max_value: "999",
      start: "5",
      cycle: true,
    });
  });

  it("trigger edit prefills table, timing, events, and orientation", () => {
    const p = initialCrudParams(
      "trigger",
      {
        schema: "public",
        name: "trg",
        table_name: "users",
        event_manipulation: "INSERT",
        action_timing: "AFTER",
        action_orientation: "row",
      },
      "edit",
    );
    expect(p.action).toMatchObject({
      op: "create",
      table: "users",
      timing: "AFTER",
      events: ["INSERT"],
      orientation: "ROW",
    });
  });

  it("trigger edit splits OR-joined event_manipulation into separate events", () => {
    const p = initialCrudParams(
      "trigger",
      {
        schema: "public",
        name: "trg",
        table_name: "orders",
        event_manipulation: "INSERT OR UPDATE",
        action_timing: "BEFORE",
        action_orientation: "STATEMENT",
      },
      "edit",
    );
    expect(p.action).toMatchObject({
      events: ["INSERT", "UPDATE"],
      orientation: "STATEMENT",
    });
  });

  it("index edit prefills name, unique, method, and columns", () => {
    const p = initialCrudParams(
      "index",
      {
        schema: "public",
        table: "users",
        name: "idx_users_email",
        is_unique: true,
        method: "btree",
        columns: ["email"],
      },
      "edit",
    );
    expect(p).toMatchObject({
      schema: "public",
      table: "users",
      name: "idx_users_email",
      action: {
        op: "create",
        unique: true,
        method: "btree",
        columns: ["email"],
        predicate: null,
      },
    });
  });

  it("constraint edit maps CHECK contype to a check action with the definition", () => {
    const p = initialCrudParams(
      "constraint",
      {
        schema: "public",
        table: "users",
        name: "chk_age",
        contype: "CHECK",
        definition: "CHECK (age > 0)",
        columns: ["age"],
      },
      "edit",
    );
    expect(p).toMatchObject({
      schema: "public",
      table: "users",
      name: "chk_age",
      action: { op: "check", expression: "CHECK (age > 0)" },
    });
  });

  it("constraint edit maps UNIQUE contype to a unique action with columns", () => {
    const p = initialCrudParams(
      "constraint",
      {
        schema: "public",
        table: "users",
        name: "uniq_email",
        contype: "UNIQUE",
        definition: "UNIQUE (email)",
        columns: ["email"],
      },
      "edit",
    );
    expect(p).toMatchObject({
      name: "uniq_email",
      action: { op: "unique", columns: ["email"] },
    });
  });

  it("extension edit prefills the version from the item", () => {
    const p = initialCrudParams(
      "extension",
      { schema: "public", name: "pgcrypto", version: "1.3" },
      "edit",
    );
    expect(p).toMatchObject({
      name: "pgcrypto",
      action: { op: "create", version: "1.3" },
    });
  });

  it("view edit marks materialized when the item is a materialized view", () => {
    const p = initialCrudParams(
      "view",
      {
        schema: "public",
        name: "mv",
        table_type: "MATERIALIZED VIEW",
        definition: "SELECT 1",
      },
      "edit",
    );
    expect(p).toMatchObject({
      name: "mv",
      materialized: true,
      action: { op: "create", definition: "SELECT 1" },
    });
  });
});

describe("dropCrudParams", () => {
  it("plain kinds build a base drop action", () => {
    expect(
      dropCrudParams("sequence", { schema: "public", name: "s" }),
    ).toEqual({ schema: "public", name: "s", action: { op: "drop" } });
  });

  it("index and constraint carry the owning table", () => {
    expect(
      dropCrudParams("index", { schema: "public", name: "i", table: "users" }),
    ).toEqual({
      schema: "public",
      name: "i",
      table: "users",
      action: { op: "drop" },
    });
  });

  it("trigger uses table_name as a fallback for the table", () => {
    expect(
      dropCrudParams("trigger", {
        schema: "public",
        name: "trg",
        table_name: "users",
      }),
    ).toEqual({
      schema: "public",
      name: "trg",
      action: { op: "drop", table: "users" },
    });
  });

  it("view marks materialized via table_type", () => {
    expect(
      dropCrudParams("view", { schema: "public", name: "m", table_type: "m" }),
    ).toMatchObject({ materialized: true, action: { op: "drop" } });
  });

  it("function carries argument types and is_procedure false", () => {
    expect(
      dropCrudParams("function", {
        schema: "public",
        name: "f",
        argument_types: ["int"],
      }),
    ).toMatchObject({
      is_procedure: false,
      action: { op: "drop", arg_types: ["int"] },
    });
  });
});

describe("table/role crud params", () => {
  it("initialCrudParams(table, create) starts empty with columns", () => {
    const p = initialCrudParams("table", { schema: "public", name: "" }, "create");
    expect(p).toEqual({ schema: "public", name: "", action: { op: "create", columns: [] } });
  });
  it("initialCrudParams(table, edit) prefills columns", () => {
    const item: CrudItem = { schema: "public", name: "users", columns: ["id"], columnMeta: [
      { name: "id", type: "integer", nullable: false, is_pk: true, default: null },
    ] };
    const p = initialCrudParams("table", item, "edit");
    expect((p as any).action.op).toBe("edit");
    expect((p as any).action.old_columns).toEqual(item.columnMeta);
  });
  it("initialCrudParams(role, create) starts empty with options", () => {
    const p = initialCrudParams("role", { schema: "", name: "" }, "create");
    expect(p).toEqual({ schema: "", name: "", action: { op: "create", login: false, superuser: false, createdb: false, createrole: false, inherit: true, replication: false, bypassrls: false, connection_limit: -1, valid_until: "", password: "", members: [] } });
  });
  it("dropCrudParams(role) drops by name", () => {
    const p = dropCrudParams("role", { schema: "", name: "app" });
    expect(p).toEqual({ schema: "", name: "app", action: { op: "drop" } });
  });
  it("dropCrudParams(table) drops the table", () => {
    const p = dropCrudParams("table", { schema: "public", name: "users" });
    expect(p).toEqual({ schema: "public", name: "users", action: { op: "drop" } });
  });
});