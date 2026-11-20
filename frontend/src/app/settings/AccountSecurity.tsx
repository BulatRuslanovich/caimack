// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  CircleXIcon,
  HistoryIcon,
  LogOutIcon,
  MonitorSmartphoneIcon,
} from "lucide-react";
import { useState } from "react";
import { Query } from "@/components/Query";
import { Button } from "@/components/ui/button";
import { useT } from "@/contexts/I18nContext";
import { api } from "@/lib/api";
import { describeDevice } from "@/lib/playback/deviceName";
import { queries } from "@/lib/queries";
import { useFormat } from "@/lib/useFormat";
import { useToast } from "@/lib/useToast";
import type { AccountSession } from "@/lib/types";

const PREVIEW_SESSIONS = 3;
const RECENT_SIGN_INS = 5;
const SIGN_IN_REASONS = ["wrong_password", "throttled", "deactivated", "not_linked"] as const;

function deviceOf(entry: Pick<AccountSession, "deviceName" | "userAgent">) {
  return entry.deviceName?.trim() || (entry.userAgent ? describeDevice(entry.userAgent) : null);
}

export function AccountSecurity() {
  return (
    <>
      <Sessions />
      <SignIns />
    </>
  );
}

function Sessions() {
  const t = useT();
  const { notify } = useToast();
  const client = useQueryClient();
  const sessions = useQuery(queries.sessions());
  const [expanded, setExpanded] = useState(false);
  const end = useMutation({
    mutationFn: async (id: string | null) => {
      if (id === null) await api.endOtherSessions();
      else await api.endSession(id);
    },
    onSuccess: (_, id) => {
      notify(t(id === null ? "account.endedOthers" : "account.endedSession"), "success");
    },
    onSettled: () => client.invalidateQueries({ queryKey: queries.sessions().queryKey }),
  });

  return (
    <section className="account-panel account-sessions" aria-labelledby="account-sessions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="account-sessions" className="account-panel-title">
          <MonitorSmartphoneIcon size={18} aria-hidden="true" />
          {t("account.sessions")}
        </h2>
        {sessions.data && sessions.data.length > PREVIEW_SESSIONS && (
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:h-11"
            aria-expanded={expanded}
            aria-controls="account-session-list"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t("account.sessionsLess")
              : t("account.sessionsAll", { count: sessions.data.length })}
          </Button>
        )}
      </div>
      <div className="mt-3">
        <Query result={sessions} skeleton={<AccountLoading />}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("account.sessionsEmpty")}</p>
            ) : (
              <>
                <ul id="account-session-list" className="divide-y divide-(--library-edge)">
                  {(expanded ? list : list.slice(0, PREVIEW_SESSIONS)).map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      ending={end.isPending}
                      onEnd={end.mutate}
                    />
                  ))}
                </ul>
                {list.some((session) => !session.current) && (
                  <div className="border-t border-(--library-edge) pt-4">
                    <Button
                      variant="outline"
                      className="h-auto min-h-10 max-w-full py-2 whitespace-normal pointer-coarse:min-h-11"
                      disabled={end.isPending}
                      onClick={() => end.mutate(null)}
                    >
                      {t("account.endOthers")}
                    </Button>
                  </div>
                )}
              </>
            )
          }
        </Query>
      </div>
    </section>
  );
}

function SessionRow({
  session,
  ending,
  onEnd,
}: {
  session: AccountSession;
  ending: boolean;
  onEnd: (id: string) => void;
}) {
  const t = useT();
  const format = useFormat();
  const device = deviceOf(session) ?? t("account.unknownDevice");
  const lastUsed = format.playedAt(session.lastUsedAt);

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium wrap-anywhere">{device}</span>
        {session.current && (
          <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
            {t("account.sessionThis")}
          </span>
        )}
      </div>
      {!session.current && (
        <Button
          variant="ghost"
          size="sm"
          className="px-2.5 pointer-coarse:h-11"
          disabled={ending}
          onClick={() => onEnd(session.id)}
          aria-label={t("account.endSessionOn", { device })}
        >
          <LogOutIcon size={15} aria-hidden="true" />
          {t("account.endSession")}
        </Button>
      )}
      <div className="col-span-full flex flex-wrap gap-x-3 gap-y-0.5 text-xs wrap-anywhere text-muted-foreground">
        {lastUsed && (
          <time dateTime={session.lastUsedAt}>
            {t("account.sessionLastUsed", { date: lastUsed })}
          </time>
        )}
        {session.ip && <span className="tabular-nums">{session.ip}</span>}
        {session.longLived && <span>{t("account.sessionDevice")}</span>}
      </div>
    </li>
  );
}

function SignIns() {
  const t = useT();
  const format = useFormat();
  const signIns = useQuery(queries.signIns());
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="account-panel account-sign-ins" aria-labelledby="account-sign-ins">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="account-sign-ins" className="account-panel-title">
          <HistoryIcon size={18} aria-hidden="true" />
          {t("account.signIns")}
        </h2>
        {signIns.data && signIns.data.length > RECENT_SIGN_INS && (
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:h-11"
            aria-expanded={expanded}
            aria-controls="account-sign-in-list"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t("account.signInsLess") : t("account.signInsAll")}
          </Button>
        )}
      </div>
      <div className="mt-3">
        <Query result={signIns} skeleton={<AccountLoading />}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("account.signInsEmpty")}</p>
            ) : (
              <ul id="account-sign-in-list" className="divide-y divide-(--library-edge)">
                {(expanded ? list : list.slice(0, RECENT_SIGN_INS)).map((entry, index) => {
                  const Icon = entry.success ? CircleCheckIcon : CircleXIcon;
                  const device = deviceOf(entry);
                  const reason = SIGN_IN_REASONS.find((value) => value === entry.reason);

                  return (
                    <li key={`${entry.occurredAt}-${index}`} className="account-sign-in-row">
                      <Icon
                        size={18}
                        className={
                          entry.success ? "mt-0.5 text-success" : "mt-0.5 text-destructive"
                        }
                        aria-hidden="true"
                      />
                      <div className="min-w-0 wrap-anywhere">
                        <p className="text-sm font-medium">
                          {t(entry.success ? "account.signIn.success" : "account.signIn.failed")}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span>{t(`account.signIn.${entry.method}`)}</span>
                          {!entry.success && reason && (
                            <span className="text-destructive">
                              {t(`account.signIn.reason.${reason}`)}
                            </span>
                          )}
                          {device && <span>{device}</span>}
                          {entry.ip && <span className="tabular-nums">{entry.ip}</span>}
                        </div>
                      </div>
                      <time
                        dateTime={entry.occurredAt}
                        className="account-sign-in-time text-xs text-muted-foreground tabular-nums"
                      >
                        {format.playedAt(entry.occurredAt)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            )
          }
        </Query>
      </div>
    </section>
  );
}

function AccountLoading() {
  const t = useT();

  return (
    <p role="status" className="text-sm text-muted-foreground">
      {t("common.loading")}
    </p>
  );
}
