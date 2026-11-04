// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  const {
    query: $,
    all: $$,
    clamp,
    progress,
    topOf,
    animate,
    finiteAnimations,
    motionEnabled,
    reducedMotion,
    finePointer,
    getMotionPreference,
    setMotionPreference,
  } = window.Caimack;
  const motionControl = $(".motion-control");
  // Motion is progressive enhancement. Text and screenshots are never scroll-gated.
  const hero = $(".hero");
  const visual = $(".hero-visual");
  const product = $(".hero-product");
  const mapFigure = $(".map-figure");
  const mobileDevice = $(".mobile-device");
  const footerWordmark = $(".footer-wordmark");
  const record = $(".record-spin");
  let recordAnimation;
  let heroVisible = true;
  let entered = false;
  let frame = 0;
  let lastFrame = 0;
  let smoothY = scrollY;
  let bounds = {};
  const tilt = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const magnets = $$(".magnetic").map((element) => ({
    element,
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
  }));
  let measureFrame = 0;

  function updateRecord() {
    if (!recordAnimation) return;
    if (motionEnabled() && heroVisible && !document.hidden)
      recordAnimation.play();
    else recordAnimation.pause();
  }
  function entrance() {
    const productBase = getComputedStyle(product).transform;
    animate(
      $(".brand"),
      [
        { opacity: 0, transform: "translateY(-10px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 650 },
    );
    $$(".line-mask>span").forEach((element, index) =>
      animate(
        element,
        [{ transform: "translateY(110%)" }, { transform: "none" }],
        { duration: 1000, delay: 100 + index * 110 },
      ),
    );
    animate(
      $(".hero-description"),
      [
        { opacity: 0, transform: "translateY(14px)" },
        { opacity: 1, transform: "none" },
      ],
      { delay: 350, duration: 800 },
    );
    animate(
      $(".hero-copy .actions"),
      [
        { opacity: 0, transform: "translateY(12px)" },
        { opacity: 1, transform: "none" },
      ],
      { delay: 450, duration: 750 },
    );
    animate(
      product,
      [
        {
          opacity: 0,
          transform: "translateY(35px) rotateY(-15deg) rotateZ(3deg)",
        },
        { opacity: 1, transform: productBase },
      ],
      { duration: 1200, delay: 150 },
    );
    const phone = $(".hero-handset");
    animate(
      phone,
      [
        { opacity: 0, transform: "translateY(40px) rotate(10deg)" },
        { opacity: 1, transform: getComputedStyle(phone).transform },
      ],
      { duration: 1100, delay: 420 },
    );
    animate(
      $(".hero-record"),
      [
        { opacity: 0, transform: "translateX(-60px) scale(.85)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 1300, delay: 300 },
    );
  }
  function requestPaint() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(paint);
  }
  function measure() {
    measureFrame = 0;
    bounds = {
      heroStart: topOf(hero),
      heroEnd: topOf(hero) + hero.offsetHeight,
      mapTop: topOf($(".sound-map")),
      mobileTop: topOf($(".everywhere")),
      footerTop: topOf($(".footer")),
      max: Math.max(1, document.documentElement.scrollHeight - innerHeight),
    };
    requestPaint();
  }
  function scheduleMeasure() {
    if (!measureFrame) measureFrame = requestAnimationFrame(measure);
  }
  function paint(time) {
    frame = 0;
    $(".site-header").classList.toggle("scrolled", scrollY > 15);
    $(".read-progress").style.transform =
      `scaleX(${clamp(scrollY / (bounds.max || 1))})`;
    const navTargets = [$("#sound-map"), $("#listening"), $("#get-started")];
    let current;
    navTargets.forEach((target) => {
      if (topOf(target) <= scrollY + innerHeight * 0.35) current = target.id;
    });
    $$(".header-nav a").forEach((link) => {
      if (link.hash === `#${current}`)
        link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    if (!motionEnabled() || !bounds.heroEnd) return;
    const blend =
      1 - Math.exp(-Math.min(64, time - (lastFrame || time - 16)) / 80);
    lastFrame = time;
    smoothY += (scrollY - smoothY) * blend;
    if (Math.abs(scrollY - smoothY) < 0.05) smoothY = scrollY;
    const heroProgress = progress(smoothY, bounds.heroStart, bounds.heroEnd);
    let settling = Math.abs(scrollY - smoothY) > 0.05;
    tilt.x += (tilt.targetX - tilt.x) * blend;
    tilt.y += (tilt.targetY - tilt.y) * blend;
    visual.style.transform = `translate3d(0,${-heroProgress * 22}px,0) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`;
    const mapProgress = progress(
      smoothY,
      bounds.mapTop - innerHeight * 0.8,
      bounds.mapTop - innerHeight * 0.05,
    );
    mapFigure.style.transform = `translateY(${(1 - mapProgress) * 20}px) scale(${0.975 + 0.025 * mapProgress})`;
    const mobileProgress = progress(
      smoothY,
      bounds.mobileTop - innerHeight * 0.7,
      bounds.mobileTop - innerHeight * 0.05,
    );
    mobileDevice.style.transform = `translateY(${(1 - mobileProgress) * 30}px) rotate(${-8 + 3 * mobileProgress}deg)`;
    const footerProgress = progress(
      smoothY,
      bounds.footerTop - innerHeight,
      Math.min(bounds.max, bounds.footerTop - innerHeight * 0.45),
    );
    footerWordmark.style.clipPath = `inset(0 ${(1 - footerProgress) * 100}% 0 0)`;
    settling ||=
      Math.abs(tilt.x - tilt.targetX) + Math.abs(tilt.y - tilt.targetY) > 0.01;
    magnets.forEach((magnet) => {
      magnet.x += (magnet.targetX - magnet.x) * blend;
      magnet.y += (magnet.targetY - magnet.y) * blend;
      magnet.element.style.transform = `translate(${magnet.x}px,${magnet.y}px)`;
      settling ||=
        Math.abs(magnet.x - magnet.targetX) +
          Math.abs(magnet.y - magnet.targetY) >
        0.01;
    });
    if (settling) requestPaint();
  }
  function updateMotion() {
    const running = motionEnabled();
    document.body.classList.toggle("motion-off", !running);
    motionControl.setAttribute("aria-pressed", String(running));
    motionControl.setAttribute(
      "aria-label",
      running ? "Pause animation" : "Resume animation",
    );
    motionControl.title = running ? "Pause animation" : "Resume animation";
    $(".mobile-motion-control").setAttribute("aria-pressed", String(running));
    $(".mobile-motion-control").textContent = running
      ? "Pause animation"
      : "Resume animation";
    finiteAnimations.forEach((animation) => animation.cancel());
    finiteAnimations.clear();
    if (!running) {
      [
        visual,
        mapFigure,
        mobileDevice,
        ...magnets.map((item) => item.element),
      ].forEach((element) => element.style.removeProperty("transform"));
      footerWordmark.style.removeProperty("clip-path");
      tilt.x = tilt.y = tilt.targetX = tilt.targetY = 0;
      magnets.forEach((magnet) => {
        magnet.x = magnet.y = magnet.targetX = magnet.targetY = 0;
      });
    } else {
      if (!entered) {
        entrance();
        entered = true;
      }
      if (!recordAnimation)
        recordAnimation = record.animate(
          [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
          { duration: 22000, iterations: Infinity, easing: "linear" },
        );
      smoothY = scrollY;
      lastFrame = 0;
    }
    updateRecord();
    scheduleMeasure();
  }
  motionControl.addEventListener("click", () => {
    setMotionPreference(!motionEnabled());
    updateMotion();
  });
  $(".mobile-motion-control").addEventListener("click", () => {
    setMotionPreference(!motionEnabled());
    updateMotion();
  });
  reducedMotion.addEventListener("change", () => {
    if (getMotionPreference() === null) updateMotion();
  });
  const heroObserver = new IntersectionObserver((entries) => {
    heroVisible = entries[0].isIntersecting;
    updateRecord();
  });
  heroObserver.observe(hero);
  visual.addEventListener("pointermove", (event) => {
    if (!motionEnabled() || !finePointer.matches) return;
    const rect = visual.getBoundingClientRect();
    tilt.targetY = ((event.clientX - rect.left) / rect.width - 0.5) * 4;
    tilt.targetX = -((event.clientY - rect.top) / rect.height - 0.5) * 3;
    requestPaint();
  });
  visual.addEventListener("pointerleave", () => {
    tilt.targetX = tilt.targetY = 0;
    requestPaint();
  });
  magnets.forEach((magnet) => {
    magnet.element.addEventListener("pointermove", (event) => {
      if (!motionEnabled() || !finePointer.matches) return;
      const rect = magnet.element.getBoundingClientRect();
      magnet.targetX = (event.clientX - rect.left - rect.width / 2) * 0.1;
      magnet.targetY = (event.clientY - rect.top - rect.height / 2) * 0.15;
      requestPaint();
    });
    magnet.element.addEventListener("pointerleave", () => {
      magnet.targetX = magnet.targetY = 0;
      requestPaint();
    });
  });
  addEventListener("scroll", requestPaint, { passive: true });
  addEventListener("resize", scheduleMeasure);
  document.addEventListener("visibilitychange", () => {
    updateRecord();
    if (!document.hidden) {
      lastFrame = 0;
      requestPaint();
    }
  });
  $$("details").forEach((details) =>
    details.addEventListener("toggle", scheduleMeasure),
  );
  new ResizeObserver(scheduleMeasure).observe($("#main"));
  document.addEventListener("caimack:layout", scheduleMeasure);
  document.fonts.ready.then(updateMotion);
  addEventListener("load", scheduleMeasure);
})();
