// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { GlobeIcon, ListMusicIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Query } from "@/components/Query";
import { MusicSourceIcon } from "@/integrations/MusicSourceIcon";
import { useAvailableIntegrations } from "@/integrations/registry";
import {
  setExternalMusicSearch,
  setMusicDefault,
  setPlaylistLinkImport,
  useExternalMusicSearch,
  useMusicDefaults,
  useMusicSources,
  usePlaylistLinkImport,
} from "@/integrations/useMusicSources";

const sourceOrder = new Map([
  ["yandex", 0],
  ["vk", 1],
]);

export function MusicSources() {
  const t = useT();
  const externalSearch = useExternalMusicSearch();
  const linkImport = usePlaylistLinkImport() === true;
  const showSources = externalSearch || linkImport;
  const { sources, catalog } = useMusicSources(showSources);
  const integrations = useAvailableIntegrations();
  const disabled = useMusicDefaults();
  const visibleSources = sources
    .filter(
      ({ capabilities }) =>
        (externalSearch && (capabilities.tracks || capabilities.albums)) ||
        (linkImport && capabilities.playlist),
    )
    .sort(
      (a, b) =>
        (sourceOrder.get(a.id) ?? sourceOrder.size) - (sourceOrder.get(b.id) ?? sourceOrder.size),
    );
  const preferences = [
    {
      id: "external-music-search",
      Icon: GlobeIcon,
      title: t("music.externalSearch"),
      hint: t("music.externalSearchHint"),
      enabled: externalSearch,
      setEnabled: setExternalMusicSearch,
    },
    {
      id: "playlist-link-import",
      Icon: ListMusicIcon,
      title: t("music.importLink"),
      hint: t("music.linkImportHint"),
      enabled: linkImport,
      setEnabled: setPlaylistLinkImport,
    },
  ];

  return (
    <section aria-label={t("settings.music")} className="grid min-w-0 gap-5">
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {preferences.map(({ id, Icon, title, hint, enabled, setEnabled }) => (
          <div key={id} className="flex items-center gap-3 px-4 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
              <Icon size={20} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <label htmlFor={id} className="cursor-pointer text-sm font-semibold">
                {title}
              </label>
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                {hint}
              </p>
            </div>
            <Switch
              id={id}
              aria-describedby={`${id}-hint`}
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
        ))}
      </div>

      {showSources && (
        <Query
          result={catalog}
          isEmpty={() => visibleSources.length === 0}
          empty={{ title: t("music.noSources") }}
        >
          {() => (
            <ul
              aria-label={t(externalSearch ? "music.searchSources" : "music.playlistLinks")}
              className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
            >
              {visibleSources.map(({ id, name, capabilities, status, audioStatus }) => {
                const Settings = integrations.find((entry) => entry.id === id)?.Settings;
                const label = name ?? id;
                const selectable = externalSearch && (capabilities.tracks || capabilities.albums);
                const labelId = `music-source-name-${id}`;
                const connection =
                  status !== "ready"
                    ? t(`music.status.${status}`)
                    : audioStatus === "missingExtractor"
                      ? t("music.searchOnly")
                      : undefined;
                return (
                  <li key={id} className="px-3 py-2.5 sm:px-4">
                    <div className="flex items-center gap-3">
                      <MusicSourceIcon source={id} />
                      <div className="min-w-0 flex-1">
                        {selectable ? (
                          <label
                            htmlFor={`music-source-${id}`}
                            id={labelId}
                            className="cursor-pointer text-sm font-medium"
                          >
                            {label}
                          </label>
                        ) : (
                          <p className="text-sm font-medium">{label}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {[
                            capabilities.tracks && t("nav.tracks"),
                            capabilities.albums && t("nav.albums"),
                            linkImport && capabilities.playlist && t("music.playlistLinks"),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {connection && (
                          <p className="mt-1 text-xs text-muted-foreground">{connection}</p>
                        )}
                      </div>
                      {selectable && (
                        <Checkbox
                          id={`music-source-${id}`}
                          aria-labelledby={labelId}
                          checked={!disabled.includes(id)}
                          onCheckedChange={(value) => setMusicDefault(id, value === true)}
                          className="mr-1"
                        />
                      )}
                    </div>
                    {Settings && (
                      <details className="ml-10 mt-2 text-xs">
                        <summary className="w-fit cursor-pointer rounded-sm text-primary focus-visible:outline-2 focus-visible:outline-ring">
                          {t("music.connection")}
                        </summary>
                        <div className="pt-3">
                          <Settings />
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Query>
      )}
    </section>
  );
}
