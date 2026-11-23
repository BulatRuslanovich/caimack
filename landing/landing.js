// SPDX-License-Identifier: AGPL-3.0-only

const heroTour = document.querySelector(".hero-tour");
const tourTabList = heroTour.querySelector(".tour-tabs");
const tourTabs = [...tourTabList.querySelectorAll('[role="tab"]')];

function selectTourTab(selectedTab) {
  if (selectedTab.getAttribute("aria-selected") === "true") return;

  for (const tab of tourTabs) {
    const isSelected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute("aria-controls"));
    panel.hidden = !isSelected;
    panel.classList.toggle("is-entering", isSelected);
  }
}

for (const tab of tourTabs) {
  tab.addEventListener("click", () => selectTourTab(tab));
}

tourTabList.addEventListener("keydown", (event) => {
  const index = tourTabs.indexOf(event.target);
  const last = tourTabs.length - 1;
  const nextByKey = {
    ArrowRight: index === last ? 0 : index + 1,
    ArrowLeft: index === 0 ? last : index - 1,
    Home: 0,
    End: last,
  };
  if (!Object.hasOwn(nextByKey, event.key)) return;

  event.preventDefault();
  const nextTab = tourTabs[nextByKey[event.key]];
  selectTourTab(nextTab);
  nextTab.focus();
});

tourTabList.hidden = false;

const lightbox = document.querySelector(".lightbox");
const lightboxTitle = document.querySelector("#lightbox-title");
const lightboxView = document.querySelector("#lightbox-view");
const lightboxImage = lightboxView.querySelector("img");
const lightboxStatus = lightboxView.querySelector(".lightbox-status");
const zoomButton = document.querySelector(".zoom-button");
let screenshotLink;

function setZoom(zoomed) {
  if (zoomed) {
    lightboxView.style.setProperty("--zoom-width", `${lightboxImage.offsetWidth * 2}px`);
  }
  lightboxView.classList.toggle("is-zoomed", zoomed);
  zoomButton.toggleAttribute("data-zoomed", zoomed);
  const label = zoomed ? "Вписать в экран" : "Увеличить";
  zoomButton.setAttribute("aria-label", label);
  zoomButton.title = label;

  lightboxView.scrollTo({
    left: zoomed ? (lightboxView.scrollWidth - lightboxView.clientWidth) / 2 : 0,
    top: zoomed ? (lightboxView.scrollHeight - lightboxView.clientHeight) / 2 : 0,
    behavior: "instant",
  });
}

function showLightboxImage() {
  lightboxImage.hidden = false;
  lightboxStatus.textContent = "";
  zoomButton.disabled = false;
}

if (typeof lightbox.showModal === "function") {
  lightboxImage.addEventListener("load", showLightboxImage);
  lightboxImage.addEventListener("error", () => {
    lightboxStatus.textContent = "Скриншот не загрузился. Закрой просмотр и попробуй ещё раз.";
  });

  for (const link of document.querySelectorAll("[data-screenshot]")) {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      event.preventDefault();
      const preview = link.querySelector("img");
      screenshotLink = link;
      const caption = link.closest("figure").querySelector("figcaption");
      lightboxTitle.textContent =
        link.dataset.lightboxTitle || caption?.textContent.trim() || "Скриншот";
      lightboxImage.alt = preview.alt;
      lightboxImage.hidden = true;
      lightboxStatus.textContent = "Загрузка скриншота…";
      zoomButton.disabled = true;
      lightboxImage.src = link.href;
      setZoom(false);
      lightbox.showModal();
      if (lightboxImage.complete && lightboxImage.naturalWidth) showLightboxImage();
    });
  }

  zoomButton.addEventListener("click", () => {
    setZoom(!lightboxView.classList.contains("is-zoomed"));
  });

  let drag;
  lightboxImage.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (!lightboxView.classList.contains("is-zoomed")) return;

    drag = {
      x: event.clientX,
      y: event.clientY,
      left: lightboxView.scrollLeft,
      top: lightboxView.scrollTop,
    };
    lightboxImage.setPointerCapture(event.pointerId);
    lightboxView.classList.add("is-panning");
  });

  lightboxImage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    lightboxView.scrollLeft = drag.left + drag.x - event.clientX;
    lightboxView.scrollTop = drag.top + drag.y - event.clientY;
  });

  lightboxImage.addEventListener("lostpointercapture", () => {
    drag = undefined;
    lightboxView.classList.remove("is-panning");
  });

  lightbox.addEventListener("click", (event) => {
    if (event.target.closest("button, img, .lightbox-caption, .lightbox-status")) return;
    if (event.target.closest(".lightbox-view.is-zoomed")) return;
    lightbox.close();
  });

  lightbox.addEventListener("close", () => {
    screenshotLink.focus({ preventScroll: true });
  });
}

const copyButton = document.querySelector(".copy-button");
const commandBlock = document.querySelector("#setup-commands");
const copyStatus = document.querySelector(".copy-status");

function copySelectedCommands() {
  const selection = window.getSelection();
  if (!selection) return false;

  const range = document.createRange();
  range.selectNodeContents(commandBlock);
  selection.removeAllRanges();
  selection.addRange(range);

  try {
    const copied = document.execCommand("copy");
    if (copied) selection.removeAllRanges();
    return copied;
  } catch {
    return false;
  }
}

copyButton.hidden = false;
copyButton.addEventListener("click", async () => {
  let copied;
  try {
    await navigator.clipboard.writeText(commandBlock.textContent);
    copied = true;
  } catch {
    copied = copySelectedCommands();
  }
  copyStatus.textContent = copied
    ? "Команды скопированы."
    : "Скопируй команды вручную из блока выше.";
});

if (typeof IntersectionObserver === "function") {
  const sectionLinks = new Map(
    [...document.querySelectorAll('.site-nav a[href^="#"]')].map((link) => [
      document.querySelector(link.hash),
      link,
    ]),
  );
  let sectionObserver;
  function observeNavigationSections() {
    const top = Math.round(window.innerHeight * 0.3);
    const bottom = window.innerHeight - top - 1;
    sectionObserver?.disconnect();
    sectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const link = sectionLinks.get(entry.target);
          if (entry.isIntersecting) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        }
      },
      { rootMargin: `-${top}px 0px -${bottom}px 0px` },
    );
    for (const section of sectionLinks.keys()) sectionObserver.observe(section);
  }
  observeNavigationSections();
  window.addEventListener("resize", observeNavigationSections);

  const offlineHeadline = document.querySelector(".offline-headline");
  const wordObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        wordObserver.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -32px 0px" },
  );

  let wordIndex = 0;
  for (const line of offlineHeadline.children) {
    line.replaceChildren(
      ...line.textContent.trim().split(/(\s+)/).map((word) => {
        if (!word.trim()) return word;
        const span = document.createElement("span");
        span.className = "reveal-word";
        span.style.setProperty("--word-index", wordIndex++);
        span.textContent = word;
        wordObserver.observe(span);
        return span;
      }),
    );
  }
}
