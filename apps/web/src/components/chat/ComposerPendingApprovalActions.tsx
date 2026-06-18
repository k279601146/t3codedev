import { type ApprovalRequestId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { CornerDownLeftIcon } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  pendingKind: "command" | "file-read" | "file-change";
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
    responseText?: string,
  ) => Promise<void>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  pendingKind,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const { t } = useI18n();
  const [selectedDecision, setSelectedDecision] = useState<ProviderApprovalDecision>("accept");
  const [rejectionNote, setRejectionNote] = useState("");

  useEffect(() => {
    setSelectedDecision("accept");
    setRejectionNote("");
  }, [requestId]);

  const options: ReadonlyArray<{
    decision: ProviderApprovalDecision;
    label: string;
    description: string;
  }> = [
    {
      decision: "accept",
      label: t("approval.option.approveOnce"),
      description: t("approval.option.approveOnceDescription"),
    },
    {
      decision: "acceptForSession",
      label: t("approval.option.alwaysAllowSession"),
      description: t("approval.option.alwaysAllowSessionDescription"),
    },
    {
      decision: "decline",
      label: t("approval.option.decline"),
      description: t("approval.option.declineDescription"),
    },
  ];

  return (
    <div className="space-y-1.5">
      <div className="space-y-0.5">
        {options.map((option, index) => {
          const isSelected = option.decision === selectedDecision;
          return (
            <button
              key={option.decision}
              type="button"
              disabled={isResponding}
              onClick={() => setSelectedDecision(option.decision)}
              className={cn(
                "group flex min-h-7 w-full items-center gap-2 rounded-lg px-2 py-1.25 text-left transition-colors duration-150",
                isSelected
                  ? "bg-[#f4f4f5] text-foreground dark:bg-muted/70"
                  : "text-foreground/72 hover:bg-muted/55 hover:text-foreground",
                isResponding && "cursor-not-allowed opacity-50",
              )}
            >
              <kbd
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-md text-[10px] font-medium tabular-nums transition-colors duration-150",
                  isSelected
                    ? "text-muted-foreground/58"
                    : "text-muted-foreground/42 group-hover:text-muted-foreground/68",
                )}
              >
                {index + 1}.
              </kbd>
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="shrink-0 truncate text-[12px] font-semibold leading-4">
                  {option.label}
                </span>
                <span className="min-w-0 truncate text-[11px] leading-4 text-muted-foreground/60">
                  {option.description}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="rounded-lg bg-muted/28 px-2 py-1.5">
        <textarea
          rows={2}
          value={rejectionNote}
          disabled={isResponding}
          onChange={(event) => setRejectionNote(event.target.value)}
          onFocus={() => setSelectedDecision("decline")}
          placeholder={
            pendingKind === "command"
              ? t("approval.rejectPlaceholder.command")
              : pendingKind === "file-read"
                ? t("approval.rejectPlaceholder.fileRead")
                : t("approval.rejectPlaceholder.fileChange")
          }
          aria-label={t("approval.rejectAriaLabel")}
          className="block min-h-9 w-full resize-none border-0 bg-transparent px-1 py-0 text-[12px] leading-4 text-foreground outline-none placeholder:text-muted-foreground/48 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 px-1">
        <Button
          size="xs"
          variant="ghost"
          className="rounded-full px-2 text-[12px] font-medium text-muted-foreground/72 hover:text-foreground"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "cancel")}
        >
          {t("approval.skip")}
        </Button>
        <Button
          size="sm"
          className="h-8 rounded-full bg-foreground px-3 text-[12px] font-semibold text-background shadow-sm hover:bg-foreground/90 hover:text-background"
          disabled={isResponding}
          onClick={() =>
            void onRespondToApproval(
              requestId,
              selectedDecision,
              selectedDecision === "decline" ? rejectionNote.trim() : undefined,
            )
          }
        >
          {t("approval.submit")}
          <CornerDownLeftIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
});
