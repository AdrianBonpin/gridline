// Bun test runner setup: register testing-library cleanup (bun does not inject
// a global `afterEach`, so RTL's auto-cleanup never hooks in) and minimal
// vitest-compat shims for `vi.mocked`/`vi.hoisted` (bun's compat `vi` omits
// them). Loaded via bunfig.toml [test].preload — bun-dom.ts must run first so
// `document` exists before @testing-library/react evaluates.
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

// NOTE: under `bun test`, importing from "vitest" resolves to bun's built-in
// vitest-compat module (which provides afterEach and a limited vi), while under
// `tsc` it resolves to the real vitest types.

// @testing-library/react auto-cleanup relies on a global `afterEach`, which
// bun does not inject; register it explicitly so DOM doesn't leak between tests.
afterEach(() => {
  cleanup();
});

// Minimal vi shims matching vitest semantics used by the suite.
(vi as unknown as { mocked: unknown }).mocked = (m: unknown) => m;
(vi as unknown as { hoisted: unknown }).hoisted = <T>(factory: () => T): T =>
  factory();