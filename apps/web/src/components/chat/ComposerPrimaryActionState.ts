export interface PendingActionLabelInput {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}

export interface StandardSendButtonDisabledInput {
  isSendBusy: boolean;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  hasSendableContent: boolean;
}

export interface RunningPrimaryActionModeInput {
  canSteerRunningTurn: boolean;
  hasSendableContent: boolean;
}

export type RunningPrimaryActionMode = "steer" | "interrupt";

export const formatPendingPrimaryActionLabel = (input: PendingActionLabelInput) => {
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

export const isStandardSendButtonDisabled = (input: StandardSendButtonDisabledInput) =>
  input.isSendBusy ||
  input.isConnecting ||
  input.isEnvironmentUnavailable ||
  !input.hasSendableContent;

export const getRunningPrimaryActionMode = (
  input: RunningPrimaryActionModeInput,
): RunningPrimaryActionMode =>
  input.canSteerRunningTurn && input.hasSendableContent ? "steer" : "interrupt";
