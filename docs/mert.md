# Optional recommendations module

Recommendations are disabled by default. The ordinary release deployment requires
no GPU driver, MERT image or model download:

```sh
docker compose -f docker-compose.yml -f docker-compose.images.yml pull
docker compose -f docker-compose.yml -f docker-compose.images.yml up -d
```

To enable recommendations on a host with NVIDIA GPU support, add the module file
to both commands:

```sh
docker compose -f docker-compose.yml -f docker-compose.images.yml -f docker-compose.recommendations.yml pull
docker compose -f docker-compose.yml -f docker-compose.images.yml -f docker-compose.recommendations.yml up -d
```

For source builds, use the base and module files with `up -d --build`.
The module starts MERT and sets `RECOMMENDATIONS_ENABLED=true` on the API.
For an API launched outside Docker, set that flag and `MERT_URL` explicitly.
Without the module, recommendation routes are unavailable; clients hide radio,
personalized mixes, map, recap and taste controls. Library browsing, playback,
history, favorites, uploads and CPU audio analysis remain available.

To disable an existing deployment, stop the GPU services explicitly and apply the
ordinary configuration again:

```sh
docker compose -f docker-compose.yml -f docker-compose.images.yml --profile recommendations stop mert mert-init
docker compose -f docker-compose.yml -f docker-compose.images.yml up -d
```

Cached weights and embeddings
are retained for later re-enabling. Reload the web client or reopen Android after
changing the configuration.

## Automatic GPU selection and AMD

The server manager selects the container configuration before starting MERT:

```sh
./caimack.sh recommendations on
```

`MERT_GPU_BACKEND=auto` (the default) detects NVIDIA or AMD on the local host,
preferring NVIDIA if both are present. Set it to `nvidia` or `amd` in `.env` to
override, then enable again. The selected files persist in `COMPOSE_FILE` for
subsequent lifecycle commands. The manager checks an actual GPU computation
inside the container before loading weights; a failed check restores the previous
configuration. Existing weights, model identity and preprocessing are shared by
both backends; no retraining or database migration is needed.

AMD uses a separate `caimack-mert-rocm` image with PyTorch 2.8.0 and ROCm 6.4,
while NVIDIA continues to use `caimack-mert` with CUDA 12.6. These pinned builds
follow the [PyTorch installation matrix](https://pytorch.org/get-started/previous-versions/).
AMD support requires a Linux Docker host, a compatible amdgpu kernel driver and a
GPU supported by that ROCm version. Check the
[ROCm system requirements](https://rocm.docs.amd.com/projects/install-on-linux/en/docs-6.4.1/reference/system-requirements.html).
The manager does not install drivers or apply overrides for unsupported cards.

For manual AMD deployment, set the host device group IDs in `.env` (the manager
normally fills these automatically). Obtain them with:

```sh
stat -c '%g' /dev/kfd
stat -c '%g' /dev/dri/renderD*
```

Set `MERT_KFD_GID` to the first result and `MERT_RENDER_GID` to the render node
group ID. The container maps `/dev/kfd` and `/dev/dri` and adds these groups to its
non-root user, following the [AMD container setup](https://rocm.docs.amd.com/projects/install-on-linux/en/docs-6.4.1/how-to/docker.html).
Then append the AMD override **after** the recommendation module:

```sh
docker compose -f docker-compose.yml -f docker-compose.images.yml -f docker-compose.recommendations.yml -f docker-compose.mert-amd.yml pull
docker compose -f docker-compose.yml -f docker-compose.images.yml -f docker-compose.recommendations.yml -f docker-compose.mert-amd.yml up -d
```

For source builds, omit `docker-compose.images.yml` and use `up -d --build`.
ROCm images become available for a release after its image workflow completes;
older releases published before AMD support do not contain that image.
For manual shutdown, stop `mert mert-init` with the same AMD Compose file list
before returning to the ordinary configuration.

## Weights and GPU setup

MERT-Large v1 (330M) uses official ready-made weights from
[`m-a-p/MERT-v1-330M`](https://huggingface.co/m-a-p/MERT-v1-330M), pinned to revision
`5240c2708a5acaee1007f43fb9735c7dcd0b78c9`. No training or export happens on the
server. The first embedding request downloads about 1.26 GB into `MERT_CACHE_PATH`
(default `./storage/models/mert`); subsequent starts reuse the cache. To reuse
the earlier benchmark download, set this path to
`./storage/experiments/mert/huggingface` in `.env`.

Linux Docker requires a working NVIDIA driver and NVIDIA Container Toolkit.
Check `nvidia-smi` on the host, then configure the Docker runtime using the
[official installation guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
An error `could not select device driver "nvidia"` means Docker GPU support has
not been configured; it does not prevent running the ordinary CPU deployment.

## Behaviour when enabled

The API extracts 3–8 five-second mono fragments at 24 kHz. MERT runs serially on
the local GPU, producing normalized 1024-dimensional vectors. Old models and
strategies are reanalysed automatically. The recommendation index accepts only
matching model, strategy, dimension and audio hash. Model loading and transient
GPU outages do not block ordinary library browsing or playback.

### On-demand GPU lifecycle

The HTTP service starts without loading PyTorch or creating a GPU context. The
first valid `POST /embed` starts a single GPU subprocess and returns `503` with
`Retry-After: 5` while it loads. The backend retains the pending work in the
database and retries on its next analysis pass (normally every 30 seconds).
It continues CPU audio analysis while MERT is loading or unavailable and preserves
existing embeddings until a replacement succeeds. Existing recommendations use
saved vectors and do not wake the GPU worker.

Inference runs one request at a time. Concurrent requests receive `503` with
`Retry-After: 1` while busy; PCM requests are not queued in memory. After five
minutes without inference, the subprocess terminates, releasing its GPU context
and model memory. The next embedding request wakes a new process using the cached
weights. An active inference is never stopped by the idle timer.

Configure the service in the deployment `.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MERT_IDLE_TIMEOUT_SECONDS` | `300` | Idle period before releasing the GPU; `0` disables idle shutdown. Loading still starts on demand. |
| `MERT_LOAD_TIMEOUT_SECONDS` | `1800` | Maximum model startup time, including the first weight download. |
| `MERT_INFERENCE_TIMEOUT_SECONDS` | `90` | Maximum wait for an inference result; keep below the API's 120-second HTTP timeout. |

Apply changes by recreating `mert` with your deployment's Compose file list.
Keep a nonzero idle timeout above the backend's 30-second polling interval, so
the next analysis pass can use a newly loaded worker before it goes to sleep.
For a standalone Python service, these environment variables or corresponding
`--idle-timeout-seconds`, `--load-timeout-seconds` and
`--inference-timeout-seconds` options work as well. `--download-only` still
eagerly loads and validates the model, then exits.

`GET /health` returns HTTP 200 with model identity and `state`:
`sleeping`, `loading`, `ready`, `busy` or `error`. This checks the HTTP service;
it never starts the GPU worker or resets the idle timer. `error` also includes
`retryAfterSeconds`. Once that delay expires, the state returns to `sleeping`
without starting a worker. Failed loads, crashes and inference timeouts stop the GPU
worker and apply a retry delay of 30, 60, 120, 240, then at most 300 seconds.
Recovery starts only when an embedding request arrives after the delay. A
successful inference resets the backoff. Service logs record process startup,
load and inference durations, failures and transitions to sleep.

The CUDA and ROCm GPU images are published alongside the API and web images only on `v*` release
tags. Default deployments do not pull or start those images. Model weights are
licensed separately under CC BY-NC 4.0. Music specialization does not by itself
guarantee better ranking or a more uniform 2D map.
