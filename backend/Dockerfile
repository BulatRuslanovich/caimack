FROM rust:1.99-trixie AS chef
RUN cargo install cargo-chef --locked
WORKDIR /src

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS build
COPY --from=planner /src/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

COPY . .
COPY --from=db migrations /db/migrations
ENV SQLX_OFFLINE=true
RUN cargo build --release --locked --bin caimack

FROM debian:trixie-slim AS ffmpeg
ARG FFMPEG_VERSION=8.1.1
ARG FFMPEG_SHA256=b6863adde98898f42602017462871b5f6333e65aec803fdd7a6308639c52edf3
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates curl libmp3lame-dev nasm xz-utils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /ffmpeg
RUN curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -o ffmpeg.tar.xz \
        "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
    && echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xJf ffmpeg.tar.xz --strip-components=1 \
    && rm ffmpeg.tar.xz
RUN ./configure --prefix=/opt/ffmpeg \
        --disable-everything --disable-autodetect --disable-doc --disable-debug --disable-network \
        --disable-ffplay --disable-ffprobe --disable-avdevice --disable-swscale \
        --enable-protocol=file,pipe \
        --enable-demuxer=mp3,flac,mov,aac,ogg,matroska,mpegts,wav,aiff \
        --enable-parser=mpegaudio,flac,aac,opus,vorbis \
        --enable-decoder=mp3,mp3float,flac,aac,opus,vorbis,alac,pcm_s16le,pcm_s24le,pcm_s16be,pcm_s24be,pcm_f32le \
        --enable-libmp3lame --enable-encoder=aac,libmp3lame,pcm_s16le \
        --enable-muxer=hls,mp4,flac,mp3,null \
        --enable-filter=abuffer,abuffersink,aformat,anull,aresample,atrim \
    && make -j"$(nproc)" \
    && make install \
    && strip /opt/ffmpeg/bin/ffmpeg \
    && mkdir -p /out/storage/music /out/storage/covers

FROM debian:trixie-slim AS media-tools
ARG TARGETARCH
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /extractor
RUN case "$TARGETARCH" in \
      amd64) asset=yt-dlp_linux; checksum=767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795 ;; \
      arm64) asset=yt-dlp_linux_aarch64; checksum=e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483 ;; \
      *) exit 1 ;; \
    esac \
    && curl -fsSLO "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/$asset" \
    && printf '%s  %s\n' "$checksum" "$asset" | sha256sum -c - \
    && install -m 0755 "$asset" /usr/local/bin/yt-dlp

FROM debian:trixie-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates chromium-headless-shell libmp3lame0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ffmpeg --chown=65532:65532 /out/storage /storage
COPY --from=ffmpeg /opt/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=media-tools /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
COPY --from=denoland/deno:bin-2.9.7 /deno /usr/local/bin/deno
COPY --from=build /src/target/release/caimack /usr/local/bin/caimack

ENV MUSIC_CHROMIUM_NO_SANDBOX=true
USER 65532:65532

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=5 \
    CMD ["caimack", "healthcheck"]

ENTRYPOINT ["caimack"]
