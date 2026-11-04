// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  const { query: $, all: $$, motionEnabled } = window.Caimack;
  const mobileNavigation = matchMedia("(max-width: 650px)");
  const menuButton = $(".mobile-menu-toggle");
  const navigation = $("#header-nav");
  function closeMenu(restoreFocus = false) {
    navigation.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
    if (restoreFocus) menuButton.focus({ preventScroll: true });
  }
  menuButton.addEventListener("click", () => {
    const open = navigation.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
  });
  document.addEventListener("click", (event) => {
    if (
      !navigation.contains(event.target) &&
      !menuButton.contains(event.target)
    )
      closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && navigation.classList.contains("open"))
      closeMenu(true);
  });
  mobileNavigation.addEventListener("change", () => closeMenu());
  $$('a[href^="#"]').forEach((link) =>
    link.addEventListener("click", (event) => {
      const destination = $(link.getAttribute("href"));
      if (!destination) return;
      event.preventDefault();
      closeMenu();
      if (destination.id === "main") {
        destination.tabIndex = -1;
        destination.focus({ preventScroll: true });
      }
      if (destination.id === "top")
        scrollTo({ top: 0, behavior: motionEnabled() ? "smooth" : "instant" });
      else
        destination.scrollIntoView({
          behavior: motionEnabled() ? "smooth" : "instant",
          block: "start",
        });
      history.replaceState(null, "", link.getAttribute("href"));
    }),
  );

  async function copy(text) {
    if (navigator.clipboard && isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        /* Local files may need the fallback. */
      }
    }
    const focused = document.activeElement;
    const field = document.createElement("textarea");
    field.value = text;
    field.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(field);
    field.select();
    const successful = document.execCommand("copy");
    field.remove();
    focused?.focus({ preventScroll: true });
    if (!successful) throw new Error("Clipboard unavailable");
  }
  $(".copy-demo").addEventListener("click", async () => {
    const feedback = $(".demo-details .copy-feedback");
    try {
      await copy("Username: demo_user\nPassword: demodemo");
      feedback.textContent = "Copied. You’re ready for the demo.";
    } catch {
      feedback.textContent = "Select and copy the details above.";
    }
  });
  $("#copy-setup").addEventListener("click", async () => {
    const button = $("#copy-setup");
    try {
      await copy($("#setup-commands").textContent.trim());
      button.querySelector("span").textContent = "Copied";
      $("#setup-feedback").textContent = "Setup commands copied.";
      setTimeout(() => {
        button.querySelector("span").textContent = "Copy";
        $("#setup-feedback").textContent = "";
      }, 2500);
    } catch {
      $("#setup-feedback").textContent = "Select and copy the commands above.";
    }
  });
  document.addEventListener("click", (event) => {
    const details = $(".demo-details");
    if (!details.contains(event.target)) details.open = false;
  });

  const themeControl = $(".theme-control");
  function setTheme(coffee) {
    document.documentElement.dataset.theme = coffee ? "coffee" : "oled";
    $('meta[name="theme-color"]').content = coffee ? "#171819" : "#000000";
    themeControl.setAttribute("aria-pressed", String(coffee));
    themeControl.setAttribute(
      "aria-label",
      coffee
        ? "Switch to OLED Black colour theme"
        : "Switch to Coffee colour theme",
    );
    themeControl.title = coffee ? "Try OLED Black" : "Try Coffee";
    $(".mobile-theme-control").textContent = coffee
      ? "Try OLED Black"
      : "Try Coffee";
    $(".mobile-theme-control").setAttribute("aria-pressed", String(coffee));
    try {
      localStorage.setItem("caimack.landing.theme", coffee ? "coffee" : "oled");
    } catch {
      /* Storage is optional. */
    }
  }
  try {
    setTheme(localStorage.getItem("caimack.landing.theme") === "coffee");
  } catch {
    setTheme(false);
  }
  themeControl.addEventListener("click", () =>
    setTheme(document.documentElement.dataset.theme !== "coffee"),
  );
  $(".mobile-theme-control").addEventListener("click", () =>
    setTheme(document.documentElement.dataset.theme !== "coffee"),
  );
})();
