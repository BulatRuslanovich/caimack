# SPDX-License-Identifier: AGPL-3.0-only
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/send_telegram_apk.py"
spec = importlib.util.spec_from_file_location("send_telegram_apk", SCRIPT)
sender = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sender)


class TelegramApkTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.apk = Path(self.directory.name) / "release.apk"
        with zipfile.ZipFile(self.apk, "w") as package:
            package.writestr("AndroidManifest.xml", b"test manifest")
            package.writestr("classes.dex", b"binary\x00\xffdata")
        self.token = "123456:test-token"
        self.chat = "-100123456789"
        env = patch.dict(
            os.environ,
            {"TELEGRAM_BOT_TOKEN": self.token, "TELEGRAM_CHAT_ID": self.chat},
        )
        env.start()
        self.addCleanup(env.stop)

    def deliver(self):
        return sender.deliver(self.apk, "v1.2.3", "example/caimack", "a" * 40)

    def test_upload_contains_the_apk_and_fixed_group_with_release_caption(self):
        replies = [
            {"id": int(self.chat), "type": "supergroup"},
            {"message_id": 42, "chat": {"id": int(self.chat)}},
        ]
        with patch.object(sender, "api_request", side_effect=replies) as request:
            self.assertEqual(self.deliver(), 42)
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[0].args[1], "getChat")
        token, method, body, content_type = request.call_args_list[1].args
        self.assertEqual(token, self.token)
        self.assertEqual(method, "sendDocument")
        self.assertTrue(content_type.startswith("multipart/form-data; boundary="))
        self.assertIn(self.apk.read_bytes(), body)
        self.assertIn(b'filename="caimack-v1.2.3-arm64.apk"', body)
        self.assertIn(self.chat.encode(), body)
        self.assertIn(b"Caimack v1.2.3", body)
        self.assertIn(b"https://github.com/example/caimack/tree/" + b"a" * 40, body)

    def test_non_group_or_wrong_chat_is_rejected_before_upload(self):
        for reply in [
            {"id": int(self.chat), "type": "private"},
            {"id": int(self.chat), "type": "channel"},
            {"id": -123, "type": "supergroup"},
        ]:
            with self.subTest(reply=reply), patch.object(
                sender, "api_request", return_value=reply
            ) as request:
                with self.assertRaises(sender.DeliveryError):
                    self.deliver()
                self.assertEqual(request.call_count, 1)

    def test_missing_secrets_and_non_group_ids_never_make_requests(self):
        for token, chat in [
            ("", self.chat),
            (self.token, ""),
            (self.token, "123"),
            (self.token, "@channel"),
        ]:
            with self.subTest(chat=chat), patch.dict(
                os.environ, {"TELEGRAM_BOT_TOKEN": token, "TELEGRAM_CHAT_ID": chat}
            ), patch.object(sender, "api_request") as request:
                with self.assertRaises(sender.DeliveryError):
                    self.deliver()
                request.assert_not_called()

    def test_invalid_or_oversized_apk_is_rejected_before_upload(self):
        with patch.object(sender, "api_request") as request:
            self.apk.write_bytes(b"not an APK")
            with self.assertRaises(sender.DeliveryError):
                self.deliver()
            with self.apk.open("wb") as stream:
                stream.truncate(sender.MAX_APK_BYTES + 1)
            with self.assertRaisesRegex(sender.DeliveryError, "50 MB"):
                self.deliver()
            request.assert_not_called()

    def test_unexpected_delivery_confirmation_fails(self):
        with patch.object(
            sender,
            "api_request",
            side_effect=[
                {"id": int(self.chat), "type": "group"},
                {"message_id": 1, "chat": {"id": -123}},
            ],
        ):
            with self.assertRaises(sender.DeliveryError):
                self.deliver()

    def test_http_and_network_errors_do_not_leak_the_bot_token(self):
        for error in [
            HTTPError(
                f"https://api.telegram.org/bot{self.token}/sendDocument",
                403,
                "Forbidden",
                {},
                None,
            ),
            URLError(f"failed URL containing {self.token}"),
        ]:
            with self.subTest(error=type(error).__name__), patch.object(
                sender, "urlopen", side_effect=error
            ) as request:
                with self.assertRaises(sender.DeliveryError) as caught:
                    sender.api_request(
                        self.token,
                        "sendDocument",
                        b"payload",
                        "application/octet-stream",
                    )
                self.assertNotIn(self.token, str(caught.exception))
                self.assertEqual(request.call_count, 1)

    def test_api_requires_a_successful_json_result(self):
        for body in [
            b"not json",
            json.dumps({"ok": False, "description": "No permission"}).encode(),
        ]:
            with self.subTest(body=body), patch.object(
                sender, "urlopen", return_value=io.BytesIO(body)
            ):
                with self.assertRaises(sender.DeliveryError):
                    sender.api_request(self.token, "getChat", b"{}", "application/json")


if __name__ == "__main__":
    unittest.main()
