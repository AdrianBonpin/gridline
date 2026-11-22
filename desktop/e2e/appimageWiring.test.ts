import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Mirror of `scripts/check-workflows.sh` check 4: an expression interpolated
 * inside a `run:` body is script injection, so it must be passed via `env:`.
 */
function runBodyInterpolations(yaml: string): string[] {
  const offenders: string[] = [];
  let runIndent: number | null = null;

  yaml.split(/\r?\n/).forEach((line, index) => {
    const indent = indentOf(line);
    if (runIndent !== null) {
      if (line.trim() === "") return;
      if (indent > runIndent) {
        if (line.includes("${{")) offenders.push(`${index + 1}: ${line.trim()}`);
        return;
      }
      runIndent = null;
    }
    if (/^\s*(-\s+)?run:\s*[|>]/.test(line)) {
      runIndent = indent;
      return;
    }
    if (/^\s*(-\s+)?run:/.test(line) && line.includes("${{")) {
      offenders.push(`${index + 1}: ${line.trim()}`);
    }
  });

  return offenders;
}

describe("packaged AppImage smoke wiring", () => {
  it("exposes documented commands on the desktop workspace and the root", () => {
    const desktop = JSON.parse(read("desktop/package.json"));
    expect(desktop.scripts["e2e:appimage"]).toContain("e2e/appimageSmoke.mjs");

    const root = JSON.parse(read("package.json"));
    expect(root.scripts["e2e:appimage"]).toBe("bun run --filter gridline-desktop e2e:appimage");
  });

  it("runs nightly, manually and after a Release run", () => {
    const workflow = read(".github/workflows/appimage-smoke.yml");
    expect(workflow).toMatch(/^on:\s*$/m);
    expect(workflow).toMatch(/schedule:/);
    expect(workflow).toMatch(/cron:\s*'[^']+'/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/workflow_run:/);
    expect(workflow).toMatch(/workflows:\s*\['Release'\]/);
  });

  it("smokes the release artifact through its normal launcher", () => {
    const workflow = read(".github/workflows/appimage-smoke.yml");
    // The artifact comes from the Release run or the published release…
    expect(workflow).toContain("appimage-linux-x86_64");
    expect(workflow).toContain("gh release download");
    // …then is launched as a .AppImage, never as an extracted inner binary.
    expect(workflow).toContain('--appimage "$appimage"');
    expect(workflow).toContain("dist/*.AppImage");
    expect(workflow).not.toMatch(/squashfs-root\/usr\/bin/);
    expect(workflow).not.toMatch(/\.\/AppRun/);
    expect(workflow).toMatch(/bun run --filter gridline-desktop e2e:appimage/);
  });

  it("passes every launch an absolute AppImage path", () => {
    const workflow = read(".github/workflows/appimage-smoke.yml");
    // `bun run --filter gridline-desktop` runs the smoke with its cwd set to
    // `desktop/`, while the artifact is downloaded into the repo root. A
    // repo-root-relative argument resolves to `desktop/dist/...`, which is empty
    // — that shipped once and made every smoke job fail with "AppImage not
    // found" before it ever launched the package. Every launch site therefore
    // has to hand over an absolute path.
    const launchSites = workflow.match(/appimage="\$PWD\/\$\(ls dist\/\*\.AppImage/g) ?? [];
    expect(launchSites).toHaveLength(3);
    expect(workflow).not.toMatch(/\n\s*appimage="\$\(ls dist\/\*\.AppImage/);
  });

  it("installs the container's tooling before anything that needs it", () => {
    const workflow = read(".github/workflows/appimage-smoke.yml");
    const fedora = workflow.slice(workflow.indexOf("  smoke-fedora:"));
    // A bare `fedora:latest` has no `unzip`, and oven-sh/setup-bun unpacks its
    // download with it: setting Bun up first failed the job before the smoke ran.
    const tools = fedora.indexOf("dnf install");
    // Anchored on the `uses:` line, not the word: the explanatory comment above
    // the tools step names the action too.
    const bun = fedora.indexOf("uses: oven-sh/setup-bun");
    expect(tools).toBeGreaterThan(-1);
    expect(bun).toBeGreaterThan(-1);
    expect(tools).toBeLessThan(bun);
    expect(fedora.slice(tools, bun)).toMatch(/\bunzip\b/);
  });

  it("hands the AppImage from the release build to this lane", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain("name: appimage-linux-x86_64");
    expect(release).toContain("desktop/src-tauri/target/release/bundle/appimage/*.AppImage");
    expect(release).toMatch(
      /uses: actions\/upload-artifact@[0-9a-f]{40}\b[^\n]*\n\s+with:\n\s+name: appimage-linux-x86_64/,
    );
  });

  it("labels the Fedora run as cross-distribution compatibility only", () => {
    const workflow = read(".github/workflows/appimage-smoke.yml");
    expect(workflow).toMatch(/smoke-fedora:/);
    expect(workflow).toMatch(/cross-distribution/i);
    // A Fedora container result must not be able to gate the lane…
    const fedora = workflow.slice(workflow.indexOf("smoke-fedora:"));
    expect(fedora).toContain("continue-on-error: true");
    // …and it uses the documented extract-and-run path (no /dev/fuse).
    expect(fedora).toContain("--extract-and-run");
  });

  it("never claims to fix or close issue #62", () => {
    const files = [
      ".github/workflows/appimage-smoke.yml",
      "desktop/e2e/README.md",
      "desktop/e2e/appimageSmoke.mjs",
      "scripts/check-workflows.sh",
    ];
    const resolutionClaim = /(?:clos(?:e|es|ed|ing)|fix(?:es|ed|ing)?|resolv(?:e|es|ed|ing))\b/i;
    const negation = /(?:never|cannot|can not|\bnot\b|\bno\b|without|\bonly\b|nor\b)/i;
    for (const file of files) {
      for (const line of read(file).split(/\r?\n/)) {
        if (!line.includes("#62")) continue;
        // A caveat ("never closes #62") is required; a claim is not.
        if (resolutionClaim.test(line) && !negation.test(line)) {
          throw new Error(`${file} claims a #62 resolution: ${line.trim()}`);
        }
      }
    }
    const workflow = read(".github/workflows/appimage-smoke.yml");
    expect(workflow).toMatch(/never close|can never close|cannot close/i);
  });

  it("keeps the lane least-privilege and injection-safe", () => {
    const workflow = read(".github/workflows/appimage-smoke.yml");
    // Workflow-level default-deny, then a per-job block for every job.
    expect(workflow).toMatch(/^permissions:\s*\{\}\s*$/m);
    for (const job of ["resolve", "smoke", "smoke-pristine", "smoke-fedora"]) {
      expect(workflow, `job ${job} must declare permissions`).toMatch(
        new RegExp(`${job}:\\n(?:.*\\n){0,20}?\\s+permissions:`),
      );
    }
    expect(runBodyInterpolations(workflow)).toEqual([]);
    // Every action is pinned to a full commit SHA.
    for (const match of workflow.matchAll(/uses:\s*(\S+)/g)) {
      const reference = match[1];
      if (reference.startsWith("./")) continue;
      expect(reference, `${reference} must be SHA-pinned`).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("documents the lane in the harness README", () => {
    const readme = read("desktop/e2e/README.md");
    expect(readme).toContain("AppImage smoke");
    expect(readme).toContain("e2e:appimage");
    expect(readme).toContain("--appimage-extract-and-run");
    expect(readme).toMatch(/issue #62/);
  });
});
