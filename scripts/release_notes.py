# SPDX-License-Identifier: AGPL-3.0-only
import argparse
from html import escape
import re
import subprocess


VERSION = re.compile(r"v(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)")
COMMIT_HEADER = re.compile(r"([a-z]+)(?:\(([^()]+)\))?(!)?:\s+(.+)")
BREAKING = re.compile(r"^BREAKING[ -]CHANGE: ", re.MULTILINE)
REVERT = re.compile(r"^This reverts commit ([0-9a-f]+)\.$", re.MULTILINE)
SECTIONS = {
    "breaking": "Breaking changes",
    "feat": "New features",
    "fix": "Bug fixes",
    "perf": "Performance",
    "refactor": "Refactoring",
    "docs": "Documentation",
    "maintenance": "Maintenance",
    "other": "Other changes",
}


def git(*args):
    return subprocess.check_output(["git", *args], encoding="utf-8", errors="replace")


def version(tag):
    match = VERSION.fullmatch(tag)
    return tuple(map(int, match.groups())) if match else None


def markdown(text):
    return re.sub(r"([\\`*_\[\]])", r"\\\1", escape(text, quote=False))


def release_notes(ref, repository):
    if git("rev-parse", "--is-shallow-repository").strip() == "true":
        raise ValueError("Release notes require the full Git history and tags.")

    target = version(ref)
    source = f"refs/tags/{ref}" if target is not None else ref
    revision = git("rev-parse", "--verify", "--end-of-options", f"{source}^{{commit}}").strip()
    tags = git("tag", "--merged", revision, "--sort=-version:refname").splitlines()
    base = next((
        tag for tag in tags
        if (number := version(tag)) is not None and (target is None or number < target)
    ), None)
    history = f"refs/tags/{base}..{revision}" if base else revision

    log = git("log", "--topo-order", "--no-show-signature", "--encoding=UTF-8",
              "-z", "--format=%H%x00%P%x00%s%x00%b", history, "--")
    fields = iter(log.split("\0")[:-1])
    commits = {
        oid: (subject, body)
        for oid, parents, subject, body in zip(fields, fields, fields, fields, strict=True)
        if " " not in parents or COMMIT_HEADER.fullmatch(subject)
    }
    reverted = set()
    sections = {key: [] for key in SECTIONS}

    for oid, (subject, body) in commits.items():
        if oid in reverted:
            continue
        # A change reverted within this release never shipped. A revert of an
        # older change still appears in the notes for this release.
        revert = REVERT.search(body)
        if revert and revert[1] in commits:
            reverted.add(revert[1])
            continue

        header = COMMIT_HEADER.fullmatch(subject)
        kind, scope, breaking, summary = header.groups() if header else ("other", None, None, subject)
        if kind == "chore" and scope == "release" and VERSION.fullmatch(summary):
            continue
        if breaking or BREAKING.search(body):
            kind = "breaking"
        elif kind in {"build", "chore", "ci", "style", "test"}:
            kind = "maintenance"

        label = f"**{markdown(scope)}** · " if scope else ""
        sections.get(kind, sections["other"]).append(f"- {label}{markdown(summary)}")

    blocks = [f"## {title}\n\n" + "\n".join(sections[key]) for key, title in SECTIONS.items() if sections[key]]
    if not blocks:
        blocks.append("No changes to list for this release.")

    url = f"https://github.com/{repository}"
    end = ref if target is not None else revision
    if base:
        blocks.append(f"[Full changelog]({url}/compare/{base}...{end})")
    else:
        blocks.append(f"[Commit history]({url}/commits/{end})")
    return "\n\n".join(blocks)


def main():
    parser = argparse.ArgumentParser(description="Generate Markdown release notes from Git history.")
    parser.add_argument("ref", help="Release tag or a Git reference such as HEAD to preview")
    parser.add_argument("--repository", required=True, help="GitHub owner/repository for changelog links")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository):
        parser.error("--repository must have the form owner/repository")
    try:
        print(release_notes(args.ref, args.repository))
    except ValueError as error:
        parser.exit(1, f"{error}\n")
    except subprocess.CalledProcessError:
        parser.exit(1, f"Could not read Git history for {args.ref}.\n")


if __name__ == "__main__":
    main()
