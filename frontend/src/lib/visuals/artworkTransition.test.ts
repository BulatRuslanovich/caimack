// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createArtworkTransition,
  finishArtwork,
  requestArtwork,
  type ArtworkRequest,
} from "./artworkTransition";

const tone = { hue: 150, chroma: 0.08, lightness: 0.5 };
function request(
  id: string,
  changes: Partial<ArtworkRequest<string>> = {},
): ArtworkRequest<string> {
  return { key: id, item: id, src: `${id}.jpg`, tone, direction: "next", ...changes };
}

describe("artwork scene transitions", () => {
  it("fills the initial palette without sliding the first track", () => {
    const loading = createArtworkTransition(request("a", { tone: undefined }));
    const ready = requestArtwork(loading, request("a"));
    expect(ready.current.tone).toBe(tone);
    expect(ready.previous).toBeNull();
    expect(ready.revision).toBe(0);
  });

  it("keeps the old scene intact until the new palette is ready", () => {
    const initial = createArtworkTransition(request("a"));
    const loading = requestArtwork(initial, request("b", { tone: undefined }));
    expect(loading.current).toBe(initial.current);
    expect(loading.previous).toBeNull();
    const ready = requestArtwork(loading, request("b"));
    expect(ready.previous).toBe(initial.current);
    expect(ready.current.item).toBe("b");
  });

  it("does not replace either moving scene when the user skips repeatedly", () => {
    let state = requestArtwork(createArtworkTransition(request("a")), request("b"));
    const moving = state;
    for (let index = 0; index < 100; index++) {
      state = requestArtwork(state, request(`skip-${index}`));
      expect(state.current).toBe(moving.current);
      expect(state.previous).toBe(moving.previous);
      expect(state.revision).toBe(moving.revision);
    }
    state = finishArtwork(state, state.revision);
    expect(state.previous?.item).toBe("b");
    expect(state.current.item).toBe("skip-99");
    expect(state.pending).toBeNull();
    state = finishArtwork(state, state.revision);
    expect(state.previous).toBeNull();
  });

  it("queues a reversal without teleporting either cover", () => {
    const moving = requestArtwork(createArtworkTransition(request("a")), request("b"));
    const reverse = requestArtwork(moving, request("a", { direction: "previous" }));
    expect(reverse.direction).toBe("next");
    expect(reverse.current).toBe(moving.current);
    const next = finishArtwork(reverse, moving.revision);
    expect(next.direction).toBe("previous");
    expect(next.previous?.item).toBe("b");
    expect(next.current.item).toBe("a");
  });

  it("ignores late completion events from another layer or an earlier transition", () => {
    let state = requestArtwork(createArtworkTransition(request("a")), request("b"));
    const oldRevision = state.revision;
    state = requestArtwork(state, request("c"));
    state = finishArtwork(state, oldRevision);
    expect(finishArtwork(state, oldRevision)).toBe(state);
    expect(state.previous?.item).toBe("b");
    expect(state.current.item).toBe("c");
  });

  it("keeps all layers together even when adjacent tracks share a cover", () => {
    const state = requestArtwork(
      createArtworkTransition(request("a", { src: "album.jpg" })),
      request("b", { src: "album.jpg" }),
    );
    expect(state.previous?.src).toBe(state.current.src);
    expect(state.previous?.key).not.toBe(state.current.key);
    expect(state.previous?.item).toBe("a");
    expect(state.current.item).toBe("b");
  });

  it("discards a queued scene if the latest requested track is still loading", () => {
    let state = requestArtwork(createArtworkTransition(request("a")), request("b"));
    state = requestArtwork(state, request("c"));
    state = requestArtwork(state, request("d", { tone: undefined }));
    state = finishArtwork(state, state.revision);
    expect(state.current.item).toBe("b");
    expect(state.previous).toBeNull();
    expect(state.pending).toBeNull();
    state = requestArtwork(state, request("d", { tone: null }));
    expect(state.current.item).toBe("d");
    expect(state.current.tone).toBeNull();
  });

  it("cancels a queued skip when the user returns to the incoming track", () => {
    let state = requestArtwork(createArtworkTransition(request("a")), request("b"));
    state = requestArtwork(state, request("c"));
    state = requestArtwork(state, request("b"));
    expect(state.pending).toBeNull();
    const done = finishArtwork(state, state.revision);
    expect(done.current.item).toBe("b");
    expect(done.previous).toBeNull();
  });
});
