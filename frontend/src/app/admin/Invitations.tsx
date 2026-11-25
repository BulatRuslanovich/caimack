// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CopyIcon,
  MailIcon,
  MailPlusIcon,
  ShieldIcon,
  XIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import { useFormat } from "@/lib/useFormat";
import { useToast } from "@/lib/useToast";
import { useI18n } from "@/contexts/I18nContext";
import { Query } from "@/components/Query";
import { Button } from "@/components/ui/button";

export function Invitations() {
  const { t, locale } = useI18n();
  const { notify, notifyError } = useToast();
  const format = useFormat();
  const invitations = useQuery(queries.invitations());
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);

  const create = useMutation({
    mutationFn: (isAdmin: boolean) => api.createInvitation({ isAdmin }),
    onSuccess: async (created) => {
      setLink({ id: created.id, url: `${window.location.origin}/invite/${created.token}` });
      await invitations.refetch();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: async (_, id) => {
      setLink((shown) => (shown?.id === id ? null : shown));
      await invitations.refetch();
    },
  });

  const expiry = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      notify(t("invitations.copied"), "success");
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <section
      id="admin-invitations"
      className="workspace-panel"
      aria-labelledby="admin-invitations-title"
    >
      <div className="p-4 sm:p-5">
        <h2 id="admin-invitations-title" className="flex items-center gap-3 text-heading">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <MailIcon size={18} aria-hidden="true" />
          </span>
          {t("invitations.title")}
        </h2>
        <div className="mt-4 flex flex-col items-start gap-1.5">
          <Button
            variant="secondary"
            className="h-auto min-h-10 max-w-full py-2 text-left whitespace-normal pointer-coarse:min-h-11"
            disabled={create.isPending}
            onClick={() => create.mutate(false)}
          >
            <MailPlusIcon size={16} aria-hidden="true" /> {t("invitations.create")}
          </Button>
          <Button
            variant="ghost"
            className="h-auto min-h-10 max-w-full px-3.5 py-2 text-left whitespace-normal pointer-coarse:min-h-11"
            disabled={create.isPending}
            onClick={() => create.mutate(true)}
          >
            <ShieldIcon size={16} aria-hidden="true" />
            {t("invitations.createAdmin")}
          </Button>
        </div>
      </div>

      {link && (
        <div className="mx-4 mb-4 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary-soft p-3 sm:mx-5 sm:mb-5">
          <div className="flex items-start justify-between gap-2">
            <p role="status" className="text-xs text-muted-foreground">
              {t("invitations.created")}
            </p>
            <Button
              variant="ghost"
              size="icon-sm"
              className="-mt-1 -mr-1 shrink-0 pointer-coarse:size-10"
              onClick={() => setLink(null)}
              aria-label={t("invitations.dismissLink")}
            >
              <XIcon size={16} aria-hidden="true" />
            </Button>
          </div>
          <input
            value={link.url}
            readOnly
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t("invitations.link")}
            className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-2 font-mono text-sm"
          />
          <div>
            <Button variant="secondary" size="sm" onClick={() => void copy()}>
              <CopyIcon size={14} aria-hidden="true" /> {t("invitations.copy")}
            </Button>
          </div>
        </div>
      )}

      <div className="border-t border-border px-4 py-4 sm:px-5">
        <Query
          result={invitations}
          skeleton={
            <p role="status" className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          }
        >
          {(list) => {
            const pending = list.filter((invitation) => !invitation.usedAt);
            const accepted = list.filter((invitation) => invitation.usedAt);

            return (
              <>
                {pending.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("invitations.empty")}</p>
                ) : (
                  <>
                    <h3 className="mb-1.5 text-sm font-semibold">{t("invitations.active")}</h3>
                    <ul className="divide-y divide-border">
                      {pending.map((invitation) => (
                        <li key={invitation.id} className="flex items-center gap-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium wrap-anywhere">
                              {t(invitation.isAdmin ? "admin.roleAdmin" : "admin.roleUser")}
                            </p>
                            <time
                              dateTime={invitation.expiresAt}
                              className="text-xs text-muted-foreground"
                            >
                              {t("invitations.pending", {
                                date: expiry.format(new Date(invitation.expiresAt)),
                              })}
                            </time>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 hover:text-destructive"
                            disabled={revoke.isPending}
                            onClick={() => revoke.mutate(invitation.id)}
                            aria-label={t("invitations.revoke")}
                            title={t("invitations.revoke")}
                          >
                            <XIcon size={16} aria-hidden="true" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {accepted.length > 0 && (
                  <details className="group mt-3 border-t border-border pt-2">
                    <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-sm font-medium pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                      {t("invitations.acceptedCount", { count: accepted.length })}
                      <ChevronDownIcon
                        size={16}
                        aria-hidden="true"
                        className="shrink-0 text-muted-foreground group-open:rotate-180"
                      />
                    </summary>
                    <ul className="mt-1 divide-y divide-border">
                      {accepted.map((invitation) => (
                        <li key={invitation.id} className="flex items-start gap-2.5 py-2.5">
                          <CircleCheckIcon
                            size={15}
                            aria-hidden="true"
                            className="mt-0.5 shrink-0 text-success"
                          />
                          <div className="min-w-0 wrap-anywhere">
                            <p className="text-sm font-medium">
                              {invitation.usedBy || t("invitations.accepted")}
                            </p>
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              {invitation.isAdmin && <span>{t("admin.roleAdmin")}</span>}
                              {invitation.usedAt && (
                                <time dateTime={invitation.usedAt}>
                                  {format.relativeDate(invitation.usedAt)}
                                </time>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            );
          }}
        </Query>
      </div>
    </section>
  );
}
