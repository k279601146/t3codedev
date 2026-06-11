import { memo, type PointerEventHandler } from "react";
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

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

export const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) => {
  if (input.isResponding) {
    return "Submitting...";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
};

export const isStandardSendButtonDisabled = (input: {
  isSendBusy: boolean;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  hasSendableContent: boolean;
}) =>
  input.isSendBusy ||
  input.isConnecting ||
  input.isEnvironmentUnavailable ||
  !input.hasSendableContent;

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
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {canSteerRunningTurn ? (
          <button
            type="submit"
            className={cn(
              "flex items-center justify-center rounded-full border border-black/5 text-white transition-[background-color,transform,box-shadow] duration-150 disabled:pointer-events-none disabled:shadow-none",
              newThreadMode
                ? "h-8 w-8 shadow-none enabled:cursor-pointer enabled:bg-neutral-500 enabled:hover:scale-[1.03] enabled:hover:bg-neutral-600 disabled:bg-neutral-400 disabled:text-white dark:enabled:bg-neutral-300 dark:enabled:text-neutral-950 dark:enabled:hover:bg-neutral-100 dark:disabled:bg-neutral-600 dark:disabled:text-neutral-300"
                : "h-9 w-9 shadow-sm enabled:cursor-pointer enabled:bg-neutral-950 enabled:hover:scale-[1.03] enabled:hover:bg-neutral-800 disabled:bg-neutral-300 disabled:text-white/85 dark:enabled:bg-neutral-50 dark:enabled:text-neutral-950 dark:enabled:hover:bg-white dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400 sm:h-8 sm:w-8",
            )}
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
            {isConnecting || isSendBusy ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                className="animate-spin"
                aria-hidden="true"
              >
                <circle
                  cx="7"
                  cy="7"
                  r="5.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeDasharray="20 12"
                />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        ) : null}
        <button
          type="button"
          className={cn(
            "flex size-8 cursor-pointer items-center justify-center rounded-full border text-white transition-[background-color,transform,box-shadow] duration-150 hover:scale-[1.03] sm:h-8 sm:w-8",
            newThreadMode
              ? "border-black/5 bg-neutral-500 shadow-none hover:bg-neutral-600 dark:bg-neutral-400 dark:text-neutral-950 dark:hover:bg-neutral-300"
              : "border-black/5 bg-neutral-950 shadow-sm hover:bg-neutral-900 dark:bg-neutral-50 dark:text-neutral-950 dark:hover:bg-white",
          )}
          {...pointerFocusProps}
          onClick={onInterrupt}
          aria-label="Stop generation"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden="true">
            <rect x="2" y="2" width="7" height="7" rx="1.4" />
          </svg>
        </button>
      </div>
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
          {isConnecting || isSendBusy ? "Sending..." : "Refine"}
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
          {isConnecting || isSendBusy ? "Sending..." : "Implement"}
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="default"
                className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8"
                aria-label="Implementation actions"
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
              Implement in a new thread
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  return (
    <button
      type="submit"
      className={cn(
        "flex items-center justify-center rounded-full border border-black/5 text-white transition-[background-color,transform,box-shadow] duration-150 disabled:pointer-events-none disabled:shadow-none",
        newThreadMode
          ? "h-8 w-8 shadow-none enabled:cursor-pointer enabled:bg-neutral-500 enabled:hover:scale-[1.03] enabled:hover:bg-neutral-600 disabled:bg-neutral-400 disabled:text-white dark:enabled:bg-neutral-300 dark:enabled:text-neutral-950 dark:enabled:hover:bg-neutral-100 dark:disabled:bg-neutral-600 dark:disabled:text-neutral-300"
          : "h-9 w-9 shadow-sm enabled:cursor-pointer enabled:bg-neutral-950 enabled:hover:scale-[1.03] enabled:hover:bg-neutral-800 disabled:bg-neutral-300 disabled:text-white/85 dark:enabled:bg-neutral-50 dark:enabled:text-neutral-950 dark:enabled:hover:bg-white dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400 sm:h-8 sm:w-8",
      )}
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
      {isConnecting || isSendBusy ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className="animate-spin"
          aria-hidden="true"
        >
          <circle
            cx="7"
            cy="7"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="20 12"
          />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
});
