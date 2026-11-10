# SPDX-License-Identifier: AGPL-3.0-only
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "publish_android_release.py"
SPEC = importlib.util.spec_from_file_location("publish_android_release", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.apk = Path(self.temp.name) / "caimack-v1.2.3-arm64.apk"
        self.apk.write_bytes(b"verified signed APK fixture")
        self.api = Mock()
        self.draft = {"id": 7, "tag_name": "v1.2.3", "draft": True, "assets": []}
        self.asset = {"id": 9, "name": self.apk.name, "state": "uploaded", "size": self.apk.stat().st_size}

    def publish(self):
        return release.publish(self.apk, "v1.2.3", "owner/music", self.api)

    def test_new_release_is_published_only_after_confirmed_apk_upload(self):
        self.api.request.side_effect = [None, self.draft, self.asset, None, {"draft": False}]
        self.assertEqual("https://github.com/owner/music/releases/tag/v1.2.3", self.publish())
        calls = self.api.request.call_args_list
        self.assertEqual(("POST", "releases"), calls[1].args[:2])
        self.assertTrue(calls[1].args[2]["draft"])
        self.assertTrue(calls[1].args[2]["generate_release_notes"])
        self.assertEqual(self.apk.read_bytes(), calls[2].args[2])
        self.assertEqual({"draft": False, "make_latest": "true"}, calls[-1].args[2])

    def test_failed_upload_does_not_publish_a_draft(self):
        self.api.request.side_effect = [None, self.draft, release.PublishError("Upload interrupted")]
        with self.assertRaises(release.PublishError):
            self.publish()
        self.assertFalse(any(call.args[0] == "PATCH" for call in self.api.request.call_args_list))

    def test_unfinished_upload_does_not_publish_a_draft(self):
        self.api.request.side_effect = [None, self.draft, dict(self.asset, state="starter")]
        with self.assertRaises(release.PublishError):
            self.publish()
        self.assertFalse(any(call.args[0] == "PATCH" for call in self.api.request.call_args_list))

    def test_old_tag_does_not_replace_latest(self):
        self.api.request.side_effect = [self.draft, self.asset, {"tag_name": "v1.10.0"}, {}]
        self.publish()
        self.assertEqual("false", self.api.request.call_args_list[-1].args[2]["make_latest"])

    def test_existing_public_release_notes_and_status_are_untouched(self):
        self.api.request.side_effect = [dict(self.draft, draft=False, body="Hand-written notes"), self.asset]
        self.publish()
        self.assertEqual(2, self.api.request.call_count)
        self.assertFalse(any(call.args[0] == "PATCH" for call in self.api.request.call_args_list))

    def test_existing_asset_is_replaced_on_rebuild(self):
        staged = dict(self.asset, id=10, name=self.apk.name + ".uploading")
        self.api.request.side_effect = [dict(self.draft, draft=False, assets=[self.asset]), staged, None, self.asset]
        self.publish()
        calls = self.api.request.call_args_list
        self.assertEqual("POST", calls[1].args[0])
        self.assertEqual(("DELETE", "releases/assets/9"), calls[2].args)
        self.assertEqual(("PATCH", "releases/assets/10", {"name": self.apk.name}), calls[3].args)

    def test_failed_replacement_upload_leaves_existing_public_apk_available(self):
        self.api.request.side_effect = [dict(self.draft, draft=False, assets=[self.asset]), release.PublishError("offline")]
        with self.assertRaises(release.PublishError):
            self.publish()
        self.assertFalse(any(call.args[0] == "DELETE" for call in self.api.request.call_args_list))

    def test_identical_uploaded_apk_does_not_need_replacement(self):
        asset = dict(self.asset, digest="sha256:" + hashlib.sha256(self.apk.read_bytes()).hexdigest())
        self.api.request.return_value = dict(self.draft, draft=False, assets=[asset])
        self.publish()
        self.assertEqual(1, self.api.request.call_count)

    def test_unknown_latest_tag_is_not_overridden(self):
        self.api.request.side_effect = [self.draft, self.asset, {"tag_name": "custom-release"}, {}]
        self.publish()
        self.assertEqual("false", self.api.request.call_args_list[-1].args[2]["make_latest"])

    def test_invalid_tag_repository_or_filename_never_call_github(self):
        for tag, repo in [("v1.100.0", "owner/music"), ("v1.2.3-beta", "owner/music"), ("v1.2.3", "owner/music/extra")]:
            with self.assertRaises(release.PublishError):
                release.publish(self.apk, tag, repo, self.api)
        with self.assertRaises(release.PublishError):
            release.publish(self.apk.with_name("other.apk"), "v1.2.3", "owner/music", self.api)
        self.api.request.assert_not_called()

    def test_missing_release_is_distinguished_from_authorization_errors(self):
        api = release.GitHub("owner/music", "fixture-secret-token")
        with patch.object(release, "urlopen", side_effect=HTTPError("https://api.github.com", 404, "Not found", {}, io.BytesIO())):
            self.assertIsNone(api.request("GET", "releases/latest"))
        with patch.object(release, "urlopen", side_effect=HTTPError("https://api.github.com", 403, "Forbidden", {}, io.BytesIO())):
            with self.assertRaises(release.PublishError) as error:
                api.request("GET", "releases/latest")
            self.assertNotIn("fixture-secret-token", str(error.exception))


if __name__ == "__main__":
    unittest.main()
