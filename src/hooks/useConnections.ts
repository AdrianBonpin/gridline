import { useConnectionStore } from "../stores/connectionStore";
import { useUiStore } from "../stores/uiStore";
import { filterConnections, getDescendantFolderIds } from "../lib/utils";
import type { Connection } from "../lib/types";

export function useFilteredConnections(): Connection[] {
  const connections = useConnectionStore((s) => s.connections);
  const tags = useConnectionStore((s) => s.tags);
  const folders = useConnectionStore((s) => s.folders);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const activeFolderId = useUiStore((s) => s.activeFolderId);
  const activeTagIds = useUiStore((s) => s.activeTagIds);
  const activeDbTypes = useUiStore((s) => s.activeDbTypes);

  let filtered = filterConnections(connections, tags, {
    query: searchQuery,
    activeTagIds,
    activeDbTypes,
  });

  if (activeFolderId) {
    const allowed = new Set(getDescendantFolderIds(folders, activeFolderId));
    filtered = filtered.filter(
      (c) => c.folder_id !== null && allowed.has(c.folder_id),
    );
  }

  return filtered;
}