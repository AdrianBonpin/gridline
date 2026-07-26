import { useState } from "react";
import type { ConnectionInput, DbType } from "../../lib/types";
import { validateConnectionInput } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface NewConnectionFormProps {
  onCreate: (input: ConnectionInput) => void;
  onCancel: () => void;
}

export function NewConnectionForm({ onCreate, onCancel }: NewConnectionFormProps) {
  const [name, setName] = useState("");
  const [dbType, setDbType] = useState<DbType>("postgresql");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    const portNum = dbType === "sqlite" ? null : port ? Number(port) : null;
    const input: ConnectionInput = {
      name,
      db_type: dbType,
      host,
      port: portNum,
      username: username || null,
    };

    const result = validateConnectionInput(input);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setError("");
    onCreate(input);
  };

  return (
    <div className="max-w-xl mx-auto p-8">
      <h1 className="font-heading text-xl mb-4">New Connection</h1>
      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}
      <div className="space-y-3">
        <Input placeholder="Connection name" value={name} onChange={setName} />
        <select
          value={dbType}
          onChange={(e) => setDbType(e.target.value as DbType)}
          className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-white"
        >
          <option value="postgresql">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="sqlite">SQLite</option>
          <option value="redis">Redis</option>
        </select>
        <Input placeholder="Hostname" value={host} onChange={setHost} />
        {dbType !== "sqlite" && (
          <Input placeholder="Port" value={port} onChange={setPort} type="number" />
        )}
        <Input placeholder="Username (optional)" value={username} onChange={setUsername} />
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit}>Save</Button>
      </div>
    </div>
  );
}