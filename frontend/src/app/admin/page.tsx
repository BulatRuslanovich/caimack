// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import dynamic from "next/dynamic";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queries } from "@/lib/queries";
import { scrollContentToTop } from "@/lib/scroll";
import { useFormat } from "@/lib/useFormat";
import { usePage } from "@/lib/usePage";
import { PageHeader } from "@/components/PageHeader";
import { Invitations } from "./Invitations";
import { Pagination } from "@/components/PageToolbar";
import { Query } from "@/components/Query";
import { useConfirm } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cell, HeaderCell, Row, Table } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EllipsisVerticalIcon,
  KeyRoundIcon,
  LogOutIcon,
  MailIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UserRoundXIcon,
  UsersIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n, useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import type { AdminUser } from "@/lib/types";
import styles from "./admin.module.css";

const CreateUserDialog = dynamic(() =>
  import("@/components/CreateUserDialog").then((m) => m.CreateUserDialog),
);
const ResetPasswordDialog = dynamic(() =>
  import("@/components/ResetPasswordDialog").then((m) => m.ResetPasswordDialog),
);

const PAGE_SIZE = 50;

export default function AdminUsersPage() {
  const { t, locale } = useI18n();
  const format = useFormat();
  const { user: signedIn } = useAuth();
  const { notify } = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [page, setPage] = usePage([]);
  const [section, setSection] = useState("users");

  const users = useQuery(queries.adminUsers({ page, pageSize: PAGE_SIZE }));
  const shortDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });

  const refresh = () => void users.refetch();

  const act = useMutation({
    mutationFn: ({ action }: { userId: string; action: () => Promise<unknown> }) => action(),
    onSuccess: () => {
      notify(t("admin.actionDone"), "success");
      refresh();
    },
  });

  const ask = (user: AdminUser, question: string, action: () => Promise<unknown>) =>
    confirm({
      title: question,
      destructive: true,
      action: () => act.mutate({ userId: user.id, action }),
    });

  return (
    <div className={styles.workspace}>
      <PageHeader
        title={t("admin.users")}
        subtitle={users.data ? t("count.accounts", { count: users.data.total }) : undefined}
        actions={
          <Button
            variant="primary"
            className={styles.addUser}
            aria-label={t("admin.addUser")}
            title={t("admin.addUser")}
            onClick={() => setCreating(true)}
          >
            <PlusIcon size={18} aria-hidden="true" />
            <span className={styles.addUserLabel}>{t("admin.addUser")}</span>
          </Button>
        }
      />

      <div className={styles.sectionBar}>
        <RadioGroup.Root
          aria-label={t("admin.sections")}
          className={styles.sectionPicker}
          value={section}
          onValueChange={(value) => {
            setSection(value);
            scrollContentToTop();
          }}
          orientation="horizontal"
          loop
        >
          <RadioGroup.Item value="users" aria-controls="admin-directory">
            <UsersIcon size={16} aria-hidden="true" />
            {t("admin.users")}
          </RadioGroup.Item>
          <RadioGroup.Item value="invitations" aria-controls="admin-invitations">
            <MailIcon size={16} aria-hidden="true" />
            {t("invitations.title")}
          </RadioGroup.Item>
        </RadioGroup.Root>
      </div>

      <div className={styles.columns} data-section={section}>
        <section id="admin-directory" className={styles.directory} aria-label={t("admin.users")}>
          <Query
            result={users}
            empty={{ icon: <ShieldCheckIcon size={24} />, title: t("admin.empty") }}
          >
            {(data) => (
              <>
                <Table aria-label={t("admin.users")} className="rounded-none">
                  <Row head className={cn(styles.tableRow, styles.tableHead)}>
                    <HeaderCell>{t("field.username")}</HeaderCell>
                    <HeaderCell>{t("field.role")}</HeaderCell>
                    <HeaderCell>{t("admin.status")}</HeaderCell>
                    <HeaderCell>{t("field.created")}</HeaderCell>
                    <HeaderCell aria-label={t("admin.actions")} />
                  </Row>
                  {data.items.map((user) => {
                    const created = format.relativeDate(user.createdAt);
                    return (
                      <UserRow
                        key={user.id}
                        user={user}
                        isSelf={user.id === signedIn?.id}
                        pending={act.isPending && act.variables?.userId === user.id}
                        created={created}
                        shortCreated={created && shortDate.format(new Date(user.createdAt))}
                        onReset={setResetting}
                        onConfirm={ask}
                      />
                    );
                  })}
                </Table>
                {data.totalPages > 1 && (
                  <div className="border-t border-(--library-edge) px-3 pt-1 pb-3">
                    <Pagination result={data} onChange={setPage} />
                  </div>
                )}
              </>
            )}
          </Query>
        </section>
        <div className={styles.invitations}>
          <Invitations />
        </div>
      </div>

      {creating && <CreateUserDialog onClose={() => setCreating(false)} onCreated={refresh} />}

      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}

      {confirmDialog}
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  pending,
  created,
  shortCreated,
  onReset,
  onConfirm,
}: {
  user: AdminUser;
  isSelf: boolean;
  pending: boolean;
  created: string;
  shortCreated: string;
  onReset: (user: AdminUser) => void;
  onConfirm: (user: AdminUser, question: string, action: () => Promise<unknown>) => void;
}) {
  const t = useT();
  const username = { username: user.username };

  return (
    <Row className={cn(styles.tableRow, styles.tableEntry, "py-2.5")}>
      <Cell className={cn(styles.identity, "flex items-center gap-2.5")}>
        <span
          aria-hidden="true"
          className={cn(
            styles.avatar,
            "grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold uppercase",
            user.isAdmin ? "bg-primary-soft text-primary" : "bg-raised text-muted-foreground",
          )}
        >
          {Array.from(user.username)[0]}
        </span>
        <span className={cn(styles.identityName, "min-w-0")}>
          <span className="block min-w-0 font-semibold wrap-anywhere">{user.username}</span>
          {isSelf && (
            <span className="block shrink-0 text-xs text-muted-foreground">{t("admin.you")}</span>
          )}
        </span>
      </Cell>

      <Cell className={cn(styles.role, "text-xs text-muted-foreground")}>
        {user.isAdmin ? t("admin.roleAdmin") : t("admin.roleUser")}
      </Cell>

      <Cell className={styles.status}>
        <Badge className={cn(styles.statusBadge, user.isActive && "bg-success/10 text-success")}>
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {t(user.isActive ? "admin.active" : "admin.inactive")}
        </Badge>
      </Cell>

      <Cell className={cn(styles.created, "text-xs text-muted-foreground tabular-nums")}>
        <time dateTime={user.createdAt} title={created}>
          <span className={styles.createdFull}>{created}</span>
          <span className={styles.createdShort}>{shortCreated}</span>
        </time>
      </Cell>

      <Cell className={cn(styles.actions, "flex justify-end")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={pending}
              aria-label={t("admin.actionsFor", username)}
            >
              <EllipsisVerticalIcon size={17} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onReset(user)}>
              <KeyRoundIcon />
              {t("admin.resetPassword")}
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={() =>
                onConfirm(user, t("admin.confirmRevoke", username), () =>
                  api.revokeUserSessions(user.id),
                )
              }
            >
              <LogOutIcon />
              {t("admin.revokeSessions")}
            </DropdownMenuItem>

            <DropdownMenuItem
              disabled={isSelf}
              onSelect={() =>
                onConfirm(
                  user,
                  t(user.isAdmin ? "admin.confirmRemoveAdmin" : "admin.confirmMakeAdmin", username),
                  () => api.setUserRole(user.id, !user.isAdmin),
                )
              }
            >
              <ShieldIcon />
              {t(user.isAdmin ? "admin.removeAdmin" : "admin.makeAdmin")}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              variant={user.isActive ? "destructive" : "default"}
              disabled={isSelf}
              onSelect={() =>
                onConfirm(
                  user,
                  t(
                    user.isActive ? "admin.confirmDeactivate" : "admin.confirmReactivate",
                    username,
                  ),
                  () => api.setUserActive(user.id, !user.isActive),
                )
              }
            >
              <UserRoundXIcon />
              {t(user.isActive ? "admin.deactivate" : "admin.reactivate")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Cell>
    </Row>
  );
}
