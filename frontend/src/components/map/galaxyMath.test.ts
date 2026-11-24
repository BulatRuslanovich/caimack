// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import {
  fitGalaxy,
  GALAXY_FOV,
  galaxyProjector,
  lassoGalaxyPoints,
  pickGalaxyPoint,
} from "./galaxyMath";

const camera = new PerspectiveCamera(GALAXY_FOV, 1, 0.01, 10);
camera.position.z = 2;
camera.updateMatrixWorld();

describe("galaxy screen projection", () => {
  const project = galaxyProjector(camera, 400, 400);
  const near = { position: new Vector3(0, 0, 1) };
  const far = { position: new Vector3(0, 0, -1) };
  const behind = { position: new Vector3(0, 0, 3) };
  const outside = { position: new Vector3(1, 0, 0) };

  it("picks the nearest visible star among overlapping hits", () => {
    expect(
      pickGalaxyPoint([far, behind, near], project, { x: 200, y: 200 }, camera.position)?.star,
    ).toBe(near);
  });

  it("includes both visible depths in the lasso and skips clipped stars", () => {
    const polygon = [
      { x: 180, y: 180 },
      { x: 220, y: 180 },
      { x: 220, y: 220 },
      { x: 180, y: 220 },
    ];
    expect(lassoGalaxyPoints([near, far, behind, outside], project, polygon)).toEqual([near, far]);
  });

  it("uses perspective and fits the map at portrait aspect ratios", () => {
    expect(project(new Vector3(0.1, 0, 1))!.x).toBeGreaterThan(project(new Vector3(0.1, 0, -1))!.x);
    expect(fitGalaxy(0.5, 0.5)).toBeGreaterThan(fitGalaxy(0.5, 2));
  });
});
