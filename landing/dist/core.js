// SPDX-License-Identifier: AGPL-3.0-only
// Shared browser primitives; individual components own their state and event handlers.
(() => {
  const query = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const clamp = (value, low = 0, high = 1) =>
    Math.min(high, Math.max(low, value));
  const progress = (value, start, end) =>
    clamp((value - start) / Math.max(1, end - start));
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  let preference = null;
  const motionEnabled = () =>
    typeof Element.prototype.animate === "function" &&
    (preference ?? !reducedMotion.matches);
  const finiteAnimations = new Set();
  function animate(element, frames, options = {}) {
    if (!motionEnabled()) return null;
    const animation = element.animate(frames, {
      duration: 650,
      easing: "cubic-bezier(.16,1,.3,1)",
      fill: "backwards",
      ...options,
    });
    finiteAnimations.add(animation);
    animation.finished.then(
      () => finiteAnimations.delete(animation),
      () => finiteAnimations.delete(animation),
    );
    return animation;
  }
  window.Caimack = Object.freeze({
    query,
    all,
    clamp,
    progress,
    reducedMotion,
    finePointer,
    motionEnabled,
    finiteAnimations,
    animate,
    announce: (text) => {
      query("#announcement").textContent = text;
    },
    topOf: (element) => element.getBoundingClientRect().top + scrollY,
    layoutChanged: () => document.dispatchEvent(new Event("caimack:layout")),
    getMotionPreference: () => preference,
    setMotionPreference: (value) => {
      preference = value;
    },
  });
})();
