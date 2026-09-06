import { useState, useRef, useEffect } from "react";
import { Plus, MoreVertical } from "lucide-react";
import * as cmd from "../../lib/commands";
import type { DependencyInfo } from "../../lib/types";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import { DependencyDialog } from "./DependencyDialog";

interface SchemaMenuProps {
  connectionId: string;
  schema?: string;
  onRefresh: () => void;
}

export function SchemaMenu({ connectionId, schema, onRefresh }: SchemaMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  const [dropOpen, setDropOpen] = useState(false);
  const [deps, setDeps] = useState<DependencyInfo[]>([]);
  const [typed, setTyped] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const resetErrors = () => setErr(null);

  const create = async () => {
    resetErrors();
    try {
      await cmd.createSchema(connectionId, name);
      setCreating(false);
      setName("");
      onRefresh();
    } catch (e) {
      setErr((e as Error)?.message ?? String(e));
    }
  };

  const rename = async () => {
    resetErrors();
    if (!schema) return;
    try {
      await cmd.renameSchema(connectionId, schema, newName);
      setRenaming(false);
      setNewName("");
      onRefresh();
    } catch (e) {
      setErr((e as Error)?.message ?? String(e));
    }
  };

  const startDrop = async () => {
    setMenuOpen(false);
    if (!schema) return;
    try {
      const d = await cmd.getObjectDependencies(connectionId, schema, "schema", schema);
      setDeps(d);
      setDropOpen(true);
      setTyped("");
      setErr(null);
    } catch (e) {
      setErr((e as Error)?.message ?? String(e));
    }
  };

  const confirmDrop = async (cascade: boolean) => {
    if (!schema) return;
    try {
      await cmd.dropSchema(connectionId, schema, cascade);
      setDropOpen(false);
      setTyped("");
      setDeps([]);
      onRefresh();
    } catch (e) {
      setErr((e as Error)?.message ?? String(e));
    }
  };

  const hasDeps = deps.length > 0;

  const inputClass =
    "w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted outline-none focus:border-accent/50 transition-colors";

  return (
    <div className="relative flex items-center gap-1" ref={menuRef}>
      <button
        aria-label="New schema"
        onClick={() => {
          setCreating(true);
          setName("");
          setErr(null);
        }}
        className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer"
      >
        <Plus size={14} />
      </button>

      {schema && (
        <button
          aria-label="Schema menu"
          onClick={() => setMenuOpen((v) => !v)}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer"
        >
          <MoreVertical size={14} />
        </button>
      )}

      {menuOpen && (
        <div className="absolute left-0 top-8 mt-1 rounded-xl bg-surface border border-border py-1 z-20 min-w-[160px] shadow-lg">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setRenaming(true);
              setNewName("");
              setErr(null);
            }}
            className="flex items-center px-3 py-2 text-sm w-full text-left transition-colors cursor-pointer text-text-muted hover:text-text hover:bg-surface-raised"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={startDrop}
            className="flex items-center px-3 py-2 text-sm w-full text-left transition-colors cursor-pointer text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            Drop
          </button>
        </div>
      )}

      {/* New Schema */}
      <AnimatedModal open={creating} onClose={() => setCreating(false)}>
        <div className="w-80">
          <h3 className="font-heading text-text text-lg mb-3">New Schema</h3>
          <p className="text-sm text-text-muted mb-3">Create a new schema in the current database.</p>
          <input
            placeholder="Schema name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
          {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={create}>
              Create
            </Button>
          </div>
        </div>
      </AnimatedModal>

      {/* Rename Schema */}
      <AnimatedModal open={renaming} onClose={() => setRenaming(false)}>
        <div className="w-80">
          <h3 className="font-heading text-text text-lg mb-3">Rename {schema}</h3>
          <p className="text-sm text-text-muted mb-3">Enter the new name for this schema.</p>
          <input
            placeholder="New name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={inputClass}
          />
          {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={rename}>
              Rename
            </Button>
          </div>
        </div>
      </AnimatedModal>

      {/* Dependency warning */}
      {dropOpen && (
        <DependencyDialog
          open={dropOpen}
          deps={deps}
          onCancel={() => {
            setDropOpen(false);
            setTyped("");
            setDeps([]);
            setErr(null);
          }}
          onProceed={() => {}}
        />
      )}

      {/* Typed-name confirmation for CASCADE drop */}
      {dropOpen && hasDeps && (
        <AnimatedModal
          open={dropOpen}
          onClose={() => {
            setDropOpen(false);
            setTyped("");
            setErr(null);
          }}
        >
          <div className="w-80">
            <h3 className="font-heading text-text text-lg mb-3">Drop Schema: {schema}</h3>
            <p className="text-sm text-text-muted mb-3">
              Type the schema name to confirm the CASCADE drop.
            </p>
            <input
              placeholder="Type the schema name"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (err) setErr(null);
              }}
              className={inputClass}
            />
            {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <Button
                variant="ghost"
                onClick={() => {
                  setDropOpen(false);
                  setTyped("");
                  setErr(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (typed !== schema) {
                    setErr("Name does not match");
                    return;
                  }
                  void confirmDrop(true);
                }}
              >
                Drop Schema
              </Button>
            </div>
          </div>
        </AnimatedModal>
      )}

      {/* Empty-schema confirmation (no deps) */}
      {dropOpen && !hasDeps && (
        <AnimatedModal
          open={dropOpen}
          onClose={() => {
            setDropOpen(false);
            setErr(null);
          }}
        >
          <div className="w-80">
            <h3 className="font-heading text-text text-lg mb-3">Drop Schema: {schema}</h3>
            <p className="text-sm text-text-muted mb-3">No dependencies — drop this empty schema?</p>
            {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <Button
                variant="ghost"
                onClick={() => {
                  setDropOpen(false);
                  setErr(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void confirmDrop(false)}>
                Drop Schema
              </Button>
            </div>
          </div>
        </AnimatedModal>
      )}
    </div>
  );
}