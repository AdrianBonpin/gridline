import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "./uiStore";

beforeEach(() => useUiStore.setState({ searchQuery: "", activeFolderId: null, activeTagIds: [], activeDbTypes: [], activeView: "home" }));

describe("uiStore", () => {
  it("starts on home view", () => expect(useUiStore.getState().activeView).toBe("home"));
  it("setActiveView changes view", () => {
    useUiStore.getState().setActiveView("settings");
    expect(useUiStore.getState().activeView).toBe("settings");
  });
  it("setSearchQuery updates query", () => {
    useUiStore.getState().setSearchQuery("prod");
    expect(useUiStore.getState().searchQuery).toBe("prod");
  });
  it("toggleTag adds and removes tag", () => {
    useUiStore.getState().toggleTag("t1");
    expect(useUiStore.getState().activeTagIds).toEqual(["t1"]);
    useUiStore.getState().toggleTag("t1");
    expect(useUiStore.getState().activeTagIds).toEqual([]);
  });
  it("toggleDbType adds and removes type", () => {
    useUiStore.getState().toggleDbType("redis");
    expect(useUiStore.getState().activeDbTypes).toEqual(["redis"]);
    useUiStore.getState().toggleDbType("redis");
    expect(useUiStore.getState().activeDbTypes).toEqual([]);
  });
  it("clearFilters resets search and filters but not view", () => {
    useUiStore.getState().setSearchQuery("x");
    useUiStore.getState().toggleTag("t1");
    useUiStore.getState().setActiveView("settings");
    useUiStore.getState().clearFilters();
    expect(useUiStore.getState().searchQuery).toBe("");
    expect(useUiStore.getState().activeTagIds).toEqual([]);
    expect(useUiStore.getState().activeView).toBe("settings");
  });
});