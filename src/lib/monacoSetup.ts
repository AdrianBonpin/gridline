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
import { useUiStore } from "../stores/uiStore";
import {
  buildSqlSuggestions,
  buildColumnSuggestions,
  getColumnsForTable,
  getCachedColumns,
  parseTableRef,
} from "./sqlCompletion";

// Use the bundled editor worker (SQL has no dedicated language worker)
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Hand the already-imported monaco instance to @monaco-editor/react so it
// skips its CDN download entirely.
loader.config({ monaco });

// SQL autocomplete:
//  - after `table.` (or `schema.table.`): suggest that table's columns
//    (fetched lazily via schema introspection and cached per schema)
//  - otherwise: keywords + table names from the active schema
monaco.languages.registerCompletionItemProvider("sql", {
  provideCompletionItems: (
    model,
    position,
  ): monaco.languages.CompletionList | Promise<monaco.languages.CompletionList> => {
    const { tables, currentSchema } = useDbViewerStore.getState();
    const line = model.getLineContent(position.lineNumber);
    const before = line.slice(0, position.column - 1);
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    const withRange = (s: { label: string; insertText: string; kind: string }) => ({
      label: s.label,
      insertText: s.insertText,
      kind:
        s.kind === "keyword"
          ? monaco.languages.CompletionItemKind.Keyword
          : s.kind === "table"
            ? monaco.languages.CompletionItemKind.Struct
            : monaco.languages.CompletionItemKind.Field,
      range,
    });

    const tableRef = parseTableRef(before);
    if (tableRef) {
      const schema = tableRef.schema ?? currentSchema;
      const connectionId = useUiStore.getState().activeConnectionId;
      const cached = schema ? getCachedColumns(schema, tableRef.table) : undefined;
      if (cached) {
        return {
          suggestions: buildColumnSuggestions(cached).map(withRange),
        };
      }
      // Not introspected yet: warm the cache in the background and ask Monaco
      // to re-request once the columns are available.
      void getColumnsForTable(connectionId, schema, tableRef.table);
      return { suggestions: [], incomplete: true };
    }

    return {
      suggestions: buildSqlSuggestions(tables, currentSchema).map(withRange),
    };
  },
});