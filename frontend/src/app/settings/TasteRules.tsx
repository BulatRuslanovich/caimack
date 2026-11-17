// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { SlidersHorizontalIcon, XIcon } from "lucide-react";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import { useInvalidate } from "@/lib/useInvalidate";
import type { TasteRule } from "@/lib/types";
import { useI18n } from "@/contexts/I18nContext";
import { LoadError, Query } from "@/components/Query";
import { Button } from "@/components/ui/button";

export function TasteRules() {
  const { t, locale } = useI18n();
  const invalidate = useInvalidate();
  const rules = useQuery(queries.tasteRules());
  const remove = useMutation({
    mutationFn: (rule: TasteRule) => api.removeTasteRule(rule.id),
    onSuccess: () => invalidate("recommendations"),
  });

  const verdict = (rule: TasteRule) =>
    rule.action === "cooldown" && rule.until
      ? t("rules.action.cooldown", {
          date: new Date(rule.until).toLocaleDateString(locale, { day: "numeric", month: "long" }),
        })
      : t(`rules.action.${rule.action === "downrank" ? "downrank" : "block"}`);

  return (
    <section className="rec-rules" aria-labelledby="rec-rules-title">
      <div className="rec-rules-heading">
        <SlidersHorizontalIcon size={18} aria-hidden="true" />
        <h2 id="rec-rules-title">{t("rules.title")}</h2>
        {rules.data && (
          <span className="rec-rules-count">{rules.data.length.toLocaleString(locale)}</span>
        )}
      </div>
      <p className="rec-rules-note">{t("rules.note")}</p>
      {remove.isError && (
        <LoadError
          message={t("rules.removeFailed")}
          onRetry={() => remove.mutate(remove.variables)}
        />
      )}
      <Query result={rules}>
        {(data) =>
          data.length === 0 ? (
            <div className="rec-rules-empty">
              <strong>{t("rules.emptyTitle")}</strong>
              <p>{t("rules.emptyHint")}</p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      {rule.name}
                      {rule.artistName && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          — {rule.artistName}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(`rules.target.${rule.targetType}`)} · {verdict(rule)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(rule)}
                    aria-label={t("rules.removeNamed", { name: rule.name })}
                    title={t("rules.remove")}
                  >
                    <XIcon size={16} />
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      </Query>
    </section>
  );
}
