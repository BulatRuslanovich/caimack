#!/usr/bin/env python3

# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich

import argparse
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4
import zipfile

MAX_APK_BYTES = 50_000_000


class DeliveryError(Exception):
    pass

# INFO: Universal func for Telegram Bot API
def api_request(token: str, method: str, body: bytes, content_type: str) -> dict:
    request = Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=body,
        headers={"Content-Type": content_type},
    )

    try:
        with urlopen(request, timeout=180) as response:
            result = json.load(response)
    except HTTPError as error:
        status = error.code
        error.close()
        raise DeliveryError(
            f"Telegram rejected {method} (HTTP {status}). Check bot membership and chat permissions."
        ) from None

    except (URLError, TimeoutError, OSError):
        raise DeliveryError(
            "Telegram connection failed. Delivery is not retried automatically to avoid duplicates."
        ) from None

    except (ValueError, UnicodeError):
        raise DeliveryError("Telegram returned an invalid JSON response.") from None
    
    if (
        not isinstance(result, dict)
        or result.get("ok") is not True
        or not isinstance(result.get("result"), dict)
    ):
        raise DeliveryError(f"Telegram did not confirm {method}.")
    
    return result["result"]


def multipart(fields: dict[str, str], filename: str, apk: bytes) -> tuple[bytes, str]:
    boundary = "caimack-" + uuid4().hex
    parts = []

    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )

    parts.extend(
        [
            f'--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="{filename}"\r\nContent-Type: application/vnd.android.package-archive\r\n\r\n'.encode(),
            apk,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )

    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def deliver(apk: Path, tag: str, repository: str, revision: str) -> int:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")

    if not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", token):
        raise DeliveryError("Set the TELEGRAM_BOT_TOKEN repository secret.")

    if not re.fullmatch(r"-[0-9]+", chat_id):
        raise DeliveryError(
            "Set TELEGRAM_CHAT_ID to the numeric ID of the target group (a negative integer)."
        )

    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
        raise DeliveryError("The release tag must have the form v1.2.3.")

    if not re.fullmatch(
        r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository
    ) or not re.fullmatch(r"[a-fA-F0-9]{40}", revision):
        raise DeliveryError("Invalid source repository or commit SHA.")

    if not apk.is_file() or apk.suffix.lower() != ".apk":
        raise DeliveryError("Release APK not found.")

    if not 0 < apk.stat().st_size <= MAX_APK_BYTES:
        raise DeliveryError(
            "APK exceeds Telegram's 50 MB upload limit. Download it from the Actions artifact instead."
        )

    try:
        with zipfile.ZipFile(apk) as package:
            if "AndroidManifest.xml" not in package.namelist():
                raise DeliveryError("The file is not an Android APK.")
    except zipfile.BadZipFile:
        raise DeliveryError("The file is not an APK archive.") from None

    chat = api_request(
        token, "getChat", json.dumps({"chat_id": chat_id}).encode(), "application/json"
    )
    
    if str(chat.get("id")) != chat_id or chat.get("type") not in {
        "group",
        "supergroup",
    }:
        raise DeliveryError(
            "TELEGRAM_CHAT_ID must identify a group or supergroup; nothing was sent."
        )
    caption = (
        f"Caimack {tag}\nAndroid 13+ / arm64-v8a\n"
        f"Commit: {revision[:12]}\nSource: https://github.com/{repository}/tree/{revision}"
    )
    body, content_type = multipart(
        {"chat_id": chat_id, "caption": caption},
        f"caimack-{tag}-arm64.apk",
        apk.read_bytes(),
    )
    message = api_request(token, "sendDocument", body, content_type)
    if str(message.get("chat", {}).get("id")) != chat_id or not isinstance(
        message.get("message_id"), int
    ):
        raise DeliveryError("Telegram returned an unexpected delivery confirmation.")
    return message["message_id"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    try:
        message = deliver(args.apk, args.tag, args.repository, args.revision)
    except (DeliveryError, OSError) as error:
        text = (
            str(error)
            if isinstance(error, DeliveryError)
            else "Could not read the APK file."
        )
        print(f"APK delivery failed: {text}", file=sys.stderr)
        return 1
    print(
        f"Release APK delivered to the configured Telegram group (message {message})."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
