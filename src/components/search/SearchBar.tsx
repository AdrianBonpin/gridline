import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Search, Command } from "lucide-react";
import { Input } from "../ui/Input";
import { useUiStore } from "../../stores/uiStore";

export interface SearchBarHandle {
  focus: () => void;
}

export const SearchBar = forwardRef<SearchBarHandle, object>(function SearchBar(_props, ref) {
  const [value, setValue] = useState("");
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  return (
    <div className="flex items-center justify-center w-full">
      <div className="relative w-full max-w-xl">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
        <Input
          ref={inputRef}
          value={value}
          placeholder="Search connections, folders, and tags..."
          onChange={(v) => { setValue(v); window.clearTimeout((window as any).__sb); (window as any).__sb = window.setTimeout(() => setSearchQuery(v), 150); }}
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