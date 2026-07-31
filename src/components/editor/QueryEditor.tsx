import { useCallback } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Button } from "../ui/Button";
import { Play } from "lucide-react";

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  readOnly?: boolean;
}

export function QueryEditor({ value, onChange, onRun, readOnly = false }: QueryEditorProps) {
  const handleMount: OnMount = useCallback((editor) => {
    editor.addAction({
      id: "run-query",
      label: "Run Query",
      keybindings: [2048 | 3], // Cmd/Ctrl+Enter
      run: () => onRun(),
    });
    editor.focus();
  }, [onRun]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-muted font-mono">SQL</span>
        <Button onClick={onRun} disabled={readOnly}>
          <Play size={14} /> Run
        </Button>
      </div>
      <div className="flex-1 min-h-[120px] border border-border rounded-xl overflow-hidden">
        <Editor
          height="100%"
          language="sql"
          theme="vs-dark"
          value={value}
          onChange={(v) => onChange(v ?? "")}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'Space Mono', 'Fira Code', monospace",
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "off",
            readOnly,
            padding: { top: 8, bottom: 8 },
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}