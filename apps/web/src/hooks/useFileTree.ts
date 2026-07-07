import { useQuery } from "@tanstack/react-query";
import type { EnvironmentId } from "@t3tools/contracts";
import { ensureEnvironmentApi } from "../environmentApi";

export function useFileTree(environmentId: EnvironmentId | null | undefined, cwd: string | null) {
  return useQuery({
    queryKey: ["cursor-file-tree", environmentId, cwd],
    queryFn: async () => {
      if (!environmentId || !cwd) {
        return null;
      }

      const api = ensureEnvironmentApi(environmentId);
      return api.projects.listDirectory({ cwd, depth: 6 });
    },
    enabled: Boolean(environmentId && cwd),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
    placeholderData: (previous) => previous ?? undefined,
  });
}
