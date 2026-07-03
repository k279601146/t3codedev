export type ComposerSurface = "new-thread" | "reply";

export function deriveComposerFooterVisibility(input: {
  composerSurface: ComposerSurface;
  hasPlanSidebarContent: boolean;
  planSidebarOpen: boolean;
  hasContextWindow: boolean;
}): {
  showPlanSidebarToggle: boolean;
  showContextWindow: boolean;
} {
  const isReplyComposer = input.composerSurface === "reply";
  return {
    showPlanSidebarToggle:
      isReplyComposer && (input.hasPlanSidebarContent || input.planSidebarOpen),
    showContextWindow: input.hasContextWindow,
  };
}
