import { type ApprovalRequestId } from "@t3tools/contracts";
import { memo, useEffect, useEffectEvent, useRef } from "react";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
  onPreviousQuestion: () => void;
  onSelectQuestion: (questionIndex: number) => void;
  onIgnore: () => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onPreviousQuestion,
  onSelectQuestion,
  onIgnore,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
      onPreviousQuestion={onPreviousQuestion}
      onSelectQuestion={onSelectQuestion}
      onIgnore={onIgnore}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onPreviousQuestion,
  onSelectQuestion,
  onIgnore,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
  onPreviousQuestion: () => void;
  onSelectQuestion: (questionIndex: number) => void;
  onIgnore: () => void;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const onAdvanceRef = useRef(onAdvance);

  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  // 卸载时清理单选自动推进计时器。
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  const handleOptionSelection = useEffectEvent((questionId: string, optionLabel: string) => {
    onToggleOption(questionId, optionLabel);
    if (activeQuestion?.multiSelect) {
      return;
    }
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      onAdvanceRef.current();
    }, 200);
  });

  // 数字键 1-9 选择对应选项；Esc 忽略本轮结构化问题。
  useEffect(() => {
    if (!activeQuestion || isResponding) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onIgnore();
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const optionIndex = digit - 1;
      if (optionIndex >= activeQuestion.options.length) return;
      const option = activeQuestion.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      handleOptionSelection(activeQuestion.id, option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, isResponding, onIgnore]);

  if (!activeQuestion) {
    return null;
  }

  return (
    <div className="px-2.5 py-2.5 sm:px-3.5">
      <div className="rounded-[20px] border border-border/55 bg-background/98 p-2 shadow-[0_12px_34px_rgba(15,23,42,0.10)] dark:bg-background/96 dark:shadow-[0_16px_42px_rgba(0,0,0,0.34)]">
        <div className="flex min-w-0 items-center justify-between gap-3 px-2 pb-2 pt-0.5">
          <p className="min-w-0 truncate text-[13px] font-semibold leading-5 text-foreground/94">
            {activeQuestion.question}
          </p>
          {prompt.questions.length > 1 ? (
            <div className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground/60">
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded-full transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                disabled={isResponding || progress.questionIndex === 0}
                aria-label="上一个问题"
                title="上一个问题"
                onClick={onPreviousQuestion}
              >
                <ChevronLeftIcon className="size-4" />
              </button>
              <span className="tabular-nums">
                {progress.questionIndex + 1} of {prompt.questions.length}
              </span>
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded-full transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                disabled={isResponding || progress.questionIndex >= prompt.questions.length - 1}
                aria-label="下一个问题"
                title="下一个问题"
                onClick={onAdvance}
              >
                <ChevronRightIcon className="size-4" />
              </button>
            </div>
          ) : null}
        </div>

        {prompt.questions.length > 1 ? (
          <div className="mb-1.5 flex items-center gap-1 px-2">
            {prompt.questions.map((question, index) => {
              const isActive = index === progress.questionIndex;
              const isAnswered =
                Boolean(answers[question.id]?.customAnswer?.trim()) ||
                Boolean(answers[question.id]?.selectedOptionLabels?.length);
              return (
                <button
                  key={question.id}
                  type="button"
                  className={cn(
                    "h-1.5 min-w-6 flex-1 rounded-full transition-colors",
                    isActive
                      ? "bg-blue-500"
                      : isAnswered
                        ? "bg-blue-500/35"
                        : "bg-muted-foreground/15",
                  )}
                  disabled={isResponding}
                  aria-label={`切换到第 ${index + 1} 个问题`}
                  title={`切换到第 ${index + 1} 个问题`}
                  onClick={() => onSelectQuestion(index)}
                />
              );
            })}
          </div>
        ) : null}

        <div className="space-y-1">
          {activeQuestion.options.map((option, index) => {
            const isSelected = progress.selectedOptionLabels.includes(option.label);
            const shortcutKey = index < 9 ? index + 1 : null;
            return (
              <button
                key={`${activeQuestion.id}:${option.label}`}
                type="button"
                disabled={isResponding}
                onClick={() => handleOptionSelection(activeQuestion.id, option.label)}
                className={cn(
                  "group flex min-h-9 w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors duration-150",
                  isSelected
                    ? "bg-[#f4f4f5] text-foreground dark:bg-muted/70"
                    : "text-foreground/72 hover:bg-muted/55 hover:text-foreground",
                  isResponding && "cursor-not-allowed opacity-50",
                )}
              >
                {shortcutKey !== null ? (
                  <kbd
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-md text-[12px] font-medium tabular-nums transition-colors duration-150",
                      isSelected
                        ? "text-muted-foreground/58"
                        : "text-muted-foreground/42 group-hover:text-muted-foreground/68",
                    )}
                  >
                    {shortcutKey}.
                  </kbd>
                ) : null}
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-5">
                    {option.label}
                  </span>
                  {option.description && option.description !== option.label ? (
                    <span className="block truncate text-[12px] leading-4 text-muted-foreground/60 sm:inline sm:pl-2">
                      {option.description}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex min-w-0 items-center justify-between gap-3 px-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground/72 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
            disabled={isResponding}
            onClick={onIgnore}
          >
            忽略
            <kbd className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground/70">
              ESC
            </kbd>
          </button>
          <div className="flex items-center gap-1.5">
            {prompt.questions.length > 1 ? (
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                disabled={isResponding || progress.questionIndex === 0}
                onClick={onPreviousQuestion}
              >
                <ChevronDownIcon className="size-3.5 rotate-90" />
                返回
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-blue-500 px-3 text-[12px] font-semibold text-white shadow-sm shadow-blue-500/20 transition-colors hover:bg-blue-600 disabled:pointer-events-none disabled:opacity-50"
              disabled={isResponding || !progress.canAdvance}
              onClick={onAdvance}
            >
              {progress.isLastQuestion ? "提交" : "下一题"}
              <CornerDownLeftIcon className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
