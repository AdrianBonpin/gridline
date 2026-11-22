import { describe, it, expect } from "vitest";
// Import the docs as raw strings (vite/client declares `*?raw`); this keeps the
// test free of a `node:fs` dependency so `tsc` (bun run build) stays clean.
import agents from "../../../AGENTS.md?raw";
import readme from "../../../README.md?raw";
import landing from "../../../www/public/landing.js?raw";
import landingPage from "../../../www/src/pages/index.astro?raw";
import roadmap from "../../../ROADMAP.md?raw";
import security from "../../../SECURITY.md?raw";

// Version numbers in the README, the landing page and the changelog are
// asserted once, in version.test.ts, and against the release version rather
// than a literal — this suite covers what the docs say beyond the number.
describe("docs coverage", () => {
  it("AGENTS.md marks inline cell editing complete", () => {
    expect(agents).toContain("Inline cell editing");
    expect(agents).toMatch(/Inline cell editing \| ✅/);
  });
  it("AGENTS.md marks indexes + constraints complete", () => {
    expect(agents).toMatch(/Indexes \(per table\) \| ✅/);
    expect(agents).toMatch(/Constraints \(CHECK, UNIQUE beyond PK\/FK\) \| ✅/);
  });
  it("AGENTS.md marks materialized views complete", () => {
    expect(agents).toMatch(/Materialized views \| ✅/);
  });
  it("AGENTS.md marks stored procedures complete", () => {
    expect(agents).toMatch(/Stored procedures \| ✅/);
  });
  it("AGENTS.md marks favorites + recents + status indicator complete", () => {
    expect(agents).toMatch(/Favorites \/ Recent connections \| ✅/);
    expect(agents).toMatch(/Connection status indicator on cards \| ✅/);
    expect(agents).toMatch(/Move-to-folder bulk action \| ✅/);
  });
  it("AGENTS.md marks schema CRUD complete", () => {
    expect(agents).toMatch(/Schema CRUD \| ✅/);
  });
  it("AGENTS.md marks global object search complete", () => {
    expect(agents).toMatch(/Global object search \| ✅/);
  });
  it("AGENTS.md marks copy-as-DDL complete", () => {
    expect(agents).toMatch(/Copy as DDL for any object \| ✅/);
  });
  it("AGENTS.md marks object dependencies complete", () => {
    expect(agents).toMatch(/Object dependencies \| ✅/);
  });
  it("README notes bundled PostgreSQL tools", () => {
    expect(readme.toLowerCase()).toContain("bundled");
  });
  it("README marks inline editing complete (not Upcoming)", () => {
    // Key Features lists inline editing as a shipped feature
    expect(readme).toMatch(/- \*\*Inline cell editing\*\* —/);
    // comparison-table row for the stage→commit queue carries the Gridline ✅ marker
    // (5-column table: Feature | DB Pro | Beekeeper | TablePlus | Gridline)
    expect(readme).toMatch(/Changes queue \(stage → commit\)\s*\|[^|]*❌[^|]*\|[^|]*\|[^|]*\|\s*\*\*✅ Queue → Commit All\*\*/);
    expect(readme).not.toMatch(/Inline cell editing.*Upcoming/);
  });
  it("AGENTS.md marks object management CRUD complete", () => {
    expect(agents).toMatch(/Object management CRUD \| ✅/);
  });
  it("AGENTS.md marks the keychain toggle complete", () => {
    expect(agents).toMatch(/Enable keychain toggle \| ✅/);
  });
  it("AGENTS.md marks the Objects view tabbed workspace complete", () => {
    expect(agents).toMatch(/Objects view tabbed workspace \| ✅/);
  });
  it("AGENTS.md marks xlsx/SQLite-dump/cancel/settings-import complete", () => {
    expect(agents).toMatch(/Excel \(\.xlsx\) export \| ✅/);
    expect(agents).toMatch(/Cancel long-running queries \| ✅/);
    expect(agents).toMatch(/Settings export\/import \| ✅/);
  });
  it("README download tables name the versioned assets", () => {
    expect(readme).toContain("releases/download/v");
    expect(readme).toContain("_aarch64.dmg");
    expect(readme).toContain("-1.x86_64.rpm");
  });
  it("landing.js builds its download links from a version const", () => {
    expect(landing).toContain("const version =");
  });
  it("AGENTS.md documents the native MySQL restore and the .sql association", () => {
    // These claims would actively mislead the next contributor if they were
    // missing, which is why they are asserted rather than trusted to review.
    expect(agents).toMatch(/\.sql/);
    expect(agents.toLowerCase()).toContain("in-process");
  });
  it("documents the private vulnerability disclosure channel", () => {
    expect(readme).toContain("## Security");
    expect(readme).toContain("security/advisories/new");
    expect(readme).toContain("SECURITY.md");
    expect(agents).toContain("SECURITY.md");
    expect(agents.toLowerCase()).toContain("vulnerabilit");
  });
});

describe("Linux support surface and issue #62", () => {
  it("README points users at the Linux support and troubleshooting section", () => {
    expect(readme).toContain("## Linux support and troubleshooting");
    expect(readme).toContain("#linux-support-and-troubleshooting");
  });
  it("README no longer claims every Linux distribution works", () => {
    // "Works on every distro" was an unevidenced promise; the replacement states
    // what is built and tested (Ubuntu 22.04, glibc 2.35, x86_64 only).
    expect(readme.toLowerCase()).not.toContain("works on every distro");
    expect(readme).toMatch(/\*\*not\*\* verified on every Linux distribution/);
    expect(readme).toContain("glibc 2.35");
    expect(readme).toContain("x86_64 only");
  });
  it("README troubleshooting requests the evidence a black-window report needs", () => {
    // Exact distribution release, session type, GPU/driver, terminal output.
    expect(readme).toContain("/etc/os-release");
    expect(readme).toContain("XDG_SESSION_TYPE");
    expect(readme).toContain("lspci -k");
    expect(readme).toContain("glxinfo -B");
    expect(readme).toContain("--appimage-extract-and-run");
  });
  it("README documents the graphics workaround ladder and what each step isolates", () => {
    expect(readme).toContain("WEBKIT_DISABLE_DMABUF_RENDERER=1");
    expect(readme).toContain("WEBKIT_DISABLE_COMPOSITING_MODE=1");
    expect(readme).toContain("LIBGL_ALWAYS_SOFTWARE=1");
    expect(readme).toContain("GDK_BACKEND=x11");
    // Diagnostics only: the app must not bake a graphics override in.
    expect(readme).toContain("They are diagnostics, not fixes Gridline ships");
  });
  it("README records #62 as open with no root cause and no shipped fix", () => {
    expect(readme).toContain("issues/62");
    expect(readme).toContain("the root cause is not identified and no fix has shipped");
    expect(readme).toMatch(/it stays \*\*open\*\*, with no root cause and no shipped fix/i);
  });
  it("landing.js stops guessing macOS architecture and Linux package from the user agent", () => {
    // Both are undetectable in a browser, so those visitors get the explicit list.
    expect(landing).not.toContain("x86_64.rpm");
    expect(landing).not.toContain("aarch64.dmg");
    expect(landing).toContain('const choicesUrl = "#download"');
  });
  it("the landing page lists every macOS architecture and Linux package explicitly", () => {
    expect(landingPage).toContain("Gridline_${version}_aarch64.dmg");
    expect(landingPage).toContain("Gridline_${version}_x64.dmg");
    expect(landingPage).toContain("Gridline_${version}_amd64.deb");
    expect(landingPage).toContain("Gridline-${version}-1.x86_64.rpm");
    expect(landingPage).toContain("Gridline_${version}_amd64.AppImage");
    expect(landingPage).toContain("issues/62");
  });
});

describe("v0.8.3 tool resolver docs", () => {
  it("AGENTS.md documents the unified resolver and the nested resource path", () => {
    expect(agents).toContain("tool_resolver");
    expect(agents).toContain("resources/pg_tools");
    expect(agents).toContain("resources/mysql_tools");
  });
  it("AGENTS.md documents that both engines share the resolver", () => {
    expect(agents).toMatch(/mariadb-dump.*mysqldump|mysqldump.*mariadb-dump/s);
  });
  it("ROADMAP describes MySQL backup via mariadb-dump/mysqldump", () => {
    expect(roadmap).toContain("mariadb-dump");
  });
});

describe("SECURITY.md disclosure policy", () => {
  it("routes reports to the private advisory form, not public issues", () => {
    expect(security).toContain("security/advisories/new");
    expect(security.toLowerCase()).toContain("do not open a public issue");
  });

  it("documents the threat model of the destructive-query guard", () => {
    expect(security).toContain("not an authorization boundary");
  });

  it("documents that the Gitea mirror has no private reporting", () => {
    expect(security).toContain("Report against GitHub only");
  });

  it("states a coordinated-disclosure window", () => {
    expect(security).toContain("90 days");
  });
});