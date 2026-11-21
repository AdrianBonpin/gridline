import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

describe("desktop E2E wiring", () => {
  it("exposes a documented command on the desktop workspace and the root", () => {
    const desktop = JSON.parse(read("desktop/package.json"));
    expect(desktop.scripts.e2e).toContain("e2e/run.mjs");
    expect(desktop.scripts["e2e:build"]).toBe("tauri build --no-bundle");

    const root = JSON.parse(read("package.json"));
    expect(root.scripts["e2e:desktop"]).toBe("bun run --filter gridline-desktop e2e");
    expect(root.scripts["e2e:desktop:build"]).toBe(
      "bun run --filter gridline-desktop e2e:build",
    );
  });

  it("runs on pull requests, but only for changes that can affect the desktop app", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/^on:\s*$/m);
    expect(ci).toMatch(/pull_request:/);
    expect(ci).toMatch(/desktop-e2e:/);
    expect(ci).toContain("needs.changes.outputs.desktop");
  });

  it("gates the job on every dependency that can change what the app renders", () => {
    // The changed-file pattern is the whole gating contract: a path that fails
    // to match means the built product is never exercised for that change, so
    // the desktop frontend, the Tauri backend (viewer state + commands) and the
    // dependency manifests/lockfiles all have to be covered.
    const ci = read(".github/workflows/ci.yml");
    const pattern = /grep -Eq '([^']+)' changed-files\.txt/.exec(ci);
    expect(pattern, "ci.yml must diff changed files against a documented pattern").not.toBeNull();
    const matches = new RegExp(pattern![1]);

    for (const path of [
      // desktop frontend + viewer state
      "desktop/src/components/db-viewer/DataGrid.tsx",
      "desktop/src/stores/viewerStore.ts",
      // Tauri command behavior
      "desktop/src-tauri/src/commands/query.rs",
      // dependency changes
      "desktop/package.json",
      "bun.lock",
      "package.json",
      // the harness's own gate
      ".github/workflows/ci.yml",
    ]) {
      expect(matches.test(path), `${path} must trigger the desktop e2e job`).toBe(true);
    }

    for (const path of ["docs/tickets/github-audit-hardening/01-desktop-e2e-harness.md", "www/src/pages/index.astro"]) {
      expect(matches.test(path), `${path} must not trigger the desktop e2e job`).toBe(false);
    }
  });

  it("launches the built binary through tauri-driver on a headless display", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("webkit2gtk-driver");
    expect(ci).toContain("xvfb");
    expect(ci).toContain("cargo install tauri-driver --locked");
    expect(ci).toContain("bun run --filter gridline-desktop e2e:build");
    expect(ci).toMatch(/xvfb-run[^\n]*e2e/);
  });

  it("retains launch logs and screenshots when the job fails", () => {
    const ci = read(".github/workflows/ci.yml");
    // Pinned to a commit SHA, like every other action (scripts/check-workflows.sh).
    expect(ci).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40}\b/);
    expect(ci).toContain("desktop/e2e-artifacts");
    const uploadIndex = ci.indexOf("upload-artifact");
    const stepBeforeUpload = ci.slice(Math.max(0, uploadIndex - 400), uploadIndex);
    expect(stepBeforeUpload, "artifact upload must be failure-gated").toMatch(
      /if:\s*failure\(\)/,
    );
  });

  it("keeps harness artifacts out of version control", () => {
    expect(read(".gitignore")).toMatch(/e2e-artifacts/);
  });
});

describe("registered flows", () => {
  it("registers every flow in both the preflight list and the runner table", async () => {
    const { FLOWS } = await import("./preflight.mjs");
    const { FLOW_RUNNERS } = await import("./run.mjs");
    // A flow that exists in only one registry is unrunnable: preflight rejects
    // it as unknown, or the runner throws "no runner registered".
    expect(Object.keys(FLOW_RUNNERS).sort()).toEqual(Object.keys(FLOWS).sort());
    expect(FLOWS["composite-edit"]).toContain("composite-primary-key");
    expect(typeof FLOW_RUNNERS["composite-edit"]).toBe("function");
    expect(FLOWS["sqlite-rebuild"]).toContain("refused before staging");
    expect(typeof FLOW_RUNNERS["sqlite-rebuild"]).toBe("function");
  });

  it("documents the composite-key edit flow in the harness README", () => {
    const readme = read("desktop/e2e/README.md");
    expect(readme).toContain("composite-edit");
    expect(readme).toContain("sibling");
  });

  it("documents the SQLite rebuild flow in the harness README", () => {
    const readme = read("desktop/e2e/README.md");
    expect(readme).toContain("sqlite-rebuild");
    expect(readme).toContain("rebuild-refusal");
  });
});
