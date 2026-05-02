import { useEffect, useRef } from 'react';
import { useNotifications } from "../../context/notifications.tsx";
import { getModelDeprecationWarning } from "@t3tools/ccb-engine/src/utils/model/deprecation.ts";
import { getIsRemoteMode } from "@t3tools/ccb-engine/src/bootstrap/state.ts";

export function useDeprecationWarningNotification(model: string): void {
  const { addNotification } = useNotifications();
  const lastWarningRef = useRef<string | null>(null);

  useEffect(() => {
    if (getIsRemoteMode()) return;
    const deprecationWarning = getModelDeprecationWarning(model);

    // Show warning if model is deprecated and we haven't shown this exact warning yet
    if (deprecationWarning && deprecationWarning !== lastWarningRef.current) {
      lastWarningRef.current = deprecationWarning;
      addNotification({
        key: 'model-deprecation-warning',
        text: deprecationWarning,
        color: 'warning',
        priority: 'high',
      });
    }

    // Reset tracking if model changes to non-deprecated
    if (!deprecationWarning) {
      lastWarningRef.current = null;
    }
  }, [model, addNotification]);
}

