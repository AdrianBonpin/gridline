import { describe, expect, it } from "vitest";
import type { Connection } from "./types";
import {
  changeOriginFor,
  connectionTarget,
  describeChangeOrigin,
  describeRetargeting,
  isSameChangeOrigin,
  isSameChangeTarget,
  itemsForChangeTarget,
} from "./changeOrigin";

function conn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "c1",
    name: "Local dev",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    username: "dev",
    database: "appdb",
    folder_id: null,
    keychain_ref: null,
    tag_ids: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    favorite: false,
    ...overrides,
  };
}

describe("connectionTarget", () => {
  it("fingerprints the saved connection's target configuration", () => {
    const a = connectionTarget(conn());
    const b = connectionTarget(conn());
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint.length).toBeGreaterThan(0);
  });

  it("produces the exact canonical string the backend recomputes", () => {
    // Cross-language pin: `db::change_target::connection_target_fingerprint` in
    // Rust must produce this same string, or every commit would be refused as
    // retargeted. Both sides assert the literal on purpose.
    expect(connectionTarget(conn()).fingerprint).toBe(
      "db_type=postgresql|host=localhost|port=5432|username=dev|database=appdb|" +
        "ssh_host=|ssh_port=|ssh_user=|ssh_auth_method=|ssh_private_key_path=|" +
        "ssl_mode=|ssl_ca_path=|ssl_cert_path=|ssl_key_path=",
    );
  });

  it("changes the fingerprint when the saved target changes", () => {
    const base = connectionTarget(conn()).fingerprint;
    const targets = [
      conn({ host: "db.example.com" }),
      conn({ port: 6543 }),
      conn({ username: "other" }),
      conn({ database: "otherdb" }),
      conn({ ssh_host: "bastion.example.com", ssh_port: 22, ssh_user: "jump" }),
      conn({ ssl_mode: "verify-full", ssl_ca_path: "/tmp/ca.pem" }),
    ];
    for (const candidate of targets) {
      expect(connectionTarget(candidate).fingerprint).not.toBe(base);
    }
  });

  it("ignores connection metadata that does not change where writes land", () => {
    const base = connectionTarget(conn()).fingerprint;
    const cosmetic = conn({
      name: "Renamed environment",
      folder_id: "f1",
      tag_ids: ["t1", "t2"],
      environment: "production",
      favorite: true,
      keychain_ref: "gridline:c1",
      updated_at: "2026-02-02T00:00:00Z",
    });
    expect(connectionTarget(cosmetic).fingerprint).toBe(base);
  });

  it("describes the target for a visible refusal message", () => {
    const label = connectionTarget(conn()).label;
    expect(label).toContain("postgresql");
    expect(label).toContain("dev@localhost:5432");
    expect(label).toContain("appdb");

    const tunneled = connectionTarget(
      conn({ ssh_host: "bastion.example.com", ssh_port: 2222, ssh_user: "jump" }),
    ).label;
    expect(tunneled).toContain("ssh jump@bastion.example.com:2222");
  });
});

describe("changeOriginFor", () => {
  it("carries the connection, the selected database, and the target", () => {
    const origin = changeOriginFor(conn(), "analytics");
    expect(origin.connectionId).toBe("c1");
    expect(origin.database).toBe("analytics");
    expect(origin.target).toBe(connectionTarget(conn()).fingerprint);
    expect(origin.targetLabel).toBe(connectionTarget(conn()).label);
  });

  it("treats a missing database selection as an empty selection", () => {
    expect(changeOriginFor(conn(), null).database).toBe("");
    expect(changeOriginFor(conn(), undefined).database).toBe("");
  });
});

describe("SQLite catalog aliases are not database identity", () => {
  function sqliteConn(overrides: Partial<Connection> = {}): Connection {
    return conn({
      db_type: "sqlite",
      host: "",
      port: null,
      username: null,
      database: "/tmp/app-data/demo.db",
      ...overrides,
    });
  }

  it("records one origin whether the catalog alias has loaded or not", () => {
    // Measured on the built app: a query tab opened while `getDatabases` was
    // still in flight recorded `database: ""`, and once the catalog arrived the
    // viewer reported `database: "main"` — the same file shown as two origins,
    // which rendered a false "these rows came from … (database default), but the
    // viewer is now on … (database main)" banner on an empty tab.
    const beforeCatalog = changeOriginFor(sqliteConn(), "");
    const afterCatalog = changeOriginFor(sqliteConn(), "main");
    expect(beforeCatalog).toEqual(afterCatalog);
    expect(beforeCatalog.database).toBe("");
    expect(isSameChangeOrigin(beforeCatalog, afterCatalog)).toBe(true);
    expect(isSameChangeTarget(beforeCatalog, afterCatalog)).toBe(true);
  });

  it("still separates a different file and a different connection", () => {
    // Normalising the alias must not make two databases look like one.
    const demo = changeOriginFor(sqliteConn(), "main");
    const otherFile = changeOriginFor(sqliteConn({ database: "/tmp/other.db" }), "main");
    const otherConnection = changeOriginFor(sqliteConn({ id: "c2" }), "main");
    // A different file is a different origin, so work staged against the old one
    // can never be committed to it…
    expect(isSameChangeOrigin(demo, otherFile)).toBe(false);
    // …while it stays *grouped* under the same saved connection, which is the
    // documented contract for a retargeted connection (`isSameChangeTarget`):
    // the pending work stays visible and Commit All explains the retarget
    // instead of the work vanishing.
    expect(isSameChangeTarget(demo, otherFile)).toBe(true);
    expect(describeRetargeting(demo, otherFile)).toContain("other.db");
    // Another saved connection is a different origin *and* a different group.
    expect(isSameChangeOrigin(demo, otherConnection)).toBe(false);
    expect(isSameChangeTarget(demo, otherConnection)).toBe(false);
  });

  it("keeps the selected database as identity for engines that have one", () => {
    // PostgreSQL/MySQL really can be pointed at another database, so that name
    // stays part of the origin (and of `isSameChangeTarget`).
    expect(changeOriginFor(conn(), "analytics").database).toBe("analytics");
    expect(changeOriginFor(conn(), "main").database).toBe("main");
    expect(
      isSameChangeTarget(
        changeOriginFor(conn(), ""),
        changeOriginFor(conn(), "analytics"),
      ),
    ).toBe(false);
  });
});

describe("isSameChangeOrigin", () => {
  it("matches identical origins", () => {
    expect(
      isSameChangeOrigin(changeOriginFor(conn(), "appdb"), changeOriginFor(conn(), "appdb")),
    ).toBe(true);
  });

  it("does not match a different saved connection", () => {
    expect(
      isSameChangeOrigin(
        changeOriginFor(conn(), "appdb"),
        changeOriginFor(conn({ id: "c2" }), "appdb"),
      ),
    ).toBe(false);
  });

  it("does not match a different selected database", () => {
    expect(
      isSameChangeOrigin(changeOriginFor(conn(), "appdb"), changeOriginFor(conn(), "analytics")),
    ).toBe(false);
  });

  it("does not match the same connection after it was retargeted", () => {
    expect(
      isSameChangeOrigin(
        changeOriginFor(conn(), "appdb"),
        changeOriginFor(conn({ host: "other.example.com" }), "appdb"),
      ),
    ).toBe(false);
  });

  it("never matches a missing origin", () => {
    expect(isSameChangeOrigin(null, changeOriginFor(conn(), "appdb"))).toBe(false);
    expect(isSameChangeOrigin(changeOriginFor(conn(), "appdb"), null)).toBe(false);
  });
});

describe("isSameChangeTarget", () => {
  it("groups the same connection + selected database even after a retarget", () => {
    const staged = changeOriginFor(conn(), "appdb");
    const retargeted = changeOriginFor(conn({ host: "other.example.com" }), "appdb");
    expect(isSameChangeTarget(staged, retargeted)).toBe(true);
    expect(isSameChangeOrigin(staged, retargeted)).toBe(false);
  });

  it("separates different connections and different databases", () => {
    const origin = changeOriginFor(conn(), "appdb");
    expect(isSameChangeTarget(origin, changeOriginFor(conn({ id: "c2" }), "appdb"))).toBe(false);
    expect(isSameChangeTarget(origin, changeOriginFor(conn(), "analytics"))).toBe(false);
  });
});

describe("itemsForChangeTarget", () => {
  interface Item {
    id: string;
    origin: ReturnType<typeof changeOriginFor> | null;
  }

  it("returns only the active target's items", () => {
    const here = changeOriginFor(conn(), "appdb");
    const elsewhere = changeOriginFor(conn({ id: "c2" }), "appdb");
    const items: Item[] = [
      { id: "a", origin: here },
      { id: "b", origin: elsewhere },
      { id: "c", origin: changeOriginFor(conn(), "analytics") },
    ];
    expect(itemsForChangeTarget(items, here).map((i) => i.id)).toEqual(["a"]);
  });

  it("keeps retargeted work visible under its connection + database", () => {
    const here = changeOriginFor(conn(), "appdb");
    const retargeted = changeOriginFor(conn({ host: "other.example.com" }), "appdb");
    const items: Item[] = [{ id: "a", origin: retargeted }];
    expect(itemsForChangeTarget(items, here).map((i) => i.id)).toEqual(["a"]);
  });

  it("returns nothing when there is no active origin", () => {
    const items: Item[] = [{ id: "a", origin: changeOriginFor(conn(), "appdb") }, { id: "b", origin: null }];
    expect(itemsForChangeTarget(items, null)).toEqual([]);
  });

  it("returns origin-less items only when there is no active origin (never committed)", () => {
    const items: Item[] = [{ id: "b", origin: null }];
    expect(itemsForChangeTarget(items, null)).toEqual([]);
  });
});

describe("describeChangeOrigin / describeRetargeting", () => {
  it("names the connection target and the selected database", () => {
    expect(describeChangeOrigin(changeOriginFor(conn(), "analytics"))).toBe(
      "postgresql dev@localhost:5432/appdb (database analytics)",
    );
  });

  it("states what changed when the saved connection was retargeted", () => {
    const message = describeRetargeting(
      changeOriginFor(conn(), "appdb"),
      changeOriginFor(conn({ host: "new.example.com" }), "appdb"),
    );
    expect(message).toContain("staged against postgresql dev@localhost:5432/appdb");
    expect(message).toContain("now targets postgresql dev@new.example.com:5432/appdb");
    // Honest partial-success wording: it must never promise a rollback.
    expect(message).not.toMatch(/roll(ed)?\s*back/i);
  });
});
