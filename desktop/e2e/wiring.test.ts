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
    expect(ci).toMatch(/uses: actions\/upload-artifact@v\d+/);
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
