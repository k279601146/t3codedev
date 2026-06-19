import { describe, expect, it, vi } from "vitest";
import { readWorkspaceFileWithBareNameFallback } from "./useFileContent.logic";

type ProjectFileApi = Parameters<typeof readWorkspaceFileWithBareNameFallback>[0];

function makeApi(input: {
  readFile: ProjectFileApi["projects"]["readFile"];
  searchEntries?: ProjectFileApi["projects"]["searchEntries"];
}): ProjectFileApi {
  return {
    projects: {
      readFile: input.readFile,
      searchEntries:
        input.searchEntries ??
        vi.fn(async () => ({
          entries: [],
          truncated: false,
        })),
    },
  };
}

describe("readWorkspaceFileWithBareNameFallback", () => {
  it("裸文件名读取失败后，会用唯一搜索命中路径重读", async () => {
    const readFile = vi.fn(async (input: { relativePath: string }) => {
      if (input.relativePath === "apps/web/src/components/ImageCanvas/useCanvasEngine.ts") {
        return {
          contents: "export function useCanvasEngine() {}",
          relativePath: input.relativePath,
          sizeBytes: 35,
        };
      }
      throw new Error(
        "NotFound: FileSystem.readFile (D:\\workspace\\dev2_OpenHarness_SaaS\\useCanvasEngine.ts)",
      );
    });
    const searchEntries = vi.fn(async () => ({
      entries: [
        {
          kind: "file" as const,
          path: "apps/web/src/components/ImageCanvas/useCanvasEngine.ts",
          parentPath: "apps/web/src/components/ImageCanvas",
        },
      ],
      truncated: false,
    }));
    const api = makeApi({ readFile, searchEntries });

    await expect(
      readWorkspaceFileWithBareNameFallback(
        api,
        "D:\\workspace\\dev2_OpenHarness_SaaS",
        "useCanvasEngine.ts",
      ),
    ).resolves.toBe("export function useCanvasEngine() {}");

    expect(searchEntries).toHaveBeenCalledWith({
      cwd: "D:\\workspace\\dev2_OpenHarness_SaaS",
      query: "useCanvasEngine.ts",
      limit: 25,
    });
    expect(readFile).toHaveBeenNthCalledWith(1, {
      cwd: "D:\\workspace\\dev2_OpenHarness_SaaS",
      relativePath: "useCanvasEngine.ts",
    });
    expect(readFile).toHaveBeenNthCalledWith(2, {
      cwd: "D:\\workspace\\dev2_OpenHarness_SaaS",
      relativePath: "apps/web/src/components/ImageCanvas/useCanvasEngine.ts",
    });
  });

  it("多个同名文件命中时不猜测目标", async () => {
    const originalError = new Error("NotFound: FileSystem.readFile");
    const readFile = vi.fn(async () => {
      throw originalError;
    });
    const searchEntries = vi.fn(async () => ({
      entries: [
        { kind: "file" as const, path: "src/useCanvasEngine.ts", parentPath: "src" },
        { kind: "file" as const, path: "tests/useCanvasEngine.ts", parentPath: "tests" },
      ],
      truncated: false,
    }));
    const api = makeApi({ readFile, searchEntries });

    await expect(
      readWorkspaceFileWithBareNameFallback(
        api,
        "D:\\workspace\\dev2_OpenHarness_SaaS",
        "useCanvasEngine.ts",
      ),
    ).rejects.toBe(originalError);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("带目录的路径失败时不触发裸文件名搜索", async () => {
    const originalError = new Error("NotFound: FileSystem.readFile");
    const readFile = vi.fn(async () => {
      throw originalError;
    });
    const searchEntries = vi.fn(async () => ({
      entries: [
        {
          kind: "file" as const,
          path: "apps/web/src/components/ImageCanvas/useCanvasEngine.ts",
          parentPath: "apps/web/src/components/ImageCanvas",
        },
      ],
      truncated: false,
    }));
    const api = makeApi({ readFile, searchEntries });

    await expect(
      readWorkspaceFileWithBareNameFallback(
        api,
        "D:\\workspace\\dev2_OpenHarness_SaaS",
        "apps/web/useCanvasEngine.ts",
      ),
    ).rejects.toBe(originalError);
    expect(searchEntries).not.toHaveBeenCalled();
  });
});
