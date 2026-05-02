import * as React from 'react';
import { PermissionRuleList } from "@t3tools/ccb-engine/src/components/permissions/rules/PermissionRuleList.ts";
import type { LocalJSXCommandCall } from "@t3tools/ccb-engine/src/types/command.ts";
import { createPermissionRetryMessage } from "@t3tools/ccb-engine/src/utils/messages.ts";

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

