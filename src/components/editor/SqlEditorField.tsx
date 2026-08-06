import { useCallback } from "react";
import Editor, { type BeforeMount } from "@monaco-editor/react";
import { useSettingsStore } from "../../stores/settingsStore";

interface SqlEditorFieldProps {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  readOnly?: boolean;
}

export function SqlEditorField({
  value,
  onChange,
  height = 140,
  readOnly = false,
}: SqlEditorFieldProps) {
  const editorFontFamily = useSettingsStore(
    (s) => s.settings?.editor_font_family ?? "Space Mono",
  );
  const editorFontSize = useSettingsStore(
    (s) => s.settings?.editor_font_size ?? 13,
  );
  const editorTabSize = useSettingsStore(
    (s) => s.settings?.editor_tab_size ?? 4,
  );

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
    <div className="h-full min-h-0" data-testid="sql-editor-field">
      <Editor
        height={height}
        language="sql"
        theme="gridline-sql"
        beforeMount={handleBeforeMount}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={{
          minimap: { enabled: false },
          fontSize: editorFontSize,
          fontFamily: editorFontFamily,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          readOnly,
          automaticLayout: true,
          tabSize: editorTabSize,
        }}
      />
    </div>
  );
}