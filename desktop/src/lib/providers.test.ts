import { describe, it, expect } from "vitest";
import { PROVIDER_TABS, getProviderById, SETUP_GUIDES } from "./providers";

describe("providers", () => {
  it("defines exactly 8 provider tabs in order", () => {
    expect(PROVIDER_TABS.map((p) => p.id)).toEqual([
      "postgresql", "mysql", "mariadb", "sqlite", "redis", "supabase", "neon", "planetscale",
    ]);
  });

  it("includes a plain (non-managed) MariaDB tab persisting db_type mariadb", () => {
    const tab = getProviderById("mariadb")!;
    expect(tab.dbType).toBe("mariadb");
    expect(tab.isManagedPreset).toBe(false);
    expect(tab.label).toBe("MariaDB");
  });

  it("marks only supabase and neon as managed presets mapping to postgresql", () => {
    const pg = getProviderById("postgresql")!;
    expect(pg.dbType).toBe("postgresql");
    expect(pg.isManagedPreset).toBe(false);
    const supa = getProviderById("supabase")!;
    expect(supa.dbType).toBe("postgresql");
    expect(supa.isManagedPreset).toBe(true);
    const neon = getProviderById("neon")!;
    expect(neon.dbType).toBe("postgresql");
    expect(neon.isManagedPreset).toBe(true);
    const redis = getProviderById("redis")!;
    expect(redis.dbType).toBe("redis");
    expect(redis.isManagedPreset).toBe(false);
  });

  it("getProviderById returns undefined for unknown id", () => {
    expect(getProviderById("nope")).toBeUndefined();
  });

  it("ships setup guides for supabase and neon only, each with steps", () => {
    expect(SETUP_GUIDES.supabase.steps.length).toBeGreaterThan(0);
    expect(SETUP_GUIDES.neon.steps.length).toBeGreaterThan(0);
    expect(SETUP_GUIDES.supabase.sslRequired).toBe(true);
    expect(SETUP_GUIDES.neon.sslRequired).toBe(true);
  });
});

describe("PlanetScale preset", () => {
  it("registers as a managed MySQL preset persisting db_type mysql", () => {
    const tab = PROVIDER_TABS.find((p) => p.id === "planetscale");
    expect(tab).toBeDefined();
    expect(tab!.dbType).toBe("mysql");
    expect(tab!.isManagedPreset).toBe(true);
  });

  it("ships a setup guide requiring SSL with concrete steps", () => {
    const guide = SETUP_GUIDES.planetscale;
    expect(guide.sslRequired).toBe(true);
    expect(guide.steps.length).toBeGreaterThanOrEqual(4);
    expect(guide.steps.some((s) => s.detail.includes("psdb.cloud"))).toBe(true);
  });
});