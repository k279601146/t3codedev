import { useQuery } from "@tanstack/react-query";
import type { EnvironmentId } from "@t3tools/contracts";
import { readEnvironmentApi } from "../environmentApi";

export function useFileTree(environmentId: EnvironmentId | null | undefined, cwd: string | null) {
  return useQuery({
    queryKey: ["cursor-file-tree", environmentId, cwd],
    queryFn: async () => {
      if (!environmentId || !cwd) {
        return null;
      }

      const api = readEnvironmentApi(environmentId);
      if (!api) {
        throw new Error("Workspace API is unavailable.");
      }

      return api.projects.listDirectory({ cwd, depth: 6 });
    },
    enabled: Boolean(environmentId && cwd),
    staleTime: 30_000,
  });
}
