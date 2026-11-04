// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CopyIcon, MailPlusIcon, XIcon } from "lucide-react";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import { useToast } from "@/lib/useToast";
import { useI18n } from "@/contexts/I18nContext";
import { Section } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";

export function Invitations() {
  const { t, locale } = useI18n();
  const { notify, notifyError } = useToast();
  const invitations = useQuery(queries.invitations());
  const [link, setLink] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (isAdmin: boolean) => api.createInvitation({ isAdmin }),
    onSuccess: (created) => {
      setLink(`${window.location.origin}/invite/${created.token}`);
      void invitations.refetch();
    },
    onError: (error) => notifyError(error),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: () => void invitations.refetch(),
    onError: (error) => notifyError(error),
  });

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long" });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      notify(t("invitations.copied"), "success");
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Section
      title={t("invitations.title")}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={create.isPending}
            onClick={() => create.mutate(false)}
          >
            <MailPlusIcon size={14} /> {t("invitations.create")}
          </Button>
          <Button
            variant="text"
            size="sm"
            disabled={create.isPending}
            onClick={() => create.mutate(true)}
          >
            {t("invitations.createAdmin")}
          </Button>
        </>
      }
    >
      {link && (
        <div className="flex flex-col gap-2 rounded-lg bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("invitations.created")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-raised px-2 py-1.5 text-sm">
              {link}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              <CopyIcon size={14} /> {t("invitations.copy")}
            </Button>
          </div>
        </div>
      )}

      {invitations.data && invitations.data.length === 0 && !link && (
        <p className="text-sm text-muted-foreground">{t("invitations.empty")}</p>
      )}

      {invitations.data && invitations.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {invitations.data.map((invitation) => (
            <li key={invitation.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {invitation.usedBy
                  ? t("invitations.used", { name: invitation.usedBy })
                  : t("invitations.pending", { date: date(invitation.expiresAt) })}
                {invitation.isAdmin && (
                  <span className="text-muted-foreground"> · {t("invitations.admin")}</span>
                )}
              </span>
              {!invitation.usedAt && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(invitation.id)}
                  aria-label={t("invitations.revoke")}
                  title={t("invitations.revoke")}
                >
                  <XIcon size={16} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
