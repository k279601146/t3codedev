import { type SkillCatalogItem, type InstalledSkill } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { useI18n } from "~/i18n";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup } from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Skeleton } from "~/components/ui/skeleton";

const ChatMarkdown = lazy(() => import("../ChatMarkdown"));

export type SkillDialogTarget =
  | { kind: "installed"; data: InstalledSkill }
  | { kind: "catalog"; data: SkillCatalogItem };

interface Props {
  readonly open: boolean;
  readonly target: SkillDialogTarget | null;
  readonly installing: boolean;
  readonly uninstalling: boolean;
  readonly onClose: () => void;
  readonly onInstall: (catalogItemId: string) => void;
  readonly onUninstall: (skillName: string) => void;
}

function getIconUrl(target: SkillDialogTarget): string | null {
  if (target.kind === "catalog") {
    return target.data.iconLargeUrl ?? target.data.iconSmallUrl ?? null;
  }
  return target.data.iconLargeUrl ?? target.data.iconSmallUrl ?? null;
}

function getTitle(target: SkillDialogTarget): string {
  return target.kind === "catalog"
    ? target.data.displayName
    : (target.data.displayName ?? target.data.name);
}

function getSubtitle(target: SkillDialogTarget): string | undefined {
  return target.kind === "catalog"
    ? (target.data.shortDescription ?? target.data.description ?? undefined)
    : (target.data.shortDescription ?? target.data.description ?? undefined);
}

function FallbackBadge({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex size-12 items-center justify-center rounded-md bg-muted text-base font-semibold text-muted-foreground">
      {initial}
    </div>
  );
}

export function SkillDetailDialog({
  open,
  target,
  installing,
  uninstalling,
  onClose,
  onInstall,
  onUninstall,
}: Props) {
  const { t } = useI18n();
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const contentQuery = useQuery({
    enabled: open && target !== null,
    queryKey: [
      "skills",
      "content",
      target?.kind,
      target?.kind === "installed" ? target.data.name : (target?.data.id ?? ""),
    ],
    queryFn: () => {
      if (!target) return Promise.reject(new Error("No target"));
      return getPrimaryEnvironmentConnection().client.skills.content(
        target.kind === "installed"
          ? { skillName: target.data.name }
          : { catalogItemId: target.data.id },
      );
    },
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            // 操作进行中时禁止关闭，避免用户误判进度
            if (installing || uninstalling) return;
            onClose();
          }
        }}
      >
        {target ? (
          <DialogPopup className="max-w-xl">
            {/* 安装/卸载进度条 */}
            {installing || uninstalling ? (
              <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-2xl bg-muted">
                <div className="h-full w-1/3 animate-[skill-progress_1.2s_linear_infinite] bg-primary" />
                <style>{`@keyframes skill-progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
              </div>
            ) : null}

            <div className="flex flex-col gap-4 p-6 pb-3">
              <div className="flex items-start gap-3">
                {(() => {
                  const iconUrl = getIconUrl(target);
                  if (iconUrl) {
                    return (
                      <img
                        alt=""
                        src={iconUrl}
                        className="size-12 rounded-md object-contain"
                        draggable={false}
                      />
                    );
                  }
                  return <FallbackBadge name={getTitle(target)} />;
                })()}
              </div>
              <div>
                <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
                  {getTitle(target)}
                  <span className="ms-2 text-base font-normal text-muted-foreground">
                    {t("skills.skill")}
                  </span>
                </h2>
                {getSubtitle(target) ? (
                  <p className="mt-1 text-sm text-muted-foreground">{getSubtitle(target)}</p>
                ) : null}
              </div>
            </div>

            <div className="px-6">
              <div className="rounded-lg border border-border/60 bg-muted/24">
                <ScrollArea className="max-h-[420px]">
                  <div className="prose prose-sm dark:prose-invert max-w-none p-4 text-[13px] leading-relaxed text-foreground">
                    {contentQuery.isLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3" />
                      </div>
                    ) : contentQuery.error ? (
                      <p className="text-sm text-destructive">
                        {contentQuery.error instanceof Error
                          ? contentQuery.error.message
                          : String(contentQuery.error)}
                      </p>
                    ) : contentQuery.data ? (
                      <Suspense fallback={<Skeleton className="h-4 w-1/2" />}>
                        <ChatMarkdown text={contentQuery.data.markdown} cwd={undefined} />
                      </Suspense>
                    ) : null}
                  </div>
                </ScrollArea>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4">
              {target.kind === "catalog" ? (
                <Button
                  variant="default"
                  disabled={installing}
                  onClick={() => onInstall(target.data.id)}
                >
                  {installing ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <PlusIcon className="size-4" />
                  )}
                  {installing ? t("skills.installing") : t("skills.install")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={uninstalling || target.data.scope === "system"}
                  onClick={() => setConfirmUninstall(true)}
                >
                  {uninstalling ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <Trash2Icon className="size-4" />
                  )}
                  {uninstalling ? t("skills.uninstalling") : t("skills.uninstall")}
                </Button>
              )}
            </div>
          </DialogPopup>
        ) : null}
      </Dialog>

      {/* 卸载二次确认 */}
      <AlertDialog
        open={confirmUninstall}
        onOpenChange={(value) => {
          if (!value) setConfirmUninstall(false);
        }}
      >
        {target && target.kind === "installed" ? (
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("skills.confirmUninstall", {
                  name: target.data.displayName ?? target.data.name,
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("skills.confirmUninstallDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>
                {t("skills.cancel")}
              </AlertDialogClose>
              <Button
                variant="destructive"
                disabled={uninstalling}
                onClick={() => {
                  setConfirmUninstall(false);
                  onUninstall(target.data.name);
                }}
              >
                {uninstalling ? <Loader2Icon className="size-4 animate-spin" /> : null}
                {t("skills.uninstall")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        ) : null}
      </AlertDialog>
    </>
  );
}
