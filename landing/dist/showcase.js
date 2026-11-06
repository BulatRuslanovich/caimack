// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  const {
    query: $,
    all: $$,
    animate,
    announce,
    motionEnabled,
    layoutChanged,
  } = window.Caimack;
  const screens = [
    {
      id: "player",
      src: "assets/player-coffee.webp",
      title: "Full-screen player",
      theme: "Coffee",
      alt: "Caimack full-screen player with vinyl artwork, waveform and transport controls",
      width: 1440,
      height: 1000,
    },
    {
      id: "home",
      src: "assets/home-oled.webp",
      title: "Personal radio & your collection",
      theme: "OLED Black",
      alt: "Caimack home with personal radio, daily mix and new albums",
      width: 1440,
      height: 1000,
    },
    {
      id: "map-detail",
      src: "assets/shots/map-detail.webp",
      title: "Library map, closer look",
      theme: "OLED Black",
      alt: "Caimack library map with clusters of tracks and playback routes",
      width: 1440,
      height: 1000,
    },
    {
      id: "map",
      src: "assets/shots/library-map.webp",
      title: "Library map, overview",
      theme: "OLED Black",
      alt: "The whole library map with a playback route through tracks",
      width: 1440,
      height: 1000,
    },
    {
      id: "mix",
      src: "assets/shots/daily-mix.webp",
      title: "Daily mix",
      theme: "Coffee",
      alt: "A daily mix with cover collage and a personalised track list",
      width: 1440,
      height: 1000,
    },
    {
      id: "lyrics",
      src: "assets/shots/synced-lyrics.webp",
      title: "Synced lyrics",
      theme: "Coffee",
      alt: "Full-screen player with synced lyrics beside the waveform and playback controls",
      width: 1440,
      height: 1000,
    },
    {
      id: "queue",
      src: "assets/shots/queue.webp",
      title: "Playback queue",
      theme: "Coffee",
      alt: "The playback queue with upcoming tracks and keep playing similar tracks enabled",
      width: 1440,
      height: 1000,
    },
    {
      id: "artist",
      src: "assets/shots/artist.webp",
      title: "Artist & discography",
      theme: "Coffee",
      alt: "BONES artist page with popular tracks and an eighteen-album discography",
      width: 1440,
      height: 1000,
    },
    {
      id: "search",
      src: "assets/shots/search.webp",
      title: "Search the collection",
      theme: "OLED Black",
      alt: "Search results for Arctic Monkeys with tracks, albums and the artist",
      width: 1440,
      height: 1000,
    },
    {
      id: "history",
      src: "assets/shots/history.webp",
      title: "Listening history",
      theme: "Coffee",
      alt: "Recently played tracks with albums and listening times",
      width: 1440,
      height: 1000,
    },
    {
      id: "mobile",
      src: "assets/mobile-oled.webp",
      title: "Mobile web player",
      theme: "OLED Black",
      alt: "Caimack mobile web player with vinyl artwork and waveform",
      width: 390,
      height: 960,
    },
    {
      id: "album",
      src: "assets/album-coffee.webp",
      title: "Album details",
      theme: "Coffee",
      alt: "AM by Arctic Monkeys with track list and related albums",
      width: 1440,
      height: 1000,
    },
  ];
  const screenById = new Map(screens.map((screen) => [screen.id, screen]));
  const sceneCopy = {
    home: {
      title: "Your collection, with a few good surprises.",
      description:
        "Personal radio learns from your listening history and finds new connections in the music you already own.",
    },
    mix: {
      title: "Something new to press play on.",
      description:
        "A daily selection of familiar tracks and fresh connections. Open it, shuffle it, or let the whole mix play.",
    },
    lyrics: {
      title: "Every word gets its moment.",
      description:
        "Synced lines follow the track. Your waveform and playback controls stay close, so the song can take the room.",
    },
    queue: {
      title: "The next good track is already lined up.",
      description:
        "See what comes next, make the queue your own, and keep playing similar tracks when you want the session to carry on.",
    },
  };

  // Decode before swapping; rapid selections cannot commit an older image.
  const imageRevisions = new WeakMap();
  async function swapScreen(image, id, commit) {
    const screen = screenById.get(id);
    const revision = (imageRevisions.get(image) ?? 0) + 1;
    imageRevisions.set(image, revision);
    const preloader = new Image();
    preloader.src = screen.src;
    try {
      await preloader.decode();
    } catch {
      announce("The screenshot could not be loaded. Please try again.");
      return false;
    }
    if (imageRevisions.get(image) !== revision) return false;
    image.getAnimations().forEach((animation) => animation.cancel());
    image.src = screen.src;
    image.alt = screen.alt;
    image.closest("[data-screen]").dataset.screen = id;
    commit(screen);
    animate(
      image,
      [
        { opacity: 0.3, transform: "translateY(7px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 350 },
    );
    layoutChanged();
    return true;
  }

  $$("[data-hero]").forEach((button) =>
    button.addEventListener("click", () => {
      swapScreen($("#hero-screen"), button.dataset.hero, (screen) => {
        $$("[data-hero]").forEach((item) =>
          item.setAttribute("aria-pressed", String(item === button)),
        );
        $("#hero-caption").textContent = `${screen.title} · ${screen.theme}`;
      });
    }),
  );
  $$("[data-map]").forEach((button) =>
    button.addEventListener("click", () => {
      swapScreen($("#map-screen"), button.dataset.map, () => {
        $$("[data-map]").forEach((item) =>
          item.setAttribute("aria-pressed", String(item === button)),
        );
      });
    }),
  );
  $$("[data-collection]").forEach((button) =>
    button.addEventListener("click", () => {
      swapScreen(
        $("#collection-screen"),
        button.dataset.collection,
        (screen) => {
          $$("[data-collection]").forEach((item) =>
            item.setAttribute("aria-pressed", String(item === button)),
          );
          $("#collection-caption").textContent =
            screen.id === "album"
              ? "Every album, in its own little world."
              : "The artist. The albums. The whole story.";
          $("#collection-description").textContent =
            screen.id === "album"
              ? "Track lists, audio details and more from the same artist, with colours drawn from the cover."
              : "Discographies, popular tracks and artist radio. Everything that brings you back.";
        },
      );
    }),
  );
  const sceneTabs = $$("[data-scene]");
  const horizontalScenes = matchMedia("(max-width: 900px)");
  const updateOrientation = () =>
    $(".scene-tabs").setAttribute(
      "aria-orientation",
      horizontalScenes.matches ? "horizontal" : "vertical",
    );
  updateOrientation();
  horizontalScenes.addEventListener("change", updateOrientation);
  function selectScene(button) {
    return swapScreen($("#listen-screen"), button.dataset.scene, (screen) => {
      sceneTabs.forEach((tab) => {
        const selected = tab === button;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      $("#listen-panel").setAttribute("aria-labelledby", button.id);
      $("#listen-caption").textContent = sceneCopy[screen.id].title;
      $("#listen-description").textContent = sceneCopy[screen.id].description;
      $("#listen-theme").textContent = screen.theme;
      announce(`${screen.title} selected.`);
    });
  }
  sceneTabs.forEach((tab) => {
    tab.addEventListener("click", () => selectScene(tab));
    tab.addEventListener("keydown", (event) => {
      const index = sceneTabs.indexOf(tab);
      const next = {
        ArrowDown: (index + 1) % sceneTabs.length,
        ArrowRight: (index + 1) % sceneTabs.length,
        ArrowUp: (index + sceneTabs.length - 1) % sceneTabs.length,
        ArrowLeft: (index + sceneTabs.length - 1) % sceneTabs.length,
        Home: 0,
        End: sceneTabs.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const target = sceneTabs[next];
      target.focus({ preventScroll: true });
      if (innerWidth <= 900)
        target.scrollIntoView({
          behavior: motionEnabled() ? "smooth" : "instant",
          block: "nearest",
          inline: "nearest",
        });
      selectScene(target);
    });
  });

  // Real screenshot viewer: fit, native-size pan, keyboard navigation and focus restoration.
  const lightbox = $("#lightbox");
  const lightboxImage = $("#lightbox-image");
  const viewport = $("#lightbox-viewport");
  const zoomButton = $("#lightbox-zoom");
  let lightboxIndex = 0;
  let lightboxTrigger;
  let originalBodyOverflow = "";
  viewport.tabIndex = 0;
  function resetZoom() {
    lightbox.classList.remove("zoomed");
    zoomButton.setAttribute("aria-pressed", "false");
    zoomButton.textContent = "100%";
    viewport.scrollTop = viewport.scrollLeft = 0;
  }
  function showLightboxScreen(index) {
    lightboxIndex = (index + screens.length) % screens.length;
    const screen = screens[lightboxIndex];
    resetZoom();
    lightboxImage.src = screen.src;
    lightboxImage.alt = screen.alt;
    lightboxImage.width = screen.width;
    lightboxImage.height = screen.height;
    $("#lightbox-title").textContent = `${screen.title} · ${screen.theme}`;
    $("#lightbox-count").textContent =
      `${lightboxIndex + 1} / ${screens.length}`;
  }
  $$(".preview[data-screen]").forEach((button) =>
    button.addEventListener("click", () => {
      lightboxTrigger = button;
      showLightboxScreen(
        screens.findIndex((screen) => screen.id === button.dataset.screen),
      );
      originalBodyOverflow = document.body.style.overflow;
      lightbox.showModal();
      document.body.style.overflow = "hidden";
      $("#close-lightbox").focus({ preventScroll: true });
    }),
  );
  $("#close-lightbox").addEventListener("click", () => lightbox.close());
  $("#previous-shot").addEventListener("click", () =>
    showLightboxScreen(lightboxIndex - 1),
  );
  $("#next-shot").addEventListener("click", () =>
    showLightboxScreen(lightboxIndex + 1),
  );
  zoomButton.addEventListener("click", () => {
    const zoomed = lightbox.classList.toggle("zoomed");
    zoomButton.setAttribute("aria-pressed", String(zoomed));
    zoomButton.textContent = zoomed ? "Fit" : "100%";
    viewport.scrollTop = viewport.scrollLeft = 0;
    if (zoomed) viewport.focus({ preventScroll: true });
  });
  lightbox.addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight"].includes(event.key) ||
      lightbox.classList.contains("zoomed")
    )
      return;
    event.preventDefault();
    showLightboxScreen(lightboxIndex + (event.key === "ArrowRight" ? 1 : -1));
  });
  viewport.addEventListener("click", (event) => {
    if (event.target === viewport) lightbox.close();
  });
  lightbox.addEventListener("close", () => {
    document.body.style.overflow = originalBodyOverflow;
    resetZoom();
    lightboxTrigger?.focus({ preventScroll: true });
  });
})();
