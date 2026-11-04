// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { CSSProperties } from "react";

export type BlankRecordState = "empty" | "ready" | "dragging" | "uploading";

export function BlankRecord({ state, played }: { state: BlankRecordState; played: number }) {
  return (
    <div
      className="record blank-record"
      data-out="true"
      data-state={state}
      style={{ "--played": played / 100 } as CSSProperties}
      aria-hidden="true"
    >
      <div className="record-disc">
        <div className="record-spin">
          <div className="record-label blank-record-label" />
        </div>
        <div className="blank-record-played" />
        <div className="record-sheen" />
      </div>

      <div className="blank-record-sleeve" />
    </div>
  );
}
