import * as React from 'react';
import { PermissionRuleList } from "../../components/permissions/rules/PermissionRuleList.ts";
import type { LocalJSXCommandCall } from "../../types/command.ts";
import { createPermissionRetryMessage } from "../../utils/messages.ts";

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return (
    <PermissionRuleList
      onExit={onDone}
      onRetryDenials={commands => {
        context.setMessages(prev => [...prev, createPermissionRetryMessage(commands)]);
      }}
    />
  );
};
