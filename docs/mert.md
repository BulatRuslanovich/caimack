# Optional recommendations module

Recommendations are disabled by default. The ordinary release deployment requires
no NVIDIA driver, MERT image or model download:

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

## Weights and GPU setup

MERT-Large v1 (330M) uses official ready-made weights from
[`m-a-p/MERT-v1-330M`](https://huggingface.co/m-a-p/MERT-v1-330M), pinned to revision
`5240c2708a5acaee1007f43fb9735c7dcd0b78c9`. No training or export happens on the
server. The first enabled start downloads about 1.26 GB into `MERT_CACHE_PATH`
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

The GPU image is published alongside the API and web images only on `v*` release
tags. Default deployments do not pull or start that image. Model weights are
licensed separately under CC BY-NC 4.0. Music specialization does not by itself
guarantee better ranking or a more uniform 2D map.
