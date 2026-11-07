// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useState } from "react";
import { CheckIcon, LoaderCircleIcon, MonitorSpeakerIcon, SmartphoneIcon } from "lucide-react";
import { useConnect } from "@/lib/playback/useConnectPlayback";
import { deviceId } from "@/lib/events";
import { cn } from "@/lib/cn";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";

export function PlaybackDevices({
  compact = false,
  onlyRemote = false,
  className,
}: {
  compact?: boolean;
  onlyRemote?: boolean;
  className?: string;
}) {
  const connect = useConnect();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const select = async (id: string | null) => {
    setChoosing(true);
    try {
      await connect.select(id);
      setOpen(false);
    } catch {
      /* The player reports command failures. Keep the device list open. */
    } finally {
      setChoosing(false);
    }
  };
  const label = connect.selectedId
    ? t(connect.available ? "connect.playingOn" : "connect.unavailable", {
        device: connect.selectedName,
      })
    : t("connect.title");
  if (onlyRemote && !connect.selectedId) return null;
  return (
    <>
      <Button
        variant="ghost"
        size={compact ? "icon" : "auto"}
        className={cn(
          "min-h-10 gap-2",
          connect.selectedId && "text-primary",
          !compact && "max-w-full px-2 text-xs",
          className,
        )}
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        <MonitorSpeakerIcon className="size-4 shrink-0" />
        {!compact && (
          <span className="truncate">{connect.selectedId ? label : t("connect.thisDevice")}</span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t("connect.title")}
          description={t("connect.description")}
          className="max-w-md"
        >
          <div
            className="flex flex-col gap-1"
            role="group"
            aria-label={t("connect.title")}
            aria-busy={choosing}
          >
            <button
              type="button"
              disabled={choosing}
              className="flex min-h-16 items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-raised disabled:opacity-50"
              aria-pressed={connect.selectedId === null}
              onClick={() => void select(null)}
            >
              <SmartphoneIcon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("connect.thisDevice")}</span>
                <span className="block text-xs text-muted-foreground">
                  {connect.selectedId ? t("connect.transferHere") : t("connect.selected")}
                </span>
              </span>
              {connect.selectedId === null && <CheckIcon className="size-4 text-primary" />}
            </button>
            {connect.devices
              .filter((device) => device.id !== deviceId())
              .map((device) => (
                <button
                  key={device.id}
                  type="button"
                  disabled={choosing || !connect.connected}
                  className="flex min-h-16 items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-raised disabled:opacity-50"
                  aria-pressed={connect.selectedId === device.id}
                  onClick={() => void select(device.id)}
                >
                  <MonitorSpeakerIcon className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {device.name || t("player.anotherDevice")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {connect.selectedId === device.id
                        ? t("connect.selected")
                        : t("connect.listenHere")}
                    </span>
                  </span>
                  {connect.selectedId === device.id && (
                    <CheckIcon className="size-4 text-primary" />
                  )}
                </button>
              ))}
            {choosing && (
              <p
                role="status"
                className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"
              >
                <LoaderCircleIcon className="size-4 animate-spin" />
                {t("connect.transferring")}
              </p>
            )}
            {!connect.connected && (
              <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
                {t("connect.reconnecting")}
              </p>
            )}
            <p className="mt-3 px-3 text-xs leading-relaxed text-muted-foreground">
              {t("connect.findDevices")}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
