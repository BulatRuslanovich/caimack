// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation } from "@tanstack/react-query";
import { RadioIcon } from "lucide-react";
import type { Track } from "@/lib/types";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";

export function RadioButton({ seed, label }: { seed: Track | null; label?: string }) {
  const t = useT();
  const player = usePlayerActions();
  const radio = useMutation({ mutationFn: () => player.startRadio(seed) });

  return (
    <Button onClick={() => radio.mutate()} disabled={radio.isPending}>
      <RadioIcon size={16} />
      {radio.isPending ? t("menu.radioStarting") : (label ?? t("action.radio"))}
    </Button>
  );
}
