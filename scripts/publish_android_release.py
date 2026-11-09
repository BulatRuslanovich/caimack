#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Attach the signed Android APK to its GitHub Release, then publish new drafts."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class PublishError(Exception):
    pass


def version(tag: str) -> tuple[int, ...] | None:
    if not re.fullmatch(r"v(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)", tag):
        return None
    return tuple(map(int, tag[1:].split(".")))


class GitHub:
    def __init__(self, repository: str, token: str):
        self.repository = repository
        self.token = token

    def request(self, method: str, path: str, data=None, *, upload=False):
        host = "uploads.github.com" if upload else "api.github.com"
        body = data if upload else json.dumps(data).encode() if data is not None else None
        request = Request(
            f"https://{host}/repos/{self.repository}/{path}",
            method=method,
            data=body,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "User-Agent": "Caimack-Android-Release",
                "Content-Type": "application/vnd.android.package-archive" if upload else "application/json",
            },
        )
        try:
            with urlopen(request, timeout=180) as response:
                return None if response.status == 204 else json.load(response)
        except HTTPError as error:
            status = error.code
            error.close()
            if method == "GET" and status == 404:
                return None
            raise PublishError(f"GitHub rejected {method} {path} (HTTP {status}).") from None
        except (URLError, TimeoutError, OSError):
            raise PublishError("GitHub connection failed. The release can be retried manually.") from None
        except (ValueError, UnicodeError):
            raise PublishError("GitHub returned an invalid JSON response.") from None


def positive_id(value) -> int:
    if type(value) is not int or value <= 0:
        raise PublishError("GitHub returned an invalid release or asset ID.")
    return value


def publish(apk: Path, tag: str, repository: str, github: GitHub) -> str:
    target = version(tag)
    if target is None or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise PublishError("Expected a stable vX.Y.Z tag and a GitHub owner/repository.")
    name = f"caimack-{tag}-arm64.apk"
    if not apk.is_file() or apk.name != name or apk.stat().st_size == 0:
        raise PublishError(f"Expected the verified release APK named {name}.")

    release = github.request("GET", f"releases/tags/{tag}")
    if release is None:
        # The updater must not discover a new release until its APK has finished uploading.
        release = github.request("POST", "releases", {
            "tag_name": tag,
            "name": f"Caimack {tag[1:]}",
            "draft": True,
            "prerelease": False,
            "generate_release_notes": True,
        })
    if not isinstance(release, dict) or release.get("tag_name") != tag:
        raise PublishError("GitHub returned an unexpected release.")
    release_id = positive_id(release.get("id"))
    content = apk.read_bytes()
    digest = "sha256:" + hashlib.sha256(content).hexdigest()
    existing = next((asset for asset in release.get("assets", []) if asset.get("name") == name), None)
    if existing is None or existing.get("digest") != digest or existing.get("state") != "uploaded":
        # Keep the existing public APK downloadable until its replacement has finished uploading.
        staged_name = f"{name}.uploading"
        staged = next((asset for asset in release.get("assets", []) if asset.get("name") == staged_name), None)
        if staged is not None:
            github.request("DELETE", f"releases/assets/{positive_id(staged.get('id'))}")
        upload_name = staged_name if existing is not None else name
        uploaded = github.request("POST", f"releases/{release_id}/assets?{urlencode({'name': upload_name})}", content, upload=True)
        if not isinstance(uploaded, dict) or uploaded.get("name") != upload_name or uploaded.get("state") != "uploaded" or uploaded.get("size") != len(content):
            raise PublishError("GitHub did not confirm the APK upload. The draft was not published.")
        if existing is not None:
            github.request("DELETE", f"releases/assets/{positive_id(existing.get('id'))}")
            renamed = github.request("PATCH", f"releases/assets/{positive_id(uploaded.get('id'))}", {"name": name})
            if not isinstance(renamed, dict) or renamed.get("name") != name:
                raise PublishError("Could not finalize the replacement APK. Retry the workflow.")

    if release.get("draft"):
        latest = github.request("GET", "releases/latest")
        latest_version = version(latest.get("tag_name", "")) if isinstance(latest, dict) else None
        make_latest = not release.get("prerelease") and (latest is None or (latest_version is not None and target >= latest_version))
        # Preserve hand-written release notes; retrying an old tag must not demote a newer release.
        github.request("PATCH", f"releases/{release_id}", {"draft": False, "make_latest": str(make_latest).lower()})
    return f"https://github.com/{repository}/releases/tag/{tag}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repository", required=True)
    args = parser.parse_args()
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        print("APK publication failed: GH_TOKEN is missing.", file=sys.stderr)
        return 1
    try:
        url = publish(args.apk, args.tag, args.repository, GitHub(args.repository, token))
    except (PublishError, OSError) as error:
        print(f"APK publication failed: {error if isinstance(error, PublishError) else 'Could not read the APK.'}", file=sys.stderr)
        return 1
    print(f"Android release ready: {url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
