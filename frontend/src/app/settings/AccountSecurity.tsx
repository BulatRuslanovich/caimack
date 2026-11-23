// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, CircleXIcon, LogOutIcon } from "lucide-react";
import { useState } from "react";
import { Query } from "@/components/Query";
import { Button } from "@/components/ui/button";
import { useT } from "@/contexts/I18nContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
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
    <section className="account-panel" aria-labelledby="account-sessions">
      <div className="account-section-header">
        <h2 id="account-sessions" className="account-panel-title">
          {t("account.sessions")}
        </h2>
        {sessions.data && sessions.data.length > PREVIEW_SESSIONS && (
          <Button
            variant="text"
            size="sm"
            className="px-0 pointer-coarse:h-11"
            aria-expanded={expanded}
            aria-controls="account-session-list"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t("account.showLess")
              : t("account.sessionsAll", { count: sessions.data.length })}
          </Button>
        )}
      </div>
      <div className="mt-2">
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
                  <div className="border-t border-(--library-edge) pt-3">
                    <Button
                      variant="text"
                      size="sm"
                      className="h-auto min-h-8 max-w-full px-0 py-2 whitespace-normal pointer-coarse:min-h-11"
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
    <li className="account-session-row">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium wrap-anywhere">{device}</span>
        {session.current && (
          <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
            {t("account.sessionThis")}
          </span>
        )}
      </div>
      <div className="account-session-meta flex flex-wrap gap-x-3 gap-y-1 text-xs wrap-anywhere text-muted-foreground">
        {lastUsed && (
          <time
            dateTime={session.lastUsedAt}
            aria-label={t("account.sessionLastUsed", { date: lastUsed })}
            className="font-medium"
          >
            {lastUsed}
          </time>
        )}
        {session.ip && <span className="tabular-nums">{session.ip}</span>}
        {session.longLived && <span>{t("account.sessionDevice")}</span>}
      </div>
      {!session.current && (
        <Button
          variant="ghost"
          size="sm"
          className="account-session-action gap-1.5 px-2 pointer-coarse:h-11"
          disabled={ending}
          onClick={() => onEnd(session.id)}
          aria-label={t("account.endSessionOn", { device })}
        >
          <LogOutIcon size={15} aria-hidden="true" />
          {t("account.endSession")}
        </Button>
      )}
    </li>
  );
}

function SignIns() {
  const t = useT();
  const format = useFormat();
  const signIns = useQuery(queries.signIns());
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="account-panel" aria-labelledby="account-sign-ins">
      <div className="account-section-header">
        <h2 id="account-sign-ins" className="account-panel-title">
          {t("account.signIns")}
        </h2>
        {signIns.data && signIns.data.length > RECENT_SIGN_INS && (
          <Button
            variant="text"
            size="sm"
            className="px-0 pointer-coarse:h-11"
            aria-expanded={expanded}
            aria-controls="account-sign-in-list"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t("account.showLess")
              : t("account.signInsAll", { count: signIns.data.length })}
          </Button>
        )}
      </div>
      <div className="mt-2">
        <Query result={signIns} skeleton={<AccountLoading />}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("account.signInsEmpty")}</p>
            ) : (
              <table
                id="account-sign-in-list"
                className="account-sign-in-table"
                role="table"
                aria-labelledby="account-sign-ins"
              >
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader" scope="col" className="w-1/4">
                      {t("account.signIn.when")}
                    </th>
                    <th role="columnheader" scope="col" className="w-5/12">
                      {t("account.signIn.device")}
                    </th>
                    <th role="columnheader" scope="col">
                      {t("account.signIn.result")}
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {(expanded ? list : list.slice(0, RECENT_SIGN_INS)).map((entry, index) => {
                    const Icon = entry.success ? CircleCheckIcon : CircleXIcon;
                    const reason = SIGN_IN_REASONS.find((value) => value === entry.reason);

                    return (
                      <tr key={`${entry.occurredAt}-${index}`} role="row">
                        <td className="account-sign-in-time text-muted-foreground" role="cell">
                          <time dateTime={entry.occurredAt} className="tabular-nums">
                            {format.playedAt(entry.occurredAt)}
                          </time>
                        </td>
                        <td className="account-sign-in-device" role="cell">
                          <p className="font-medium">
                            {deviceOf(entry) ?? t("account.unknownDevice")}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{t(`account.signIn.${entry.method}`)}</span>
                            {entry.ip && <span className="tabular-nums">{entry.ip}</span>}
                          </div>
                        </td>
                        <td className="account-sign-in-result" role="cell">
                          <p
                            className={cn(
                              "flex items-center gap-2 font-medium",
                              !entry.success && "font-semibold text-destructive",
                            )}
                          >
                            <Icon
                              size={16}
                              className={cn("shrink-0", entry.success && "text-success")}
                              aria-hidden="true"
                            />
                            {t(entry.success ? "account.signIn.success" : "account.signIn.failed")}
                          </p>
                          {!entry.success && reason && (
                            <p className="mt-1 ps-6 text-xs text-muted-foreground">
                              {t(`account.signIn.reason.${reason}`)}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
