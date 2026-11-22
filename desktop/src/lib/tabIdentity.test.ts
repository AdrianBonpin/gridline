import { describe, it, expect } from "vitest";
import {
  columnCacheKey,
  isSameTab,
  metadataScopeKey,
  outOfOriginReason,
  sameTabOrigin,
  tabDataIsCurrent,
  tablesAffectedByChanges,
  tabsAffectedByChanges,
  type TabLike,
} from "./tabIdentity";
import { changeOriginFor, type ChangeOrigin } from "./changeOrigin";

const connection = {
  id: "c1",
  db_type: "postgresql" as const,
  host: "localhost",
  port: 5432,
  username: "dev",
  database: "appdb",
};

const appdb: ChangeOrigin = changeOriginFor(connection, "appdb");
const analytics: ChangeOrigin = changeOriginFor(connection, "analytics");
const otherConnection: ChangeOrigin = changeOriginFor(
  { ...connection, id: "c2" },
  "appdb",
);

function tab(overrides: Partial<TabLike> = {}): TabLike {
  return {
    tabType: "table",
    origin: appdb,
    schema: "public",
    table: "users",
    ...overrides,
  };
}

describe("sameTabOrigin", () => {
  it("matches the same connection + database even after a retarget", () => {
    const retargeted: ChangeOrigin = {
      ...appdb,
      target: "host=elsewhere",
      targetLabel: "postgresql dev@elsewhere:5432/appdb",
    };
    expect(sameTabOrigin(appdb, retargeted)).toBe(true);
  });

  it("separates databases of one connection", () => {
    expect(sameTabOrigin(appdb, analytics)).toBe(false);
  });

  it("separates connections", () => {
    expect(sameTabOrigin(appdb, otherConnection)).toBe(false);
  });

  it("treats two absences of an origin as the same (unknown) target", () => {
    expect(sameTabOrigin(null, null)).toBe(true);
    expect(sameTabOrigin(null, appdb)).toBe(false);
    expect(sameTabOrigin(appdb, null)).toBe(false);
  });
});

describe("isSameTab", () => {
  it("a table, a query and an object sharing a label are distinct tabs", () => {
    const table = tab();
    const query = tab({ tabType: "query", table: "users", schema: "public" });
    const object = tab({ tabType: "object", objectType: "function" });

    expect(isSameTab(table, query)).toBe(false);
    expect(isSameTab(table, object)).toBe(false);
    expect(isSameTab(query, object)).toBe(false);
    expect(isSameTab(table, tab())).toBe(true);
  });

  it("never keys a query tab's identity on its display label", () => {
    const a = tab({ tabType: "query", table: "Query" });
    const b = tab({ tabType: "query", table: "Query" });
    expect(isSameTab(a, b)).toBe(false);
  });

  it("identifies a file-backed query tab by origin + file path", () => {
    const a = tab({ tabType: "query", table: "a.sql", filePath: "/tmp/a.sql" });
    const b = tab({
      tabType: "query",
      table: "renamed",
      filePath: "/tmp/a.sql",
    });
    expect(isSameTab(a, b)).toBe(true);
    expect(
      isSameTab(a, { ...b, origin: analytics }),
    ).toBe(false);
  });

  it("distinguishes the same table name in another database", () => {
    expect(isSameTab(tab(), tab({ origin: analytics }))).toBe(false);
  });

  it("distinguishes object kinds", () => {
    const fn = tab({ tabType: "object", objectType: "function" });
    const trigger = tab({ tabType: "object", objectType: "trigger" });
    expect(isSameTab(fn, trigger)).toBe(false);
    expect(isSameTab(fn, tab({ tabType: "object", objectType: "function" }))).toBe(
      true,
    );
  });
});

describe("tabDataIsCurrent", () => {
  it("is current when the live target matches the tab's origin target", () => {
    expect(tabDataIsCurrent(appdb, appdb)).toBe(true);
    // a retargeted connection keeps the tab current (same connection + database)
    expect(
      tabDataIsCurrent(appdb, { ...appdb, target: "host=elsewhere" }),
    ).toBe(true);
  });

  it("is not current after the database selector moves elsewhere", () => {
    expect(tabDataIsCurrent(appdb, analytics)).toBe(false);
  });

  it("allows a tab with no recorded origin (nothing to contradict)", () => {
    expect(tabDataIsCurrent(null, analytics)).toBe(true);
  });

  it("keeps a SQLite tab current when only the catalog alias label differs", () => {
    // The built-product regression: a query tab opened before `getDatabases`
    // resolved recorded the origin with no database label, and the viewer then
    // reported the SQLite catalog alias `main` — the same file, rendered as a
    // "stale results" banner on an empty tab.
    const sqlite = {
      id: "c3",
      db_type: "sqlite" as const,
      host: "",
      port: null,
      username: null,
      database: "/tmp/app-data/demo.db",
    };
    const beforeCatalog = changeOriginFor(sqlite, "");
    const afterCatalog = changeOriginFor(sqlite, "main");
    expect(tabDataIsCurrent(beforeCatalog, afterCatalog)).toBe(true);
    // …and a genuinely different SQLite file is still a different database.
    const otherFile = changeOriginFor({ ...sqlite, database: "/tmp/elsewhere.db" }, "main");
    expect(outOfOriginReason(beforeCatalog, otherFile)).toContain("elsewhere.db");
  });
});

describe("outOfOriginReason", () => {
  it("names both the tab's target and the live target", () => {
    const reason = outOfOriginReason(appdb, analytics);
    expect(reason).toContain("appdb");
    expect(reason).toContain("analytics");
    expect(reason).toMatch(/switch/i);
  });
});

describe("tablesAffectedByChanges", () => {
  it("collects each changed table once", () => {
    expect(
      tablesAffectedByChanges([
        { type: "update", schema: "public", table: "users" },
        { type: "insert", schema: "public", table: "users" },
        { type: "empty_table", schema: "public", table: "orders" },
        { type: "ddl", schema: "public", table: "users" },
      ]),
    ).toEqual([
      { schema: "public", table: "users" },
      { schema: "public", table: "orders" },
    ]);
  });

  it("ignores changes with no table (a database-wide DDL)", () => {
    expect(
      tablesAffectedByChanges([{ type: "ddl", schema: null, table: null }]),
    ).toEqual([]);
  });
});

describe("tabsAffectedByChanges", () => {
  const changes = [{ type: "update", schema: "public", table: "users" }];

  it("returns every tab of the origin showing an affected table", () => {
    const tabs: TabLike[] = [
      tab(),
      tab({ table: "posts" }),
      tab({ tabType: "object", objectType: "table" }),
    ];
    expect(tabsAffectedByChanges(tabs, changes, appdb).map((t) => t.tabType)).toEqual([
      "table",
      "object",
    ]);
  });

  it("never refreshes another origin's tab", () => {
    const tabs: TabLike[] = [tab({ origin: analytics })];
    expect(tabsAffectedByChanges(tabs, changes, appdb)).toEqual([]);
  });
});

describe("cache scope", () => {
  it("separates connections and databases", () => {
    const a = metadataScopeKey({ connectionId: "c1", database: "appdb" });
    const b = metadataScopeKey({ connectionId: "c1", database: "analytics" });
    const c = metadataScopeKey({ connectionId: "c2", database: "appdb" });
    expect(new Set([a, b, c]).size).toBe(3);
    expect(metadataScopeKey({ connectionId: "c1", database: "appdb" })).toBe(a);
  });

  it("builds a per-table key inside the scope", () => {
    const scope = { connectionId: "c1", database: "appdb" };
    const key = columnCacheKey(scope, "public", "users");
    expect(key).toBe(
      columnCacheKey({ connectionId: "c1", database: "appdb" }, "public", "users"),
    );
    expect(key).not.toBe(
      columnCacheKey({ connectionId: "c1", database: "analytics" }, "public", "users"),
    );
    expect(key).not.toBe(columnCacheKey(scope, "public", "orders"));
  });
});
