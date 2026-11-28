#!/usr/bin/env python3
"""Fail on dependency advisories that no reviewed exception covers.

Three trees are audited, because Gridline ships three resolved dependency graphs:

  * the Bun workspace (``bun.lock``), which is also the graph the website
    deploy installs (it builds from the repository root)  -> ``bun audit``
  * the standalone website install (``www/bun.lock``, used when
    ``www/`` is installed on its own)                     -> ``bun audit``
  * the Tauri backend (``desktop/src-tauri/Cargo.lock``)  -> ``cargo audit``

Every finding must match an entry in ``docs/security/dependency-exceptions.md``
(advisory id + ecosystem + package). The check fails when:

  * an audit reports a finding without a matching exception  (unreviewed)
  * an exception's ``review_by`` date has passed             (stale)
  * an exception matches no finding                          (obsolete)
  * a tree cannot be audited at all                          (fail closed)

Usage: scripts/check-advisories.py [--no-js] [--no-rust]
Exit:  0 = every finding is reviewed, 1 = something needs a human.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXCEPTIONS_FILE = REPO_ROOT / "docs" / "security" / "dependency-exceptions.md"
EXCEPTIONS_MARKER = "advisories:exceptions"
REVIEW_HORIZON_DAYS = 31
MAX_REVIEW_WINDOW_DAYS = 190  # a review date may be at most ~6 months out

REQUIRED_KEYS = {
    "advisory",
    "ecosystem",
    "package",
    "kind",
    "owner",
    "review_by",
    "rationale",
}
VALID_ECOSYSTEMS = {"cargo", "npm"}

GHSA_RE = re.compile(r"(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})", re.IGNORECASE)


class CheckError(RuntimeError):
    """A tree could not be audited, so the result cannot be trusted."""


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


def load_exceptions(today: datetime.date) -> tuple[list[dict], list[str]]:
    """Return the parsed exceptions plus any structural problems found."""
    problems: list[str] = []
    if not EXCEPTIONS_FILE.is_file():
        raise CheckError(f"missing exception list: {EXCEPTIONS_FILE}")

    text = EXCEPTIONS_FILE.read_text(encoding="utf-8")
    marker_at = text.find(EXCEPTIONS_MARKER)
    if marker_at == -1:
        raise CheckError(
            f"{EXCEPTIONS_FILE.name} has no '{EXCEPTIONS_MARKER}' marker; "
            "the machine-readable block cannot be located"
        )

    block = re.search(r"```json\s*\n(.*?)\n```", text[marker_at:], re.DOTALL)
    if not block:
        raise CheckError(
            f"{EXCEPTIONS_FILE.name} has no ```json block after the "
            f"'{EXCEPTIONS_MARKER}' marker"
        )
    try:
        payload = json.loads(block.group(1))
    except json.JSONDecodeError as exc:
        raise CheckError(f"{EXCEPTIONS_FILE.name}: invalid JSON block: {exc}") from exc

    entries = payload.get("exceptions")
    if not isinstance(entries, list):
        raise CheckError(f"{EXCEPTIONS_FILE.name}: JSON block has no 'exceptions' list")

    seen: set[tuple[str, str, str]] = set()
    for index, entry in enumerate(entries, start=1):
        where = f"exception #{index} ({entry.get('advisory', '?')})"
        missing = REQUIRED_KEYS - set(entry)
        if missing:
            problems.append(f"{where}: missing {', '.join(sorted(missing))}")
            continue
        if entry["ecosystem"] not in VALID_ECOSYSTEMS:
            problems.append(
                f"{where}: ecosystem must be one of {sorted(VALID_ECOSYSTEMS)}"
            )
        if not str(entry["owner"]).strip():
            problems.append(f"{where}: owner is empty")
        if len(str(entry["rationale"]).strip()) < 40:
            problems.append(f"{where}: rationale is too short to review")

        try:
            review_by = datetime.date.fromisoformat(str(entry["review_by"]))
        except ValueError:
            problems.append(f"{where}: review_by must be YYYY-MM-DD")
            continue
        if review_by < today:
            problems.append(
                f"{where}: review date {review_by} has passed — re-review or fix it"
            )
        elif (review_by - today).days > MAX_REVIEW_WINDOW_DAYS:
            problems.append(
                f"{where}: review date {review_by} is more than "
                f"{MAX_REVIEW_WINDOW_DAYS} days out"
            )

        key = (entry["ecosystem"], str(entry["advisory"]).upper(), entry["package"])
        if key in seen:
            problems.append(f"{where}: duplicate entry for {key[1]} / {key[2]}")
        seen.add(key)

    return entries, problems


# ---------------------------------------------------------------------------
# Audits
# ---------------------------------------------------------------------------


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env={**os.environ, "CI": os.environ.get("CI", "1")},
    )


def bun_audit(cwd: Path, label: str) -> list[dict]:
    result = run(["bun", "audit", "--json"], cwd)
    stdout = result.stdout.strip()
    if not stdout:
        raise CheckError(
            f"{label}: 'bun audit --json' produced no output "
            f"(exit {result.returncode}): {result.stderr.strip()}"
        )
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise CheckError(f"{label}: 'bun audit --json' is not JSON: {exc}") from exc

    findings: list[dict] = []
    for package, advisories in payload.items():
        if not isinstance(advisories, list):
            # Bun reports transport/registry problems as objects, not lists.
            raise CheckError(
                f"{label}: unexpected audit output for {package!r}: {advisories!r}"
            )
        for advisory in advisories:
            url = str(advisory.get("url", ""))
            ghsa = GHSA_RE.search(url)
            advisory_id = ghsa.group(1) if ghsa else f"npm-{advisory.get('id', '?')}"
            findings.append(
                {
                    "ecosystem": "npm",
                    "advisory": advisory_id,
                    "package": package,
                    "kind": str(advisory.get("severity", "unknown")),
                    "title": str(advisory.get("title", "")),
                    "versions": str(advisory.get("vulnerable_versions", "")),
                    "tree": label,
                }
            )
    return findings


def audit_workspace() -> list[dict]:
    lockfile = REPO_ROOT / "bun.lock"
    if not lockfile.is_file():
        raise CheckError(f"missing lockfile: {lockfile}")
    install = run(["bun", "install", "--frozen-lockfile"], REPO_ROOT)
    if install.returncode != 0:
        raise CheckError(
            "bun install --frozen-lockfile failed, so the lockfile cannot be "
            f"audited:\n{install.stderr.strip() or install.stdout.strip()}"
        )
    return bun_audit(REPO_ROOT, "workspace")


def audit_standalone_website() -> list[dict]:
    """Audit www/bun.lock on its own, the way an isolated `www/` build resolves it."""
    manifest = REPO_ROOT / "www" / "package.json"
    lockfile = REPO_ROOT / "www" / "bun.lock"
    for required in (manifest, lockfile):
        if not required.is_file():
            raise CheckError(f"missing {required.relative_to(REPO_ROOT)}")

    with tempfile.TemporaryDirectory(prefix="gridline-www-audit-") as tmp:
        tmp_path = Path(tmp)
        shutil.copy2(manifest, tmp_path / "package.json")
        shutil.copy2(lockfile, tmp_path / "bun.lock")
        install = run(
            ["bun", "install", "--frozen-lockfile", "--ignore-scripts"], tmp_path
        )
        if install.returncode != 0:
            raise CheckError(
                "the standalone website lockfile does not install: "
                f"{install.stderr.strip() or install.stdout.strip()}"
            )
        return bun_audit(tmp_path, "website (www/bun.lock)")


def audit_rust() -> list[dict]:
    crate_dir = REPO_ROOT / "desktop" / "src-tauri"
    if not (crate_dir / "Cargo.lock").is_file():
        raise CheckError(f"missing lockfile: {crate_dir / 'Cargo.lock'}")
    if shutil.which("cargo-audit") is None:
        raise CheckError(
            "cargo-audit is not installed (cargo install cargo-audit --locked); "
            "the Rust tree cannot be audited"
        )
    result = run(["cargo", "audit", "--json"], crate_dir)
    stdout = result.stdout.strip()
    if not stdout:
        raise CheckError(
            "cargo audit --json produced no output "
            f"(exit {result.returncode}): {result.stderr.strip()}"
        )
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise CheckError(f"'cargo audit --json' is not JSON: {exc}") from exc

    findings: list[dict] = []
    vulnerabilities = payload.get("vulnerabilities") or {}
    for item in vulnerabilities.get("list") or []:
        advisory = item.get("advisory") or {}
        package = item.get("package") or {}
        findings.append(
            {
                "ecosystem": "cargo",
                "advisory": str(advisory.get("id", "?")),
                "package": str(package.get("name", "?")),
                "kind": "vulnerability",
                "title": str(advisory.get("title", "")),
                "versions": str(package.get("version", "")),
                "tree": "rust",
            }
        )
    warnings = payload.get("warnings") or {}
    for kind, items in warnings.items():
        for item in items or []:
            advisory = item.get("advisory") or {}
            package = item.get("package") or {}
            findings.append(
                {
                    "ecosystem": "cargo",
                    "advisory": str(advisory.get("id", "?")),
                    "package": str(package.get("name", "?")),
                    "kind": kind,
                    "title": str(advisory.get("title", "")),
                    "versions": str(package.get("version", "")),
                    "tree": "rust",
                }
            )
    return findings


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def dedupe(findings: list[dict]) -> list[dict]:
    merged: dict[tuple[str, str, str], dict] = {}
    for finding in findings:
        key = (
            finding["ecosystem"],
            finding["advisory"].upper(),
            finding["package"],
        )
        if key in merged:
            existing = merged[key]
            if finding["kind"] == "vulnerability":
                existing["kind"] = "vulnerability"
            versions = {existing.get("versions", ""), finding.get("versions", "")}
            existing["versions"] = ", ".join(sorted(v for v in versions if v))
            trees = set(existing["tree"].split(", ")) | {finding["tree"]}
            existing["tree"] = ", ".join(sorted(trees))
            continue
        merged[key] = dict(finding)
    return sorted(
        merged.values(), key=lambda f: (f["tree"], f["package"], f["advisory"])
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-js", action="store_true", help="skip both Bun trees")
    parser.add_argument("--no-rust", action="store_true", help="skip the Rust tree")
    args = parser.parse_args()

    today = datetime.date.today()
    try:
        exceptions, problems = load_exceptions(today)
    except CheckError as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1

    findings: list[dict] = []
    audited_ecosystems: set[str] = set()
    try:
        if not args.no_js:
            findings += audit_workspace()
            findings += audit_standalone_website()
            audited_ecosystems.add("npm")
        if not args.no_rust:
            findings += audit_rust()
            audited_ecosystems.add("cargo")
    except CheckError as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1

    findings = dedupe(findings)
    reviewed = {
        (e["ecosystem"], str(e["advisory"]).upper(), e["package"]): e for e in exceptions
    }

    unreviewed = [
        f
        for f in findings
        if (f["ecosystem"], f["advisory"].upper(), f["package"]) not in reviewed
    ]
    # Only the ecosystems that were actually audited can show an entry is dead.
    obsolete = [
        e
        for key, e in reviewed.items()
        if key[0] in audited_ecosystems
        and key not in {(f["ecosystem"], f["advisory"].upper(), f["package"]) for f in findings}
    ]
    expiring = []
    for entry in exceptions:
        try:
            review_by = datetime.date.fromisoformat(str(entry["review_by"]))
        except ValueError:
            continue
        days = (review_by - today).days
        if 0 <= days <= REVIEW_HORIZON_DAYS:
            expiring.append((entry, days))

    print(
        f"audited: {len(findings)} active finding(s), "
        f"{len(exceptions)} reviewed exception(s)"
    )
    for finding in findings:
        tag = "reviewed" if finding not in unreviewed else "UNREVIEWED"
        print(
            f"  [{tag}] {finding['tree']}: {finding['advisory']} "
            f"{finding['package']} {finding['versions']} ({finding['kind']})"
        )

    for entry, days in expiring:
        print(
            f"NOTICE {entry['advisory']} ({entry['package']}) review date "
            f"{entry['review_by']} is {days} day(s) away",
            file=sys.stderr,
        )

    for problem in problems:
        print(f"FAIL {problem}", file=sys.stderr)
    for finding in unreviewed:
        print(
            f"FAIL unreviewed advisory {finding['advisory']} in {finding['package']} "
            f"({finding['tree']}): fix it, or add a reviewed exception to "
            f"{EXCEPTIONS_FILE.relative_to(REPO_ROOT)}",
            file=sys.stderr,
        )
    for entry in obsolete:
        print(
            f"FAIL obsolete exception {entry['advisory']} / {entry['package']} "
            f"({entry['ecosystem']}): no audit reports it any more — delete the entry",
            file=sys.stderr,
        )

    if problems or unreviewed or obsolete:
        print("\ncheck-advisories: FAILED", file=sys.stderr)
        return 1
    print("\ncheck-advisories: all advisories are either fixed or reviewed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
