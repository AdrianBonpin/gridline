import { describe, it, expect } from "vitest";
import { PROVIDER_TABS, getProviderById, SETUP_GUIDES } from "./providers";

describe("providers", () => {
  it("defines exactly 6 provider tabs in order", () => {
    expect(PROVIDER_TABS.map((p) => p.id)).toEqual([
      "postgresql", "mysql", "sqlite", "redis", "supabase", "neon",
    ]);
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