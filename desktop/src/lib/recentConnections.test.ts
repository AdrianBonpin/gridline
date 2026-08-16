import { describe, it, expect } from "vitest";
import { pruneRecent, dedupeRecent } from "./recentConnections";
import type { RecentConnection } from "./types";

const rc = (id: string, at: string): RecentConnection => ({ connection_id: id, opened_at: at });

describe("recentConnections helpers", () => {
  it("pruneRecent keeps the newest N", () => {
    const list = [rc("a", "1"), rc("b", "3"), rc("c", "2")];
    expect(pruneRecent(list, 2)).toEqual([rc("b", "3"), rc("c", "2")]);
  });
  it("dedupeRecent moves the latest occurrence of an id to the front", () => {
    const list = [rc("a", "1"), rc("b", "2"), rc("a", "3")];
    const out = dedupeRecent(list);
    expect(out[0].connection_id).toBe("a");
    expect(out).toHaveLength(2);
  });
});