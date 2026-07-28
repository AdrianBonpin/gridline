import { useEffect, useState } from "react";

export function useSearch(query: string): { debounced: string } {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  return { debounced };
}