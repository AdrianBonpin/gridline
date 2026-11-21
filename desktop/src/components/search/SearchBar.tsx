import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Search, Command } from "lucide-react";
import { Input } from "../ui/Input";
import { useUiStore } from "../../stores/uiStore";
import { looksLikeConnectionString } from "../../lib/connectionString";

export interface SearchBarHandle {
  focus: () => void;
}

/** Delay before a typed search term is committed to the store. */
export const SEARCH_DEBOUNCE_MS = 150;

interface SearchBarProps {
  onDetectUrl?: (url: string) => void;
}

export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(function SearchBar({ onDetectUrl }, ref) {
  const [value, setValue] = useState("");
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  // The pending debounce lives in a ref owned by this component (it used to be
  // a `window` global, so it outlived the component and crossed instances).
  const debounceRef = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const cancelPendingSearch = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  // Never leave a timer running past unmount.
  useEffect(() => cancelPendingSearch, [cancelPendingSearch]);

  // Keep local input in sync with the store (e.g. when the Clear button or a
  // detected connection string resets it). A pending debounce is dropped first:
  // the store changed from somewhere else, so re-applying our own queued, now
  // stale text afterwards would undo that change (Clear search reverting, or —
  // the bug this guards — a partial URL prefix truncating the input).
  useEffect(() => {
    cancelPendingSearch();
    setValue(searchQuery);
  }, [searchQuery, cancelPendingSearch]);

  return (
    <div className="flex items-center justify-center w-full">
      <div className="relative w-full max-w-xl">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
        <Input
          ref={inputRef}
          value={value}
          placeholder="Search connections, folders, tags... or paste a DB URL"
          onChange={(v) => {
            setValue(v);
            if (looksLikeConnectionString(v)) {
              // The text is handed to the new-connection screen, so any queued
              // search term is obsolete: letting it fire would commit a stale
              // prefix of the URL into the search store.
              cancelPendingSearch();
              onDetectUrl?.(v);
              return;
            }
            cancelPendingSearch();
            debounceRef.current = window.setTimeout(() => {
              debounceRef.current = null;
              setSearchQuery(v);
            }, SEARCH_DEBOUNCE_MS);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancelPendingSearch();
              setValue("");
              setSearchQuery("");
              inputRef.current?.blur();
            }
          }}
          className="pl-10 pr-14"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border bg-surface-raised text-text-muted text-xs pointer-events-none">
          <Command size={10} />
          <span>K</span>
        </div>
      </div>
    </div>
  );
});