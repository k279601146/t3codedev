import { useCallback } from "react";
import { readEnvironmentApi } from "../environmentApi";
import type { EnvironmentId } from "@t3tools/contracts";
import { readWorkspaceFileWithBareNameFallback } from "./useFileContent.logic";

export function useFileContent(
  environmentId: EnvironmentId | null | undefined,
  cwd: string | null,
) {
  const fetchFile = useCallback(
    async (filePath: string): Promise<string> => {
      if (!environmentId) {
        throw new Error("No environment is active.");
      }
      if (!cwd) {
        throw new Error("No workspace root is available.");
      }

      const api = readEnvironmentApi(environmentId);
      if (!api) {
        throw new Error("Workspace API is unavailable.");
      }

      return readWorkspaceFileWithBareNameFallback(api, cwd, filePath);
    },
    [cwd, environmentId],
  );

  return { fetchFile };
}
