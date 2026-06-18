import { memo, type PointerEventHandler } from "react";
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import { useI18n } from "../../i18n";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  formatPendingPrimaryActionLabel,
  getRunningPrimaryActionMode,
  isStandardSendButtonDisabled,
} from "./ComposerPrimaryActionState";
import {
  ComposerSendArrowIcon,
  ComposerSpinnerIcon,
  ComposerStopSquareIcon,
  composerPrimaryButtonClassName,
} from "./ComposerPrimaryButton";

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

interface ComposerPrimaryActionsProps {
  compact: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  canSteerRunningTurn: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  isInterruptPending?: boolean;
  isUsageLimitReached?: boolean;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  newThreadMode?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  compact,
  pendingAction,
  isRunning,
  canSteerRunningTurn,
  showPlanFollowUpPrompt,
  promptHasText,
  isSendBusy,
  isInterruptPending = false,
  isUsageLimitReached = false,
  isConnecting,
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  preserveComposerFocusOnPointerDown = false,
  newThreadMode = false,
  onPreviousPendingQuestion,
  onInterrupt,
  onImplementPlanInNewThread,
}: ComposerPrimaryActionsProps) {
  const { t } = useI18n();
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label="Previous question"
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              Previous
            </Button>
          )
        ) : null}
        <Button
          type="submit"
          size="sm"
          className={cn("rounded-full", compact ? "px-3" : "px-4")}
          {...pointerFocusProps}
          disabled={
            isEnvironmentUnavailable ||
            pendingAction.isResponding ||
            (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
          }
        >
          {formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: pendingAction.isLastQuestion,
            isResponding: pendingAction.isResponding,
            questionIndex: pendingAction.questionIndex,
          })}
        </Button>
      </div>
    );
  }

  if (isRunning) {
    const runningPrimaryActionMode = getRunningPrimaryActionMode({
      canSteerRunningTurn,
      hasSendableContent,
      isInterruptPending,
    });

    if (runningPrimaryActionMode === "steer") {
      return (
        <button
          type="submit"
          className={composerPrimaryButtonClassName({ newThreadMode })}
          {...pointerFocusProps}
          disabled={isStandardSendButtonDisabled({
            isSendBusy,
            isConnecting,
            isEnvironmentUnavailable,
            hasSendableContent,
          })}
          aria-label={
            isEnvironmentUnavailable
              ? "Environment disconnected"
              : isConnecting
                ? "Connecting"
                : isSendBusy
                  ? "Sending"
                  : "Steer current turn"
          }
        >
          {isConnecting || isSendBusy ? <ComposerSpinnerIcon /> : <ComposerSendArrowIcon />}
        </button>
      );
    }

    return (
      <button
        type="button"
        className={composerPrimaryButtonClassName({ newThreadMode })}
        {...pointerFocusProps}
        onClick={onInterrupt}
        aria-label={isInterruptPending ? "Stopping generation" : "Stop generation"}
      >
        <ComposerStopSquareIcon />
      </button>
    );
  }

  if (showPlanFollowUpPrompt) {
    if (promptHasText) {
      return (
        <Button
          type="submit"
          size="sm"
          className={cn("rounded-full", compact ? "h-9 px-3 sm:h-8" : "h-9 px-4 sm:h-8")}
          {...pointerFocusProps}
          disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? t("composer.plan.sending") : t("composer.plan.refine")}
        </Button>
      );
    }

    return (
      <div data-chat-composer-implement-actions="true" className="flex items-center justify-end">
        <Button
          type="submit"
          size="sm"
          className="h-9 rounded-l-full rounded-r-none px-4 sm:h-8"
          {...pointerFocusProps}
          disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? t("composer.plan.sending") : t("composer.plan.implement")}
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="default"
                className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8"
                aria-label={t("composer.plan.implementationActions")}
                {...pointerFocusProps}
                disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}
              />
            }
          >
            <ChevronDownIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" side="top">
            <MenuItem
              disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}
              onClick={() => void onImplementPlanInNewThread()}
            >
              {t("composer.plan.implementInNewThread")}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  return (
    <button
      type="submit"
      className={composerPrimaryButtonClassName({ newThreadMode })}
      {...pointerFocusProps}
      disabled={isStandardSendButtonDisabled({
        isSendBusy,
        isConnecting,
        isEnvironmentUnavailable,
        hasSendableContent,
      })}
      aria-label={
        isUsageLimitReached
          ? "Usage limit reached"
          : isEnvironmentUnavailable
            ? "Environment disconnected"
            : isConnecting
              ? "Connecting"
              : isPreparingWorktree
                ? "Preparing worktree"
                : isSendBusy
                  ? "Sending"
                  : "Send message"
      }
    >
      {isConnecting || isSendBusy ? <ComposerSpinnerIcon /> : <ComposerSendArrowIcon />}
    </button>
  );
});
