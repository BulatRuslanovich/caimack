# Server manager

`caimack.sh` manages a Caimack Docker Compose deployment. Its interface, prompts and
errors are in English. It requires Bash, Docker with Compose v2, and standard Unix
tools. Standalone downloads also require curl. Docker itself is installed separately.

## Getting started

Inside a checkout:

```bash
./caimack.sh
```

Or download the manager from a version tag into an empty deployment directory
(replace `vX.Y.Z` with the version you want):

```bash
mkdir caimack && cd caimack
curl -fL https://raw.githubusercontent.com/BulatRuslanovich/caimack/vX.Y.Z/caimack.sh -o caimack.sh
chmod +x caimack.sh
./caimack.sh install --version vX.Y.Z
```

When deployment files are missing, the manager downloads them from the matching
release tag before installing. It creates `.env`, generates database and JWT
secrets, downloads application images and waits for the deployment to become
healthy. Recommendations are off by default; CPU-only installs do not download
MERT or require GPU support. Interactive installation displays the initial admin
credentials. Non-interactive installation stores them in `.env` without printing
passwords into automation logs.

```bash
./caimack.sh install --domain music.example.com --library /srv/music --owner admin --yes
./caimack.sh install --version v1.2.3 --domain music.example.com --yes
```

The library is mounted read-only by default. [Automatic file names](file-names.md)
and [artwork/lyric export](metadata-export.md) can be enabled explicitly with
write access. An existing `.env` is never replaced by a second
installation. Relative paths are resolved from the manager's directory.

## Console

Running the manager again opens a deployment dashboard with container state,
health, configured image version, owner, recommendation mode and reset status.
Arrow keys select actions; Enter runs the selection. `j/k` move vertically,
left/right arrows switch columns, `g` refreshes and `q` exits. The highlighted
selection also has a direct shortcut:

| Key | Action                                          |
| --- | ----------------------------------------------- |
| `s` | Start services / apply configuration            |
| `x` | Stop services                                   |
| `r` | Restart services                                |
| `u` | Pull image updates                              |
| `l` | Follow logs                                     |
| `d` | Diagnostics                                     |
| `m` | Enable or disable recommendations               |
| `a` | Change owner                                    |
| `p` | Reset owner password once                       |
| `t` | Arm or disarm reset on every startup            |
| `i` | Update the manager and deployment files         |
| `c` | Explicitly display credentials stored in `.env` |

Short terminals use a compact dashboard. `NO_COLOR=1` disables colors, and
non-interactive runs without a command display read-only status.

## Updates and lifecycle

```bash
./caimack.sh update
./caimack.sh update --version v1.2.3 --yes
./caimack.sh update --version latest --yes
./caimack.sh start
./caimack.sh stop
./caimack.sh restart
./caimack.sh logs backend -f
./caimack.sh doctor
```

`update` pulls new images and recreates changed containers. A pinned version stays
pinned unless another version is supplied. In a standalone, utility-managed
installation it also refreshes deployment files from the matching release. In a
Git checkout, runtime files remain managed by Git until `self-update` is explicitly
requested. Existing secrets, custom environment keys and music are retained.
Source-based installs use `install --build`, require a full checkout and continue
to build their local sources when updating. Pull source changes with Git first.

`self-update` downloads the manager and deployment files into a private staging
directory, checks Bash syntax and Compose configuration, then replaces files. The
previous `.env` and files are backed up. Custom deployment file changes should be
maintained in a separate Compose override listed in `COMPOSE_FILE`; the manager
preserves that list when toggling recommendations.

The manager reads deployment files directly from Git version tags; no GitHub
Release or uploaded archive is required. `latest` selects the highest stable
`vX.Y.Z` tag among the 100 most recent repository tags, excluding prereleases and
model asset tags. Wait for the image workflow to finish before deploying a new tag.

## Recommendations

```bash
./caimack.sh recommendations on
./caimack.sh recommendations off
```

Enabling detects the host GPU, attaches `docker-compose.recommendations.yml`,
acquires the GPU image and runs a small computation inside the container before
starting the module. NVIDIA uses CUDA; AMD adds `docker-compose.mert-amd.yml`
and uses ROCm. Device group IDs for AMD are read from `/dev/kfd` and a
`/dev/dri/renderD*` node so the container can run as the configured non-root user.
Image acquisition, device setup or probe failures restore the previous `.env`.

`MERT_GPU_BACKEND=auto` is the default, including for older installations without
that setting. Detection uses `nvidia-smi`, PCI devices, or Linux sysfs without
requiring pciutils. NVIDIA takes priority when both vendors are detected.
Set `MERT_GPU_BACKEND=nvidia` or `MERT_GPU_BACKEND=amd` in `.env` to override,
then run `recommendations on` again. The selected Compose file list is saved;
start, stop and update reuse it without detecting hardware again. Detection runs
on the manager's host; with remote Docker, set the backend and, for AMD,
`MERT_KFD_GID` and `MERT_RENDER_GID` from the Docker host explicitly.

NVIDIA requires its driver and NVIDIA Container Toolkit. AMD requires Linux,
a compatible amdgpu driver and a GPU supported by the image's ROCm 6.4 / PyTorch
2.8 combination. Detection alone does not establish compatibility; unsupported
cards fail the container probe. `doctor` shows Docker runtimes, available GPU
utilities and AMD device permissions. See [GPU setup](mert.md).

The manager waits for the application services, not the model download. MERT loads
in the background; use `./caimack.sh logs mert -f` to watch its progress.

Disabling stops the MERT containers before detaching the module. Weights,
embeddings and library data remain on disk for later reuse. Reload web/Android
clients after toggling the module.

## Owner and password recovery

```bash
./caimack.sh owner --owner new_owner
./caimack.sh reset once
./caimack.sh reset on
./caimack.sh reset off
./caimack.sh credentials
```

`owner` selects the configured owner account and sets a new password. An existing
account is promoted to administrator; a missing account is created. The previous
account and its permissions are preserved, rather than renamed or deleted.
Adjust its permissions in the application's Users page if needed.

Passwords are entered with hidden input and confirmation; Enter generates a
password. `--yes` generates one automatically. Passwords cannot be supplied as
command-line arguments. `.env` and configuration backups use private permissions.
The value shown by `credentials` may be outdated if the password changed in the app.

`reset once` and `owner` briefly recreate the backend twice: once to apply the
reset and revoke sessions, then again with reset disabled. If the action fails,
the manager attempts to disarm reset and recreate the backend before exiting.
If Docker remains unavailable, run `reset off` when it recovers.

`reset on` deliberately leaves `OWNER_RESET_PASSWORD=true`: **every backend
startup restores the configured password and revokes the owner's sessions**.
The dashboard marks this state as `ARMED`. Use `reset off` to disarm it.

No command removes database volumes. Backups in `.caimack/backups/` contain secrets
and should remain private. These are configuration backups, not database backups;
follow your normal database backup procedure before upgrading.
