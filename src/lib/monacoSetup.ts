/**
 * Local Monaco setup — bundles monaco-editor with the app so no CDN is
 * needed and the editor works fully offline.
 *
 * Must be imported once, before any @monaco-editor/react <Editor /> mounts.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

// Use the bundled editor worker (SQL has no dedicated language worker)
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Hand the already-imported monaco instance to @monaco-editor/react so it
// skips its CDN download entirely.
loader.config({ monaco });