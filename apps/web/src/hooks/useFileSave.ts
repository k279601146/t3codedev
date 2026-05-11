import { useCallback } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { readEnvironmentApi } from "../environmentApi";

export function useFileSave(environmentId: EnvironmentId | null | undefined) {
  const saveFile = useCallback(
    async (filePath: string, contents: string, cwd: string): Promise<void> => {
      if (!environmentId) {
        throw new Error("No environment is active.");
      }

      const api = readEnvironmentApi(environmentId);
      if (!api) {
        throw new Error("Workspace API is unavailable.");
      }

      await api.projects.writeFile({
        cwd,
        relativePath: filePath,
        contents,
      });
    },
    [environmentId],
  );

  return { saveFile };
}
