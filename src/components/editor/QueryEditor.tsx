import { useCallback } from "react";
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  readOnly?: boolean;
}

export function QueryEditor({
  value,
  onChange,
  onRun,
  readOnly = false,
}: QueryEditorProps) {
  const handleMount: OnMount = useCallback(
    (editor) => {
      editor.addAction({
        id: "run-query",
        label: "Run Query",
        keybindings: [2048 | 3], // Cmd/Ctrl+Enter
        run: () => onRun(),
      });
      editor.focus();

      // Custom fonts (@fontsource Space Mono) load asynchronously. Monaco
      // measures glyph widths at creation, so if the font lands after that the
      // cursor/selection drift rightward the further along the line you are.
      // Re-measure now (fonts may already be ready) and again once fonts load.
      const reMeasure = () => monaco.editor.remeasureFonts();
      reMeasure();
      try {
        void document.fonts?.load('13px "Space Mono"').then(() => {
          requestAnimationFrame(reMeasure);
          // WebKit can settle a frame late; re-measure once more to be safe
          setTimeout(reMeasure, 200);
        });
      } catch {
        // fonts API unavailable — nothing more we can do
      }
    },
    [onRun],
  );

  // Transparent editor background so the app's canvas shows through
  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    monaco.editor.defineTheme("gridline-sql", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#00000000",
        "editorGutter.background": "#00000000",
        "editor.lineHighlightBackground": "#ffffff08",
        "editorLineNumber.foreground": "#5b5b5e",
        "editorLineNumber.activeForeground": "#a1a1a6",
      },
    });
  }, []);

  return (
    <div className="h-full min-h-0" data-testid="query-editor">
      <Editor
        height="100%"
        language="sql"
        theme="gridline-sql"
        beforeMount={handleBeforeMount}
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
          placeholder: "Enter your SQL query…",
          automaticLayout: true,
        }}
      />
    </div>
  );
}