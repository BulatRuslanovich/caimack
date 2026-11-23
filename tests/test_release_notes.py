# SPDX-License-Identifier: AGPL-3.0-only
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "release_notes.py"


class ReleaseNotesTests(unittest.TestCase):
    def setUp(self):
        repo = tempfile.TemporaryDirectory()
        self.addCleanup(repo.cleanup)
        self.repository = repo.name
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Release test")
        self.git("config", "user.email", "release@example.com")
        self.git("config", "commit.gpgSign", "false")
        self.git("config", "tag.gpgSign", "false")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repository, encoding="utf-8").strip()

    def commit(self, subject, *args):
        self.git("commit", "--allow-empty", "-m", subject, *args)
        return self.git("rev-parse", "HEAD")

    def notes(self, ref):
        return subprocess.check_output(
            [sys.executable, "-X", "utf8", str(SCRIPT), ref, "--repository", "owner/caimack"],
            cwd=self.repository,
            encoding="utf-8",
        )

    def test_tag_uses_earlier_stable_ancestor_and_includes_merged_changes(self):
        self.commit("feat: ship earlier version")
        self.git("tag", "v1.2.9")
        self.commit("fix: already released")
        self.git("tag", "-m", "Caimack 1.2.10", "v1.2.10")
        self.git("switch", "-c", "side")
        self.commit("feat: unrelated release")
        self.git("tag", "v1.3.0")
        self.git("switch", "main")
        self.commit("feat(search): add genre filters")
        self.git("tag", "v1.4.0-rc.1")
        self.git("switch", "-c", "fixes")
        self.commit("fix(android): restore playback")
        self.git("switch", "main")
        self.git("merge", "--no-ff", "--no-edit", "fixes")
        self.commit("chore(release): v1.4.0")
        self.git("tag", "v1.4.0")
        self.git("tag", "v2.0.0")
        self.commit("feat: next release")

        self.assertEqual(
            "## New features\n\n- **search** · add genre filters\n\n"
            "## Bug fixes\n\n- **android** · restore playback\n\n"
            "[Full changelog](https://github.com/owner/caimack/compare/v1.2.10...v1.4.0)\n",
            self.notes("v1.4.0"),
        )

    def test_head_preview_groups_legacy_and_breaking_changes_and_omits_reverted_pairs(self):
        previous = self.commit("feat: old feature")
        self.git("tag", "v1.0.0")
        self.commit("fix(api)!: drop version one")
        self.commit("feat(config): rename the setting", "-m", "BREAKING-CHANGE: Existing configs must be updated.")
        self.commit("Keep [library] rows stable")
        reverted = self.commit("feat: temporary behavior")
        self.commit('Revert "feat: temporary behavior"', "-m", f"This reverts commit {reverted}.")
        head = self.commit('Revert "feat: old feature"', "-m", f"This reverts commit {previous}.")

        notes = self.notes("HEAD")
        self.assertIn("## Breaking changes\n\n- **config** · rename the setting\n- **api** · drop version one", notes)
        self.assertIn('## Other changes\n\n- Revert "feat: old feature"\n- Keep \\[library\\] rows stable', notes)
        self.assertIn(f"/compare/v1.0.0...{head}", notes)
        self.assertNotIn("temporary behavior", notes)

    def test_first_release_lists_history(self):
        self.commit("feat: start Caimack")
        self.git("tag", "v1.0.0")

        notes = self.notes("v1.0.0")
        self.assertIn("## New features\n\n- start Caimack", notes)
        self.assertIn("[Commit history](https://github.com/owner/caimack/commits/v1.0.0)", notes)


if __name__ == "__main__":
    unittest.main()
