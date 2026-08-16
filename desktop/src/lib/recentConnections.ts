import type { RecentConnection } from "./types";

/** Keep the newest N entries (sorted by opened_at DESC). */
export function pruneRecent(list: RecentConnection[], n: number): RecentConnection[] {
  return [...list].sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1)).slice(0, n);
}

/** Remove duplicates, keeping the most recent occurrence per connection_id at the front. */
export function dedupeRecent(list: RecentConnection[]): RecentConnection[] {
  const seen = new Set<string>();
  const out: RecentConnection[] = [];
  for (const item of [...list].sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1))) {
    if (!seen.has(item.connection_id)) {
      seen.add(item.connection_id);
      out.push(item);
    }
  }
  return out;
}