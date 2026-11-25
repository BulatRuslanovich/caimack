// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useState } from "react";
import { CheckIcon, LoaderCircleIcon, MonitorSpeakerIcon, SmartphoneIcon } from "lucide-react";
import { useConnect } from "@/lib/playback/useConnectPlayback";
import { deviceId } from "@/lib/events";
import { cn } from "@/lib/cn";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";

export function PlaybackDeviceStatus() {
  const connect = useConnect();
  const t = useT();
  if (!connect.selectedId) return null;
  const label = t(connect.available ? "connect.playingOn" : "connect.unavailable", {
    device: connect.selectedName,
  });
  return (
    <span role="status" title={label} className="truncate text-xs text-primary">
      {label}
    </span>
  );
}

export function PlaybackDevices({
  compact = false,
  onlyRemote = false,
  transferBook,
  className,
  variant = "ghost",
}: {
  compact?: boolean;
  onlyRemote?: boolean;
  transferBook?: (id: string | null) => Promise<void>;
  className?: string;
  variant?: "ghost" | "secondary";
}) {
  const connect = useConnect();
  const t = useT();
  const selectedId = transferBook
    ? connect.activeBook?.deviceId === deviceId()
      ? null
      : (connect.devices.find((d) => d.id === connect.activeBook?.deviceId)?.id ?? null)
    : connect.selectedId;
  const selectedName = transferBook
    ? (connect.devices.find(({ id }) => id === selectedId)?.name ?? t("player.anotherDevice"))
    : connect.selectedName;
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const select = async (id: string | null) => {
    setChoosing(true);
    try {
      if (transferBook) {
        await transferBook(id);
      } else await connect.select(id);
      setOpen(false);
    } catch {
      /* The player reports command failures. Keep the device list open. */
    } finally {
      setChoosing(false);
    }
  };
  const label = selectedId
    ? t(connect.available ? "connect.playingOn" : "connect.unavailable", {
        device: selectedName,
      })
    : t("connect.title");
  if (onlyRemote && !selectedId) return null;
  return (
    <>
      <Button
        variant={variant}
        size={compact ? "icon" : "auto"}
        className={cn(
          "min-h-10 gap-2",
          selectedId && "text-primary",
          !compact && "max-w-full px-2 text-xs",
          className,
        )}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen(true)}
      >
        <MonitorSpeakerIcon className="size-4 shrink-0" />
        {!compact && (
          <span className="truncate">{selectedId ? label : t("connect.thisDevice")}</span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t("connect.title")}
          description={t(transferBook ? "connect.audiobookDescription" : "connect.description")}
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
              aria-pressed={selectedId === null}
              onClick={() => void select(null)}
            >
              <SmartphoneIcon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("connect.thisDevice")}</span>
                <span className="block text-xs text-muted-foreground">
                  {selectedId ? t("connect.transferHere") : t("connect.selected")}
                </span>
              </span>
              {selectedId === null && <CheckIcon className="size-4 text-primary" />}
            </button>
            {connect.devices
              .filter((device) => device.id !== deviceId() && (!transferBook || device.audiobooks))
              .map((device) => (
                <button
                  key={device.id}
                  type="button"
                  disabled={choosing || !connect.connected}
                  className="flex min-h-16 items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-raised disabled:opacity-50"
                  aria-pressed={selectedId === device.id}
                  onClick={() => void select(device.id)}
                >
                  <MonitorSpeakerIcon className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {device.name || t("player.anotherDevice")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {selectedId === device.id ? t("connect.selected") : t("connect.listenHere")}
                    </span>
                  </span>
                  {selectedId === device.id && <CheckIcon className="size-4 text-primary" />}
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
