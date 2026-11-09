# SPDX-License-Identifier: AGPL-3.0-only
"""Exercise the real Bash CLI in isolated installations with a fake Docker daemon."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
BASH = os.environ.get("TEST_BASH") or (
    "C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else shutil.which("bash")
)


class ServerCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="caimack-cli-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in [
            "caimack.sh",
            "setup.sh",
            ".env.example",
            "docker-compose.yml",
            "docker-compose.images.yml",
            "docker-compose.recommendations.yml",
            "docker-compose.mert-amd.yml",
            "deploy/Caddyfile",
        ]:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / name, target)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "docker.log"
        self.states = self.root / "states.log"
        docker = self.bin / "docker"
        docker.write_text(
            """#!/usr/bin/env bash
set -eu
printf '%s\\t' "$@" >> "$TEST_LOG"
printf '\\n' >> "$TEST_LOG"
case " $* " in
  *' pull '*) if [[ ${TEST_FAIL_PULL:-0} == 1 ]]; then exit 44; fi ;;
  *' up '*)
    grep '^OWNER_RESET_PASSWORD=' .env >> "$TEST_STATES"
    if [[ ${TEST_FAIL_UP:-0} == 1 ]]; then exit 42; fi ;;
  *' run '*) if [[ ${TEST_FAIL_GPU:-0} == 1 ]]; then echo 'GPU unavailable' >&2; exit 43; fi ;;
esac
""",
            encoding="utf-8",
            newline="\n",
        )
        docker.chmod(0o755)
        # Keep GPU detection independent of the machine running these tests.
        for name, source in {
            "nvidia-smi": '#!/usr/bin/env bash\n[[ ${TEST_NVIDIA:-1} == 1 ]] || exit 1\necho "Test NVIDIA GPU"\n',
            "lspci": '#!/usr/bin/env bash\necho "0000:01:00.0 0300: ${TEST_PCI_VENDOR:-8086}:1234"\n',
            "stat": '#!/usr/bin/env bash\nif [[ ${TEST_FAIL_STAT:-0} == 1 ]]; then exit 1; fi\necho 109\n',
            "uname": '#!/usr/bin/env bash\necho "${TEST_OS:-Linux}"\n',
        }.items():
            path = self.bin / name
            path.write_text(source, encoding="utf-8", newline="\n")
            path.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "TEST_BIN": self.bin.as_posix(),
            "TEST_LOG": self.log.as_posix(),
            "TEST_STATES": self.states.as_posix(),
            "NO_COLOR": "1",
            "MSYS_NO_PATHCONV": "1",
        }
        # Test deployments must not inherit an operator's shell Compose options.
        for key in ["COMPOSE_FILE", "COMPOSE_PROFILES", "COMPOSE_PROJECT_NAME"]:
            self.env.pop(key, None)

    def run_cli(self, *args, script="caimack.sh", success=True, extra=None):
        result = subprocess.run(
            [
                BASH,
                "-c",
                'export PATH="$(cd -- "$TEST_BIN" && pwd):$PATH"; exec bash "$@"',
                "test-cli",
                script,
                *args,
            ],
            cwd=self.root,
            env={**self.env, **(extra or {})},
            text=True,
            encoding="utf-8",
            capture_output=True,
            timeout=30,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def install(self, *args):
        return self.run_cli("install", "--domain", "music.example.com", "--yes", *args)

    def configuration(self):
        return (self.root / ".env").read_text(encoding="utf-8")

    def calls(self):
        return self.log.read_text(encoding="utf-8").splitlines()

    def mock_downloads(self):
        release = self.root / "release"
        release.mkdir()
        for name in [
            ".env.example",
            "docker-compose.yml",
            "docker-compose.images.yml",
            "docker-compose.recommendations.yml",
            "docker-compose.mert-amd.yml",
            "deploy/Caddyfile",
            "caimack.sh",
            "setup.sh",
        ]:
            target = release / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.root / name, target)
        self.env["TEST_RELEASE"] = release.as_posix()
        curl = self.bin / "curl"
        curl.write_text(
            """#!/usr/bin/env bash
set -eu
url='' output=''
while (($#)); do
 case "$1" in
   -o) output=$2; shift 2 ;;
   https:*) url=$1; shift ;;
   *) shift ;;
 esac
done
if [[ $url == *'/tags?per_page=100' ]]; then
 printf '[\n{"name":"v10.0.0-rc.1"},\n{"name":"clap-model-v1"},\n{"name":"v9.8.7"}\n]' > "$output"
else
 file=${url#https://raw.githubusercontent.com/BulatRuslanovich/caimack/v9.8.7/}
 [[ $file != "${TEST_FAIL_DOWNLOAD:-}" ]] || exit 22
 cp "$TEST_RELEASE/$file" "$output"
fi
""",
            encoding="utf-8",
            newline="\n",
        )
        curl.chmod(0o755)
        return release

    def test_install_downloads_cpu_images_and_does_not_log_passwords(self):
        output = self.install()
        env = self.configuration()
        self.assertIn("OWNER_RESET_PASSWORD='false'", env)
        self.assertIn(
            "COMPOSE_FILE='docker-compose.yml:docker-compose.images.yml'", env
        )
        self.assertTrue(any("pull" in call for call in self.calls()))
        self.assertTrue(any("--wait" in call for call in self.calls()))
        self.assertFalse(any("recommendations.yml" in call for call in self.calls()))
        password = next(
            line.split("=", 1)[1].strip("'")
            for line in env.splitlines()
            if line.startswith("OWNER_PASSWORD=")
        )
        self.assertNotIn(password, output.stdout + output.stderr)
        original = env
        self.run_cli("install", "--yes", success=False)
        self.assertEqual(self.configuration(), original)

    def test_update_preserves_secrets_and_custom_keys_and_normalizes_version(self):
        self.install()
        with (self.root / ".env").open("a", encoding="utf-8") as stream:
            stream.write("\nCUSTOM_SETTING='keep me'\n")
        before = self.configuration()
        self.run_cli("update", "--version", "v2.3.4", "--yes")
        after = self.configuration()
        for key in [
            "POSTGRES_PASSWORD",
            "JWT_SIGNING_KEY",
            "OWNER_PASSWORD",
            "CUSTOM_SETTING",
        ]:
            self.assertEqual(
                next(
                    line for line in before.splitlines() if line.startswith(key + "=")
                ),
                next(line for line in after.splitlines() if line.startswith(key + "=")),
            )
        self.assertIn("CAIMACK_VERSION='2.3.4'", after)
        self.assertTrue(list((self.root / ".caimack/backups").glob("*/.env")))

    def test_recommendation_toggle_preserves_overrides_and_stops_gpu_before_detaching(
        self,
    ):
        self.install()
        (self.root / "custom.yml").write_text("services: {}\n", encoding="utf-8")
        env = self.configuration().replace(
            "docker-compose.images.yml'", "docker-compose.images.yml:custom.yml'"
        )
        (self.root / ".env").write_text(env, encoding="utf-8")
        self.run_cli("recommendations", "on", "--yes")
        self.assertIn(
            "custom.yml:docker-compose.recommendations.yml'", self.configuration()
        )
        self.assertTrue(any("\trun\t" in call for call in self.calls()))
        self.run_cli("recommendations", "on", "--yes")
        self.assertEqual(
            self.configuration().count(":docker-compose.recommendations.yml"), 1
        )
        self.run_cli("recommendations", "off", "--yes")
        self.assertNotIn(":docker-compose.recommendations.yml", self.configuration())
        self.assertIn("custom.yml'", self.configuration())
        self.assertTrue(any("\tstop\tmert\tmert-init" in call for call in self.calls()))

    def test_failed_gpu_probe_returns_to_cpu_configuration(self):
        self.install()
        self.run_cli(
            "recommendations",
            "on",
            "--yes",
            success=False,
            extra={"TEST_FAIL_GPU": "1"},
        )
        self.assertNotIn(":docker-compose.recommendations.yml", self.configuration())

    def set_gpu_preference(self, value):
        path = self.root / ".env"
        path.write_text(self.configuration().replace("MERT_GPU_BACKEND=auto", f"MERT_GPU_BACKEND={value}"), encoding="utf-8")

    def test_auto_selects_nvidia_and_persists_selection(self):
        self.install()
        self.run_cli("recommendations", "on", "--yes")
        self.assertNotIn(":docker-compose.mert-amd.yml", self.configuration())
        self.assertIn("NVIDIA + MERT", self.run_cli("status").stdout)
        # Ordinary lifecycle commands use the saved files without detecting again.
        self.run_cli("start", extra={"TEST_NVIDIA": "0", "TEST_PCI_VENDOR": "8086"})
        self.assertNotIn("mert-amd.yml", self.calls()[-1])

    def test_auto_amd_preserves_custom_files_and_groups_and_detaches_cleanly(self):
        self.install()
        (self.root / "custom.yml").write_text("services: {}\n", encoding="utf-8")
        path = self.root / ".env"
        path.write_text(self.configuration().replace("docker-compose.images.yml'", "docker-compose.images.yml:custom.yml'"), encoding="utf-8")
        gpu = {"TEST_NVIDIA": "0", "TEST_PCI_VENDOR": "1002"}
        self.run_cli("recommendations", "on", "--yes", extra=gpu)
        self.assertIn("custom.yml:docker-compose.recommendations.yml:docker-compose.mert-amd.yml'", self.configuration())
        self.assertIn("MERT_KFD_GID='109'", self.configuration())
        self.assertIn("MERT_RENDER_GID='109'", self.configuration())
        probe = next(call for call in self.calls() if "\trun\t" in call)
        self.assertIn("mert-amd.yml", probe)
        self.assertIn("torch.cuda.synchronize()", probe)
        self.assertIn("AMD + MERT", self.run_cli("status").stdout)
        self.run_cli("recommendations", "on", "--yes", extra=gpu)
        self.assertEqual(self.configuration().count(":docker-compose.mert-amd.yml"), 1)
        self.run_cli("recommendations", "off", "--yes")
        self.assertNotIn(":docker-compose.mert-amd.yml", self.configuration())
        stop = next(call for call in self.calls() if "\tstop\tmert\tmert-init" in call)
        self.assertIn("mert-amd.yml", stop)
        self.assertIn("custom.yml'", self.configuration())

    def test_manual_amd_overrides_nvidia_detection(self):
        self.install()
        self.set_gpu_preference("amd")
        self.run_cli("recommendations", "on", "--yes")
        self.assertIn(":docker-compose.mert-amd.yml", self.configuration())

    def test_auto_prefers_nvidia_on_a_mixed_host(self):
        self.install()
        self.run_cli("recommendations", "on", "--yes", extra={"TEST_PCI_VENDOR": "1002"})
        self.assertNotIn(":docker-compose.mert-amd.yml", self.configuration())

    def test_unknown_gpu_or_invalid_preference_does_not_change_configuration(self):
        self.install()
        for preference in ["auto", "invalid"]:
            self.set_gpu_preference(preference)
            before = self.configuration()
            self.run_cli("recommendations", "on", "--yes", success=False, extra={"TEST_NVIDIA": "0", "TEST_PCI_VENDOR": "8086"})
            self.assertEqual(self.configuration(), before)

    def test_failed_amd_probe_restores_complete_configuration(self):
        self.install()
        self.run_cli("recommendations", "on", "--yes")
        self.set_gpu_preference("amd")
        before = self.configuration()
        self.run_cli("recommendations", "on", "--yes", success=False, extra={"TEST_FAIL_GPU": "1"})
        self.assertEqual(self.configuration(), before)
        self.assertNotIn(":docker-compose.mert-amd.yml", self.configuration())

    def test_missing_amd_device_restores_configuration(self):
        self.install()
        self.set_gpu_preference("amd")
        before = self.configuration()
        self.run_cli("recommendations", "on", "--yes", success=False, extra={"TEST_FAIL_STAT": "1"})
        self.assertEqual(self.configuration(), before)

    def test_failed_amd_image_acquisition_or_start_restores_configuration(self):
        self.install()
        self.set_gpu_preference("amd")
        before = self.configuration()
        for failure in ["TEST_FAIL_PULL", "TEST_FAIL_UP"]:
            with self.subTest(failure=failure):
                self.run_cli("recommendations", "on", "--yes", success=False, extra={failure: "1"})
                self.assertEqual(self.configuration(), before)

    def test_switching_amd_to_nvidia_removes_amd_overlay(self):
        self.install()
        self.set_gpu_preference("amd")
        self.run_cli("recommendations", "on", "--yes")
        path = self.root / ".env"
        path.write_text(self.configuration().replace("MERT_GPU_BACKEND=amd", "MERT_GPU_BACKEND=nvidia"), encoding="utf-8")
        self.run_cli("recommendations", "on", "--yes")
        self.assertNotIn(":docker-compose.mert-amd.yml", self.configuration())

    def test_explicit_amd_groups_allow_a_remote_host_without_local_devices(self):
        self.install()
        self.set_gpu_preference("amd")
        with (self.root / ".env").open("a", encoding="utf-8") as stream:
            stream.write("\nMERT_KFD_GID=201\nMERT_RENDER_GID=202\n")
        self.run_cli("recommendations", "on", "--yes", extra={"TEST_FAIL_STAT": "1"})
        self.assertIn("MERT_KFD_GID='201'", self.configuration())
        self.assertIn("MERT_RENDER_GID='202'", self.configuration())
        self.assertTrue(any("\tpull\tmert\t" in call for call in self.calls()))

    def test_amd_source_install_builds_instead_of_pulling_gpu_image(self):
        (self.root / "backend").mkdir()
        (self.root / "frontend").mkdir()
        self.install("--build")
        self.set_gpu_preference("amd")
        self.run_cli("recommendations", "on", "--yes")
        self.assertTrue(any("mert-amd.yml\tbuild\t" in call for call in self.calls()))
        self.assertFalse(any("\tpull\t" in call for call in self.calls()))

    @unittest.skipUnless(os.environ.get("TEST_REAL_COMPOSE"), "opt-in Docker Compose validation")
    def test_real_compose_gpu_variants(self):
        self.install()
        for release in [False, True]:
            for backend in ["nvidia", "amd"]:
                with self.subTest(release=release, backend=backend):
                    args = [shutil.which("docker"), "compose", "--env-file", str(self.root / ".env"), "-f", str(self.root / "docker-compose.yml")]
                    if release:
                        args += ["-f", str(self.root / "docker-compose.images.yml")]
                    args += ["-f", str(self.root / "docker-compose.recommendations.yml")]
                    if backend == "amd":
                        args += ["-f", str(self.root / "docker-compose.mert-amd.yml")]
                    result = subprocess.run(args + ["config", "--format", "json"], env={**os.environ, "MERT_KFD_GID": "109", "MERT_RENDER_GID": "110"}, capture_output=True, text=True, timeout=20)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    services = json.loads(result.stdout)["services"]
                    mert = services["mert"]
                    self.assertEqual(services["backend"]["environment"]["RECOMMENDATIONS_ENABLED"], "true")
                    self.assertEqual(mert["deploy"]["resources"]["limits"]["memory"], "4294967296")
                    if backend == "amd":
                        self.assertFalse(mert["deploy"]["resources"].get("reservations", {}).get("devices"))
                        self.assertEqual(mert["image"], "ghcr.io/bulatruslanovich/caimack-mert-rocm:latest")
                        self.assertEqual(mert["build"]["args"]["TORCH_INDEX_URL"], "https://download.pytorch.org/whl/rocm6.4")
                        self.assertEqual(mert["group_add"], ["109", "110"])
                        self.assertEqual(mert["environment"]["MIOPEN_USER_DB_PATH"], "/tmp/mert-miopen-db")
                        self.assertEqual(mert["environment"]["HF_HOME"], "/models")
                        self.assertEqual({device["source"] for device in mert["devices"]}, {"/dev/kfd", "/dev/dri"})
                    else:
                        self.assertEqual(mert["deploy"]["resources"]["reservations"]["devices"][0]["driver"], "nvidia")

    def test_gpu_weight_download_does_not_block_application_health_wait(self):
        self.install()
        self.run_cli("recommendations", "on", "--yes")
        waits = [
            call.split("\t")
            for call in self.calls()
            if "\tup\t" in call and "--wait" in call
        ]
        self.assertTrue(
            any("--no-deps" in call and "backend" in call for call in waits)
        )
        self.assertFalse(any("mert" in call for call in waits))

    def test_repeated_enable_failure_preserves_existing_module(self):
        self.install()
        self.run_cli("recommendations", "on", "--yes")
        self.run_cli(
            "recommendations",
            "on",
            "--yes",
            success=False,
            extra={"TEST_FAIL_GPU": "1"},
        )
        self.assertIn(":docker-compose.recommendations.yml", self.configuration())

    def test_one_time_reset_recreates_backend_with_reset_disabled(self):
        self.install()
        self.states.write_text("", encoding="utf-8")
        self.run_cli("reset", "once", "--yes")
        self.assertEqual(
            self.states.read_text().splitlines(),
            ["OWNER_RESET_PASSWORD='true'", "OWNER_RESET_PASSWORD='false'"],
        )
        self.assertIn("OWNER_RESET_PASSWORD='false'", self.configuration())

    def test_failed_one_time_reset_clears_reset_flag(self):
        self.install()
        self.run_cli(
            "reset", "once", "--yes", success=False, extra={"TEST_FAIL_UP": "1"}
        )
        self.assertIn("OWNER_RESET_PASSWORD='false'", self.configuration())

    def test_persistent_reset_and_owner_changes(self):
        self.install()
        self.run_cli("reset", "on", "--yes")
        self.assertIn("OWNER_RESET_PASSWORD='true'", self.configuration())
        self.assertIn("ARMED", self.run_cli("status").stdout)
        self.run_cli("reset", "off", "--yes")
        self.run_cli("owner", "--owner", "new_owner", "--yes")
        self.assertIn("OWNER_USERNAME='new_owner'", self.configuration())
        self.assertIn("OWNER_RESET_PASSWORD='false'", self.configuration())

    def test_env_is_never_evaluated_and_status_is_read_only(self):
        self.install()
        with (self.root / ".env").open("a", encoding="utf-8") as stream:
            stream.write("\nOWNER_USERNAME=$(touch DO_NOT_CREATE)\n")
        before = self.configuration()
        self.run_cli()
        self.assertEqual(self.configuration(), before)
        self.assertFalse((self.root / "DO_NOT_CREATE").exists())

    def test_windows_bom_and_crlf_configuration_is_readable(self):
        self.install()
        original = self.configuration()
        (self.root / ".env").write_bytes(
            b"\xef\xbb\xbf" + original.replace("\n", "\r\n").encode()
        )
        self.assertIn("music.example.com", self.run_cli("status").stdout)
        self.run_cli("update", "--version", "v2.3.4", "--yes")
        self.assertIn("CAIMACK_VERSION='2.3.4'", self.configuration())

    def test_quoted_music_path_round_trips_without_execution(self):
        library = self.root / "music $money ' #"
        library.mkdir()
        self.install("--library", library.as_posix())
        self.assertIn("music $money \\' #", self.configuration())

    def test_legacy_entry_point_and_input_validation(self):
        self.run_cli("--help", script="setup.sh")
        self.install()
        before = self.configuration()
        self.run_cli("owner", "--owner", "bad user", "--yes", success=False)
        self.run_cli("update", "--version", "$(touch BAD)", "--yes", success=False)
        self.run_cli("logs", "backend", "-f")
        self.assertFalse((self.root / "BAD").exists())
        self.assertEqual(self.configuration(), before)
        self.assertTrue(
            any("logs\t--tail\t100\t-f\tbackend" in call for call in self.calls())
        )

    def test_standalone_install_downloads_missing_files_and_managed_updates(self):
        self.mock_downloads()
        for name in [
            ".env.example",
            "docker-compose.yml",
            "docker-compose.images.yml",
            "docker-compose.recommendations.yml",
            "deploy/Caddyfile",
        ]:
            (self.root / name).unlink()
        self.install()
        self.assertTrue((self.root / ".caimack/managed").exists())
        self.assertTrue((self.root / "deploy/Caddyfile").exists())
        before = self.configuration()
        self.run_cli("update", "--yes")
        self.assertEqual(before, self.configuration())

    def test_failed_self_update_does_not_overwrite_working_files(self):
        self.install()
        release = self.mock_downloads()
        with (release / "docker-compose.yml").open("a", encoding="utf-8") as stream:
            stream.write("# New release\n")
        before = (self.root / "docker-compose.yml").read_bytes()
        original_env = self.configuration()
        self.run_cli(
            "self-update",
            "--yes",
            success=False,
            extra={"TEST_FAIL_DOWNLOAD": "docker-compose.recommendations.yml"},
        )
        self.assertEqual((self.root / "docker-compose.yml").read_bytes(), before)
        self.assertEqual(self.configuration(), original_env)

    def test_self_update_preserves_configuration_and_backs_up_files(self):
        self.install()
        release = self.mock_downloads()
        with (release / "docker-compose.yml").open("a", encoding="utf-8") as stream:
            stream.write("# New release\n")
        before = self.configuration()
        self.run_cli("self-update", "--yes")
        self.assertEqual(before, self.configuration())
        self.assertIn("# New release", (self.root / "docker-compose.yml").read_text())
        self.assertTrue(
            list((self.root / ".caimack/backups").glob("*/docker-compose.yml"))
        )

    @unittest.skipUnless(
        os.environ.get("TEST_REAL_COMPOSE"), "opt-in Docker Compose dotenv validation"
    )
    def test_real_compose_preserves_literal_dollar_quote_and_hash_in_paths(self):
        library = self.root / "music $money ' #"
        library.mkdir()
        self.install("--library", library.as_posix())
        result = subprocess.run(
            [
                shutil.which("docker"),
                "compose",
                "--env-file",
                str(self.root / ".env"),
                "-f",
                str(self.root / "docker-compose.yml"),
                "-f",
                str(self.root / "docker-compose.images.yml"),
                "config",
                "--format",
                "json",
            ],
            cwd=self.root,
            text=True,
            encoding="utf-8",
            capture_output=True,
            timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads(result.stdout)
        paths = [
            volume["source"] for volume in config["services"]["backend"]["volumes"]
        ]
        # `compose config` escapes literal dollars for a reusable Compose document.
        self.assertTrue(
            any(path.replace("$$", "$").endswith("music $money ' #") for path in paths),
            paths,
        )


if __name__ == "__main__":
    unittest.main()
