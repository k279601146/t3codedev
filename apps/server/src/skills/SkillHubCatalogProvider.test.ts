import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";

import { makeSkillHubCatalogProvider } from "./SkillHubCatalogProvider.ts";

const withMockFetch = <A, E, R>(
  handler: (url: string) => Response,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.fetch;
      globalThis.fetch = ((input: Parameters<typeof fetch>[0]) =>
        Promise.resolve(handler(String(input)))) as typeof fetch;
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        globalThis.fetch = previous;
      }),
  );

describe("SkillHubCatalogProvider", () => {
  it.effect("映射分类、分页列表、详情、文件和下载", () =>
    withMockFetch(
      (url) => {
        if (url.includes("/api/v1/categories")) {
          return Response.json([{ key: "docs", name: "文档" }]);
        }
        if (url.includes("/api/skills?")) {
          return Response.json({
            code: 0,
            data: {
              skills: [
                {
                  slug: "pdf",
                  name: "pdf",
                  title: "PDF",
                  description_zh: "处理 PDF",
                  downloads: 42,
                  category: "docs",
                  iconUrl: "https://example.test/pdf.png",
                  labels: { requires_api_key: "true" },
                  upstream_url: "https://example.test/pdf",
                  verified: true,
                },
              ],
              total: 1,
            },
          });
        }
        if (url.includes("/api/v1/skills/pdf/files")) {
          return Response.json({
            files: [{ path: "SKILL.md", sha256: "abc", size: 12 }],
          });
        }
        if (url.includes("/api/v1/skills/pdf/file")) {
          return new Response("# PDF");
        }
        if (url.includes("/api/v1/download")) {
          return new Response(new Uint8Array([1, 2, 3]));
        }
        if (url.includes("/api/v1/skills/pdf")) {
          return Response.json({
            skill: {
              slug: "pdf",
              name: "pdf",
              title: "PDF",
              version: "0.1.0",
            },
          });
        }
        return Response.json({}, { status: 404 });
      },
      Effect.gen(function* () {
        const provider = makeSkillHubCatalogProvider({} as HttpClient.HttpClient);

        const catalog = yield* provider.list({ page: 1, pageSize: 5 });
        assert.equal(catalog.total, 1);
        assert.equal(catalog.categories[0]?.key, "docs");
        assert.equal(catalog.items[0]?.id, "skillhub:pdf");
        assert.equal(catalog.items[0]?.downloads, 42);
        assert.equal(catalog.items[0]?.categoryName, "文档");
        assert.equal(catalog.items[0]?.iconSmall, "https://example.test/pdf.png");
        assert.equal(catalog.items[0]?.requiresApiKey, true);
        assert.equal(catalog.items[0]?.securityStatus, "verified");

        const detail = yield* provider.find("skillhub:pdf");
        assert.equal(detail?.version, "0.1.0");

        const content = yield* provider.readContent("skillhub:pdf");
        assert.equal(content?.markdown, "# PDF");

        const files = yield* provider.readFiles("skillhub:pdf");
        assert.equal(files?.[0]?.sha256, "abc");

        const zipBytes = yield* provider.downloadZip("skillhub:pdf");
        assert.deepEqual(Array.from(zipBytes ?? []), [1, 2, 3]);
      }),
    ),
  );

  it.effect("远端返回未过滤列表时按搜索词本地过滤", () =>
    withMockFetch(
      (url) => {
        if (url.includes("/api/v1/categories")) {
          return Response.json([{ key: "docs", name: "文档" }]);
        }
        if (url.includes("/api/skills?")) {
          const parsed = new URL(url);
          assert.equal(parsed.searchParams.get("query"), "pdf");
          assert.equal(parsed.searchParams.get("q"), "pdf");
          assert.equal(parsed.searchParams.get("search"), "pdf");
          assert.equal(parsed.searchParams.get("keyword"), "pdf");
          return Response.json({
            data: {
              skills: [
                {
                  slug: "pdf",
                  name: "pdf",
                  title: "PDF",
                  description_zh: "处理 PDF",
                  category: "docs",
                },
                {
                  slug: "ppt",
                  name: "ppt",
                  title: "PPT",
                  description_zh: "生成演示文稿",
                  category: "docs",
                },
              ],
              total: 2,
            },
          });
        }
        return Response.json({}, { status: 404 });
      },
      Effect.gen(function* () {
        const provider = makeSkillHubCatalogProvider({} as HttpClient.HttpClient);

        const catalog = yield* provider.list({ page: 1, pageSize: 5, query: "pdf" });

        assert.deepEqual(
          catalog.items.map((item) => item.id),
          ["skillhub:pdf"],
        );
        assert.equal(catalog.total, 1);
      }),
    ),
  );
});
