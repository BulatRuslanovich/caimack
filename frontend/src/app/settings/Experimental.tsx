// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { Switch } from "@/components/ui/switch";
import { useAvailableIntegrations } from "@/integrations/registry";
import { useT } from "@/contexts/I18nContext";
import { Panel } from "./Panel";
import { useSetAudiobookExperiment } from "@/lib/audiobookExperiment";
import { useAudiobooks } from "@/contexts/AudiobookContext";

export function Experimental() {
  const t = useT();
  const { enabled, experimentReady, scope } = useAudiobooks();
  const change = useSetAudiobookExperiment(scope);
  const integrations = useAvailableIntegrations();
  return (
    <Panel title={t("settings.experimental")}>
      <label className="flex cursor-pointer items-start gap-3">
        <Switch
          className="mt-0.5"
          checked={enabled}
          disabled={!experimentReady || change.isPending}
          aria-describedby="audiobooks-experiment-hint"
          onCheckedChange={(value) => change.mutate(value)}
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium">{t("nav.audiobooks")}</span>
          <span id="audiobooks-experiment-hint" className="text-sm text-muted-foreground">
            {t("settings.audiobooksHint")}
          </span>
        </span>
      </label>
      {integrations.map(({ id, Settings }) => (
        <Settings key={id} />
      ))}
    </Panel>
  );
}
