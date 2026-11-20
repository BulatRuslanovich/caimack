// SPDX-License-Identifier: AGPL-3.0-only

export const capFourOnMobile = "max-md:[&>*:nth-child(n+5)]:hidden";
export const capFiveOnMobile = "max-md:[&>*:nth-child(n+6)]:hidden";
export const dropOrphanRow = [
  "xl:[&>li:nth-child(3n+1):not(:first-child):nth-last-child(-n+2)]:hidden",
  "xl:[&>li:nth-child(3n+1):not(:first-child):nth-last-child(-n+2)~li]:hidden",
];

export const deferredSection = "[content-visibility:auto] [contain-intrinsic-size:auto_18rem]";

export const listPanel = "listening-panel rounded-xl bg-card p-5 max-md:-mx-1 max-md:p-3";
