/**
 * Version statements — every place the project publishes its release number.
 *
 * Gridline states its release version in the two package manifests, the Rust
 * manifest, the Cargo lockfile, the Tauri bundle config, the landing page and
 * its script, the changelog, the README and the roadmap. A release that bumps
 * one and misses another ships an installer that reports a version the
 * website, the README or `cargo` disagrees with, and nothing fails — the
 * mismatch is only visible to whoever downloads the wrong file.
 *
 * `version.test.ts` therefore reads all of them through the extractors below
 * and fails when any statement disagrees with `desktop/package.json`. The
 * extractors are pure string functions on purpose: the same code that checks
 * the real files is fed a doctored copy in the test that proves a mismatch
 * actually fails, so the consistency check cannot quietly become vacuous.
 */

/** What kind of statement a version came from. Used to catch a vanished statement. */
export type VersionKind =
  | "root manifest"
  | "desktop manifest"
  | "rust manifest"
  | "lockfile"
  | "bundle config"
  | "landing page"
  | "landing script"
  | "changelog"
  | "readme"
  | "roadmap";

export interface VersionStatement {
  /** Human-readable location, e.g. `desktop/src-tauri/Cargo.toml`. */
  source: string;
  kind: VersionKind;
  /**
   * The version stated there, or `null` when the source no longer states one.
   * `null` counts as a mismatch: a statement that disappeared means the
   * consistency check silently stopped covering that place.
   */
  version: string | null;
}

/** Every kind that must be represented. A missing kind fails the suite. */
export const REQUIRED_STATEMENT_KINDS: VersionKind[] = [
  "root manifest",
  "desktop manifest",
  "rust manifest",
  "lockfile",
  "bundle config",
  "landing page",
  "landing script",
  "changelog",
  "readme",
  "roadmap",
];

/** `MAJOR.MINOR.PATCH` — the only shape a release version may take. */
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/** Compare two `MAJOR.MINOR.PATCH` versions; negative when `a` precedes `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10));
  const pb = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** `version` from a parsed JSON manifest (`package.json`, `tauri.conf.json`). */
export function jsonVersion(manifest: unknown): string | null {
  if (typeof manifest !== "object" || manifest === null) return null;
  const value = (manifest as { version?: unknown }).version;
  return typeof value === "string" ? value : null;
}

/**
 * `version` from the `[package]` table of a Cargo manifest.
 *
 * Scoped to `[package]` on purpose: dependency tables carry their own
 * `version = "…"` lines, and a blanket scan would happily report a dependency's
 * version as the project's.
 */
export function extractCargoPackageVersion(toml: string): string | null {
  const start = toml.search(/^\[package\]$/m);
  if (start === -1) return null;
  const rest = toml.slice(start + "[package]".length);
  const nextSection = rest.search(/^\[/m);
  const section = nextSection === -1 ? rest : rest.slice(0, nextSection);
  const match = section.match(/^version\s*=\s*"([^"]+)"$/m);
  return match ? match[1] : null;
}

/**
 * Every `version` recorded for `name` in a `Cargo.lock`.
 *
 * Returned as a list, not a single value: a lockfile legitimately holds several
 * packages with the same name (`sqlx` and friends share numbers), so the caller
 * decides whether "exactly one entry for `gridline`" holds.
 */
export function extractCargoLockPackageVersions(lock: string, name: string): string[] {
  const blocks = lock.split(/^\[\[package\]\]$/m).slice(1);
  const namePattern = new RegExp(`^name\\s*=\\s*"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`, "m");
  return blocks
    .filter((block) => namePattern.test(block))
    .map((block) => block.match(/^version\s*=\s*"([^"]+)"$/m)?.[1])
    .filter((version): version is string => typeof version === "string");
}

/** `const version = "…"` from a landing page or script. */
export function extractConstVersion(source: string, name = "version"): string | null {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*"([^"]+)"`));
  return match ? match[1] : null;
}

/** Changelog entry versions in file order (newest first by convention). */
export function extractChangelogVersions(source: string): string[] {
  return [...source.matchAll(/^\s*version:\s*"([^"]+)",?$/gm)].map((match) => match[1]);
}

/** Versions of the `## ✅ Shipped (x.y.z)` headings in the roadmap, in file order. */
export function extractRoadmapShippedVersions(roadmap: string): string[] {
  return [...roadmap.matchAll(/^##\s*✅\s*Shipped \((\d+\.\d+\.\d+)\)/gm)].map((match) => match[1]);
}

/**
 * Release-version statements in the README.
 *
 * The README also carries the *history* of past releases, where older versions
 * are correct and must not be "fixed". Only the statements that describe the
 * current release — download URLs, asset names, the "current release" banners,
 * the static-link maintenance note and the tagging commands — are extracted.
 */
export const README_RELEASE_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "download URL", pattern: /releases\/download\/v(\d+\.\d+\.\d+)\//g },
  { label: "asset name", pattern: /Gridline[_-](\d+\.\d+\.\d+)[_-]/g },
  { label: "current release banner", pattern: /current release \(\*\*v(\d+\.\d+\.\d+)\*\*\)/g },
  { label: "static-link maintenance note", pattern: /point at the v(\d+\.\d+\.\d+)/g },
  { label: "tag command", pattern: /git tag v(\d+\.\d+\.\d+)/g },
  { label: "tag push command", pattern: /git push github v(\d+\.\d+\.\d+)/g },
  { label: "release notes command", pattern: /gh release edit v(\d+\.\d+\.\d+)/g },
];

export function extractReadmeReleaseVersions(readme: string): { label: string; version: string }[] {
  return README_RELEASE_PATTERNS.flatMap(({ label, pattern }) =>
    [...readme.matchAll(new RegExp(pattern.source, pattern.flags))].map((match) => ({
      label,
      version: match[1],
    })),
  );
}

/** Everything needed to collect version statements, as raw text or parsed JSON. */
export interface VersionSources {
  rootPackageJson: unknown;
  desktopPackageJson: unknown;
  tauriConf: unknown;
  cargoToml: string;
  cargoLock: string;
  indexAstro: string;
  landingJs: string;
  changelog: string;
  readme: string;
  roadmap: string;
}

/**
 * Every version statement in the project, in a stable order.
 *
 * Order matters only for reading the failures; the values are compared against
 * the canonical version independently.
 */
export function collectVersionStatements(sources: VersionSources): VersionStatement[] {
  const lockfileVersions = extractCargoLockPackageVersions(sources.cargoLock, "gridline");
  const changelogVersions = extractChangelogVersions(sources.changelog);
  const roadmapVersions = extractRoadmapShippedVersions(sources.roadmap);

  return [
    { kind: "desktop manifest", source: "desktop/package.json", version: jsonVersion(sources.desktopPackageJson) },
    { kind: "root manifest", source: "package.json", version: jsonVersion(sources.rootPackageJson) },
    { kind: "rust manifest", source: "desktop/src-tauri/Cargo.toml", version: extractCargoPackageVersion(sources.cargoToml) },
    {
      kind: "lockfile",
      // A duplicated `gridline` entry is itself a defect, so it reads as "no
      // single version" rather than silently picking one.
      source: "desktop/src-tauri/Cargo.lock",
      version: lockfileVersions.length === 1 ? lockfileVersions[0] : null,
    },
    { kind: "bundle config", source: "desktop/src-tauri/tauri.conf.json", version: jsonVersion(sources.tauriConf) },
    { kind: "landing page", source: "www/src/pages/index.astro", version: extractConstVersion(sources.indexAstro) },
    { kind: "landing script", source: "www/public/landing.js", version: extractConstVersion(sources.landingJs) },
    { kind: "changelog", source: "www/src/data/changelog.ts (newest entry)", version: changelogVersions[0] ?? null },
    { kind: "roadmap", source: "ROADMAP.md (newest shipped section)", version: roadmapVersions[0] ?? null },
    ...extractReadmeReleaseVersions(sources.readme).map(({ label, version }) => ({
      kind: "readme" as const,
      source: `README.md (${label})`,
      version,
    })),
  ];
}

/**
 * Statements that disagree with `canonical`, as readable messages.
 *
 * An empty array means every statement agrees. This is the whole point of the
 * module: one list, one comparison, one failure message that names the file.
 */
export function findVersionMismatches(canonical: string, statements: VersionStatement[]): string[] {
  return statements
    .filter((statement) => statement.version !== canonical)
    .map(
      (statement) =>
        `${statement.source} states ${statement.version ?? "(no version found)"}, expected ${canonical}`,
    );
}

/** Version kinds that `statements` do not cover (a statement disappeared). */
export function missingStatementKinds(statements: VersionStatement[]): VersionKind[] {
  return REQUIRED_STATEMENT_KINDS.filter((kind) => !statements.some((statement) => statement.kind === kind));
}
