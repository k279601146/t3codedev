import * as React from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from "../../commands.ts";
import { Feedback } from "../../components/Feedback.ts";
import type { LocalJSXCommandOnDone } from "../../types/command.ts";
import type { Message } from "../../types/message.ts";

// Shared function to render the Feedback component
export function renderFeedbackComponent(
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void,
  abortSignal: AbortSignal,
  messages: Message[],
  initialDescription: string = '',
  backgroundTasks: {
    [taskId: string]: {
      type: string;
      identity?: { agentId: string };
      messages?: Message[];
    };
  } = {},
): React.ReactNode {
  return (
    <Feedback
      abortSignal={abortSignal}
      messages={messages}
      initialDescription={initialDescription}
      onDone={onDone}
      backgroundTasks={backgroundTasks}
    />
  );
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const initialDescription = args || '';
  return renderFeedbackComponent(onDone, context.abortController.signal, context.messages, initialDescription);
}
