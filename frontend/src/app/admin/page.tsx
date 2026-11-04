// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import dynamic from "next/dynamic";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queries } from "@/lib/queries";
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
  PlusIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UserRoundXIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import type { AdminUser } from "@/lib/types";

const CreateUserDialog = dynamic(() =>
  import("@/components/CreateUserDialog").then((m) => m.CreateUserDialog),
);
const ResetPasswordDialog = dynamic(() =>
  import("@/components/ResetPasswordDialog").then((m) => m.ResetPasswordDialog),
);

const PAGE_SIZE = 50;

const columns = "grid-cols-[minmax(0,1.6fr)_0.9fr_0.9fr_0.9fr_2.25rem]";

export default function AdminUsersPage() {
  const t = useT();
  const format = useFormat();
  const { user: signedIn } = useAuth();
  const { notify } = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [page, setPage] = usePage([]);

  const users = useQuery(queries.adminUsers({ page, pageSize: PAGE_SIZE }));

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
    <>
      <PageHeader
        title={t("admin.users")}
        subtitle={users.data ? t("count.accounts", { count: users.data.total }) : undefined}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon size={16} /> {t("admin.addUser")}
          </Button>
        }
      />

      <Invitations />

      <Query
        result={users}
        empty={{ icon: <ShieldCheckIcon size={24} />, title: t("admin.empty") }}
      >
        {(data) => (
          <>
            <Table aria-label={t("admin.users")}>
              <Row head className={columns}>
                <HeaderCell>{t("field.username")}</HeaderCell>
                <HeaderCell>{t("field.role")}</HeaderCell>
                <HeaderCell>{t("admin.status")}</HeaderCell>
                <HeaderCell>{t("field.created")}</HeaderCell>
                <HeaderCell aria-label={t("admin.actions")} />
              </Row>

              {data.items.map((user) => {
                const isSelf = user.id === signedIn?.id;
                const pending = act.isPending && act.variables?.userId === user.id;

                return (
                  <Row key={user.id} className={cn(columns, "max-md:relative")}>
                    <Cell className="truncate">{user.username}</Cell>

                    <Cell className="text-muted-foreground">
                      {user.isAdmin ? t("admin.roleAdmin") : t("admin.roleUser")}
                    </Cell>

                    <Cell>
                      {user.isActive ? (
                        <span className="text-muted-foreground">{t("admin.active")}</span>
                      ) : (
                        <Badge>{t("admin.inactive")}</Badge>
                      )}
                    </Cell>

                    <Cell className="text-muted-foreground">
                      {format.relativeDate(user.createdAt)}
                    </Cell>

                    <Cell className="flex justify-end max-md:absolute max-md:top-2 max-md:right-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            aria-label={t("admin.actionsFor", { username: user.username })}
                          >
                            <EllipsisVerticalIcon size={16} />
                          </Button>
                        </DropdownMenuTrigger>

                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setResetting(user)}>
                            <KeyRoundIcon />
                            {t("admin.resetPassword")}
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onSelect={() =>
                              ask(user, t("admin.confirmRevoke", { username: user.username }), () =>
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
                              ask(
                                user,
                                t(
                                  user.isAdmin
                                    ? "admin.confirmRemoveAdmin"
                                    : "admin.confirmMakeAdmin",
                                  { username: user.username },
                                ),
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
                              ask(
                                user,
                                t(
                                  user.isActive
                                    ? "admin.confirmDeactivate"
                                    : "admin.confirmReactivate",
                                  { username: user.username },
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
              })}
            </Table>

            <Pagination result={data} onChange={setPage} />
          </>
        )}
      </Query>

      {creating && <CreateUserDialog onClose={() => setCreating(false)} onCreated={refresh} />}

      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}

      {confirmDialog}
    </>
  );
}
