import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "../ui/Input";
import { useUiStore } from "../../stores/uiStore";

export function SearchBar() {
  const [value, setValue] = useState("");
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  return (
    <div className="flex items-center justify-center w-full">
      <div className="relative w-full max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
        <Input
          value={value}
          placeholder="Search connections..."
          onChange={(v) => { setValue(v); window.clearTimeout((window as any).__sb); (window as any).__sb = window.setTimeout(() => setSearchQuery(v), 150); }}
          className="pl-9"
        />
      </div>
    </div>
  );
}