import { useCallback, useState } from 'react';
import { setTeleportedSessionInfo } from "../bootstrap/state.ts";
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from "../services/analytics/index.ts";
import type { TeleportRemoteResponse } from "../utils/conversationRecovery.ts";
import type { CodeSession } from "../utils/teleport/api.ts";
import { errorMessage, TeleportOperationError } from "../utils/errors.ts";
import { teleportResumeCodeSession } from "../utils/teleport.tsx";

export type TeleportResumeError = {
  message: string;
  formattedMessage?: string;
  isOperationError: boolean;
};

export type TeleportSource = 'cliArg' | 'localCommand';

export function useTeleportResume(source: TeleportSource) {
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<TeleportResumeError | null>(null);
  const [selectedSession, setSelectedSession] = useState<CodeSession | null>(null);

  const resumeSession = useCallback(
    async (session: CodeSession): Promise<TeleportRemoteResponse | null> => {
      setIsResuming(true);
      setError(null);
      setSelectedSession(session);

      // Log teleport session selection
      logEvent('tengu_teleport_resume_session', {
        source: source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        session_id: session.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });

      try {
        const result = await teleportResumeCodeSession(session.id);
        // Track teleported session for reliability logging
        setTeleportedSessionInfo({ sessionId: session.id });
        setIsResuming(false);
        return result;
      } catch (err) {
        const teleportError: TeleportResumeError = {
          message: err instanceof TeleportOperationError ? err.message : errorMessage(err),
          formattedMessage: err instanceof TeleportOperationError ? err.formattedMessage : undefined,
          isOperationError: err instanceof TeleportOperationError,
        };
        setError(teleportError);
        setIsResuming(false);
        return null;
      }
    },
    [source],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    resumeSession,
    isResuming,
    error,
    selectedSession,
    clearError,
  };
}
