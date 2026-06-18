import { memo } from "react";
import { useI18n } from "../../i18n";
import { type PendingApproval } from "../../session-logic";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { type ApprovalRequestId, type ProviderApprovalDecision } from "@t3tools/contracts";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  isResponding: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
    responseText?: string,
  ) => Promise<void>;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  isResponding,
  onRespondToApproval,
}: ComposerPendingApprovalPanelProps) {
  const { t } = useI18n();
  const approvalSummary =
    approval.requestKind === "command"
      ? t("approval.summary.command")
      : approval.requestKind === "file-read"
        ? t("approval.summary.fileRead")
        : t("approval.summary.fileChange");
  const approvalDescription =
    approval.requestKind === "command"
      ? t("approval.description.command")
      : approval.requestKind === "file-read"
        ? t("approval.description.fileRead")
        : t("approval.description.fileChange");
  const commandPreview = approval.detail?.trim() || t("approval.detailFallback");

  return (
    <div className="px-1.5 py-1.5 sm:px-2.5">
      <div className="rounded-[14px] border border-border/55 bg-background/98 p-1.5 shadow-[0_6px_18px_rgba(15,23,42,0.08)] dark:bg-background/96 dark:shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
        <div className="space-y-1.5 px-1.5 pb-1 pt-0.5">
          <div className="flex min-w-0 items-start justify-between gap-2.5">
            <div className="min-w-0 space-y-0.5">
              <p className="text-[12px] font-semibold leading-4.5 text-foreground/94">
                {approvalDescription}
              </p>
              <p className="truncate text-[11px] font-medium leading-4 text-muted-foreground/68">
                {approvalSummary}
              </p>
            </div>
            {pendingCount > 1 ? (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                1/{pendingCount}
              </span>
            ) : null}
          </div>

          <pre
            className="truncate overflow-hidden whitespace-nowrap rounded-lg bg-muted/38 px-2.5 py-1 font-mono text-[10.5px] leading-4 text-muted-foreground/82"
            title={commandPreview}
          >
            {commandPreview}
          </pre>
        </div>

        <ComposerPendingApprovalActions
          requestId={approval.requestId}
          isResponding={isResponding}
          pendingKind={approval.requestKind}
          onRespondToApproval={onRespondToApproval}
        />
      </div>
    </div>
  );
});
