// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";
import { StatusPage } from "@/components/StatusPage";
import { Button } from "@/components/ui/button";
import { useT } from "@/contexts/I18nContext";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusPage
      icon={<TriangleAlertIcon size={32} />}
      tone="danger"
      title={t("error.pageTitle")}
      description={t("error.pageDescription")}
      actions={
        <>
          <Button variant="primary" onClick={reset}>
            {t("action.tryAgain")}
          </Button>
          <Button asChild>
            <Link href="/">{t("action.goHome")}</Link>
          </Button>
        </>
      }
    />
  );
}
