/**
 * Local Monaco setup — bundles monaco-editor with the app so no CDN is
 * needed and the editor works fully offline.
 *
 * Must be imported once, before any @monaco-editor/react <Editor /> mounts.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { useDbViewerStore } from "../stores/dbViewerStore";
import { buildSqlSuggestions } from "./sqlCompletion";

// Use the bundled editor worker (SQL has no dedicated language worker)
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Hand the already-imported monaco instance to @monaco-editor/react so it
// skips its CDN download entirely.
loader.config({ monaco });

// SQL autocomplete: keywords + table names from the active schema. Reads the
// live store so suggestions stay in sync with the selected schema.
monaco.languages.registerCompletionItemProvider("sql", {
  provideCompletionItems: (
    model,
    position,
  ): monaco.languages.CompletionList => {
    const { tables, currentSchema } = useDbViewerStore.getState();
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    return {
      suggestions: buildSqlSuggestions(tables, currentSchema).map((s) => ({
        label: s.label,
        kind:
          s.kind === "keyword"
            ? monaco.languages.CompletionItemKind.Keyword
            : monaco.languages.CompletionItemKind.Struct,
        insertText: s.insertText,
        range,
      })),
    };
  },
});