import { useMemo } from "react";
import type { Tag } from "../lib/types";
import { useConnectionStore } from "../stores/connectionStore";

export function useSortedTags(): Tag[] {
  const tags = useConnectionStore((s) => s.tags);
  const tagOrder = useConnectionStore((s) => s.tagOrder);

  return useMemo(() => {
    if (tagOrder.length === 0) return tags;
    const orderMap = new Map(tagOrder.map((id, i) => [id, i]));
    const sorted = [...tags].sort((a, b) => {
      const ai = orderMap.get(a.id);
      const bi = orderMap.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [tags, tagOrder]);
}