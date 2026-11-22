import { describe, it, expect } from "vitest";
import desktopPkg from "../../package.json";
import rootPkg from "../../../package.json";
import tauriConf from "../../src-tauri/tauri.conf.json";
import cargoToml from "../../src-tauri/Cargo.toml?raw";
import cargoLock from "../../src-tauri/Cargo.lock?raw";
import indexAstro from "../../../www/src/pages/index.astro?raw";
import landingJs from "../../../www/public/landing.js?raw";
import changelog from "../../../www/src/data/changelog.ts?raw";
import readme from "../../../README.md?raw";
import roadmap from "../../../ROADMAP.md?raw";
import {
  SEMVER_PATTERN,
  collectVersionStatements,
  compareVersions,
  extractCargoLockPackageVersions,
  extractChangelogVersions,
  extractRoadmapShippedVersions,
  findVersionMismatches,
  missingStatementKinds,
  type VersionSources,
} from "./versionStatements";

/**
 * The one version every other statement must match.
 *
 * `desktop/package.json` is the canonical source: it is the manifest the
 * release workflow and the app shell both read, and it is bumped first on every
 * release. Everything else — the Rust manifest and lockfile, the Tauri bundle
 * config, the root manifest, the landing page, the changelog, the README and
 * the roadmap — is compared against it, so a release that misses one of them
 * fails here instead of shipping.
 *
 * Before this test the check was spread over three files with the expected
 * value hard-coded in each (`toBe("0.8.4")`), which meant a bump had to be
 * remembered in all of them and the README/landing assertions only checked that
 * *some* version string was present rather than the right one.
 */
const CANONICAL = desktopPkg.version;

const realSources: VersionSources = {
  rootPackageJson: rootPkg,
  desktopPackageJson: desktopPkg,
  tauriConf,
  cargoToml,
  cargoLock,
  indexAstro,
  landingJs,
  changelog,
  readme,
  roadmap,
};

const statements = collectVersionStatements(realSources);

describe("release version consistency", () => {
  it("states a MAJOR.MINOR.PATCH release version", () => {
    expect(CANONICAL, "desktop/package.json carries the canonical version").toMatch(SEMVER_PATTERN);
  });

  // One test per statement: a failure names the file that disagrees instead of
  // leaving the reader to diff a 30-line "expected [...] to deeply equal [...]".
  for (const statement of statements) {
    it(`${statement.source} states ${CANONICAL}`, () => {
      expect(
        statement.version,
        `${statement.source} states ${statement.version ?? "(no version found)"} but the release is ${CANONICAL}`,
      ).toBe(CANONICAL);
    });
  }

  it("has no version statement that disagrees with the release version", () => {
    expect(findVersionMismatches(CANONICAL, statements)).toEqual([]);
  });

  it("covers every place a version statement is expected", () => {
    // Guards against the check going quiet: if a manifest stops being read (a
    // path moves, an import is dropped) the statement disappears rather than
    // failing, and the suite would pass while covering less.
    expect(missingStatementKinds(statements)).toEqual([]);
  });

  it("covers both README download tables and the release commands", () => {
    // The README has two download tables plus the banner, the static-link
    // maintenance note and the tagging commands; if a rewrite drops them the
    // per-statement tests above would pass on fewer statements.
    const readmeStatements = statements.filter((statement) => statement.kind === "readme");
    expect(readmeStatements.length).toBeGreaterThanOrEqual(20);
    expect(readmeStatements.filter((statement) => statement.source.includes("current release banner"))).toHaveLength(2);
    expect(readmeStatements.some((statement) => statement.source.includes("tag command"))).toBe(true);
    expect(readmeStatements.some((statement) => statement.source.includes("release notes command"))).toBe(true);
  });

  it("finds exactly one gridline entry in the Cargo lockfile", () => {
    // Found by package name, never by version: unrelated packages legitimately
    // share the release number (this lockfile also holds `aes 0.8.4`), which is
    // exactly why a blanket search-and-replace in Cargo.lock is unsafe.
    expect(extractCargoLockPackageVersions(cargoLock, "gridline")).toEqual([CANONICAL]);
  });

  it("leads the roadmap with the shipped release", () => {
    expect(extractRoadmapShippedVersions(roadmap)[0]).toBe(CANONICAL);
    expect(
      extractRoadmapShippedVersions(roadmap).filter((version) => compareVersions(version, CANONICAL) > 0),
      "no roadmap section may claim a release newer than the release version",
    ).toEqual([]);
  });

  it("leads the changelog with the release entry and nothing newer", () => {
    expect(extractChangelogVersions(changelog)[0]).toBe(CANONICAL);
    expect(
      extractChangelogVersions(changelog).filter((version) => compareVersions(version, CANONICAL) > 0),
      "no changelog entry may be newer than the release version",
    ).toEqual([]);
  });
});

describe("stale-version detection", () => {
  it("reports the file that disagrees instead of passing", () => {
    // The same code path as above, fed a manifest that was not bumped. Without
    // this the consistency check could degrade to "always empty" unnoticed.
    const stale = collectVersionStatements({
      ...realSources,
      rootPackageJson: { ...rootPkg, version: "0.0.1" },
    });
    const mismatches = findVersionMismatches(CANONICAL, stale);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain("package.json");
    expect(mismatches[0]).toContain("0.0.1");
  });

  it("reports every stale statement, not just the first", () => {
    const stale = collectVersionStatements({
      ...realSources,
      cargoToml: cargoToml.replace(/^version\s*=.*$/m, 'version = "0.7.9"'),
      readme: readme.replace(/current release \(\*\*v[^*]+\*\*\)/g, "current release (**v0.7.9**)"),
    });
    const mismatches = findVersionMismatches(CANONICAL, stale);
    expect(mismatches.some((message) => message.includes("Cargo.toml"))).toBe(true);
    expect(mismatches.some((message) => message.includes("current release banner"))).toBe(true);
  });

  it("treats a missing statement as a mismatch", () => {
    const broken = collectVersionStatements({
      ...realSources,
      cargoToml: cargoToml.replace(/^\[package\]$/m, "[lib]"),
      indexAstro: indexAstro.replace(/const version = "[^"]+";/, ""),
    });
    const mismatches = findVersionMismatches(CANONICAL, broken);
    expect(mismatches.some((message) => message.includes("Cargo.toml"))).toBe(true);
    expect(mismatches.some((message) => message.includes("index.astro"))).toBe(true);
  });

  it("does not read a dependency's version as the project's", () => {
    // `version = "2"` is a tauri-build dependency, not the app version, and the
    // `[package]` table is not required to come first in a Cargo manifest.
    const withDependenciesFirst = [
      "[build-dependencies]",
      'tauri-build = { version = "2", features = [] }',
      "",
      "[package]",
      'name = "gridline"',
      'version = "0.9.9"',
      "",
    ].join("\n");
    const statementsFor = collectVersionStatements({ ...realSources, cargoToml: withDependenciesFirst });
    expect(statementsFor.find((statement) => statement.kind === "rust manifest")?.version).toBe("0.9.9");
  });

  it("ranks versions numerically when checking for a newer entry", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.8.4", "0.8.4")).toBe(0);
    expect(compareVersions("0.7.15", "0.8.0")).toBeLessThan(0);
  });
});
