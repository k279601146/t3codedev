import {
  type SkillCatalogCategory,
  type SkillCatalogItem,
  type InstalledSkill,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  Clock3Icon,
  DownloadIcon,
  Loader2Icon,
  PackageIcon,
  PlusIcon,
  RefreshCcwIcon,
  SearchIcon,
  StarIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { useI18n } from "~/i18n";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";

import { CatalogMetaRow } from "./SkillCatalogBadges";
import { SkillDetailDialog } from "./SkillDetailDialog";

const SKILLS_LIST_QUERY = ["skills", "list"] as const;
const SKILLS_CATALOG_QUERY = ["skills", "catalog"] as const;
const CATALOG_PAGE_SIZE = 30;

type CatalogSortBy = "updated" | "downloads" | "favorites";

const CATALOG_SORT_OPTIONS: ReadonlyArray<{
  readonly value: CatalogSortBy;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "updated", label: "最新发布", icon: Clock3Icon },
  { value: "downloads", label: "下载最多", icon: DownloadIcon },
  { value: "favorites", label: "收藏最多", icon: StarIcon },
];

function getSkillsClient() {
  return getPrimaryEnvironmentConnection().client.skills;
}

function getSkillIconUrl(skill: { iconSmallUrl?: string; iconLargeUrl?: string }): string | null {
  const small = skill.iconSmallUrl?.trim();
  if (small) return small;
  const large = skill.iconLargeUrl?.trim();
  return large || null;
}

function buildOptimisticInstalledSkill(catalogItem: SkillCatalogItem): InstalledSkill {
  return {
    name: catalogItem.name,
    displayName: catalogItem.displayName,
    ...(catalogItem.description ? { description: catalogItem.description } : {}),
    ...(catalogItem.shortDescription ? { shortDescription: catalogItem.shortDescription } : {}),
    scope: "user",
    enabled: true,
    ...(catalogItem.iconSmallUrl ? { iconSmallUrl: catalogItem.iconSmallUrl } : {}),
    ...(catalogItem.iconLargeUrl ? { iconLargeUrl: catalogItem.iconLargeUrl } : {}),
  };
}

interface SkillsMutationContext {
  readonly previousInstalled?: { readonly skills: InstalledSkill[] };
  readonly previousCatalog?: {
    readonly items: SkillCatalogItem[];
    readonly fetchedAt?: number;
    readonly hasErrors?: boolean;
  };
}

interface SkillCardProps {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  readonly meta?: React.ReactNode;
  readonly action: React.ReactNode;
  readonly onClick: () => void;
}

const SkillCard = memo(function SkillCard({
  icon,
  title,
  subtitle,
  meta,
  action,
  onClick,
}: SkillCardProps) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-3 rounded-md px-3 py-3 text-start transition hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
    >
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{title}</div>
        {subtitle ? <div className="truncate text-xs text-muted-foreground">{subtitle}</div> : null}
        {meta}
      </div>
      <div className="shrink-0">{action}</div>
    </button>
  );
});

function FallbackIcon({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="text-sm font-semibold text-muted-foreground" aria-hidden>
      {initial}
    </span>
  );
}

function SkillIcon({ iconUrl, fallbackName }: { iconUrl: string | null; fallbackName: string }) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [iconUrl]);

  if (!iconUrl || errored) {
    return <FallbackIcon name={fallbackName} />;
  }

  return (
    <img
      alt=""
      src={iconUrl}
      className="size-8 rounded-sm object-contain"
      onError={() => setErrored(true)}
      draggable={false}
    />
  );
}

function SkillCardSkeleton() {
  return (
    <div className="flex w-full items-center gap-3 rounded-md px-3 py-3">
      <Skeleton className="size-10 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

interface SkillsPageProps {
  readonly embedded?: boolean;
  readonly view?: "all" | "installed" | "sources";
}

export function SkillsPage({
  embedded = false,
  view = "all",
}: SkillsPageProps = {}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeSkill, setActiveSkill] = useState<
    { kind: "installed"; data: InstalledSkill } | { kind: "catalog"; data: SkillCatalogItem } | null
  >(null);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogItems, setCatalogItems] = useState<SkillCatalogItem[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<ReadonlyArray<SkillCatalogCategory>>(
    [],
  );
  const [catalogSortBy, setCatalogSortBy] = useState<CatalogSortBy>("downloads");
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogExhausted, setCatalogExhausted] = useState(false);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [uninstallingSkillName, setUninstallingSkillName] = useState<string | null>(null);
  const trimmedSearch = search.trim();

  const installedQuery = useQuery({
    queryKey: SKILLS_LIST_QUERY,
    queryFn: () => getSkillsClient().list(),
    staleTime: 30_000,
  });

  const resetCatalogPagination = useCallback(() => {
    setCatalogItems([]);
    setCatalogTotal(0);
    setCatalogPage(1);
    setCatalogExhausted(false);
  }, []);

  const catalogQuery = useQuery({
    queryKey: [
      ...SKILLS_CATALOG_QUERY,
      {
        category: selectedCategory,
        page: catalogPage,
        pageSize: CATALOG_PAGE_SIZE,
        query: trimmedSearch,
        sortBy: catalogSortBy,
      },
    ] as const,
    queryFn: () =>
      getSkillsClient().catalog({
        page: catalogPage,
        pageSize: CATALOG_PAGE_SIZE,
        sortBy: catalogSortBy,
        order: "desc",
        ...(selectedCategory !== "all" ? { category: selectedCategory } : {}),
        ...(trimmedSearch ? { query: trimmedSearch } : {}),
      }),
    staleTime: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      getSkillsClient().refresh({
        force: true,
        page: 1,
        pageSize: CATALOG_PAGE_SIZE,
        sortBy: catalogSortBy,
        order: "desc",
        ...(selectedCategory !== "all" ? { category: selectedCategory } : {}),
        ...(trimmedSearch ? { query: trimmedSearch } : {}),
      }),
    onSuccess: () => {
      resetCatalogPagination();
      void queryClient.refetchQueries({ queryKey: SKILLS_CATALOG_QUERY, type: "active" });
      void queryClient.refetchQueries({ queryKey: SKILLS_LIST_QUERY, type: "active" });
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: "error",
        title: t("skills.refreshFailed"),
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const installMutation = useMutation({
    mutationFn: async (catalogItem: SkillCatalogItem) => {
      const result = await getSkillsClient().install({ catalogItemId: catalogItem.id });
      return { result, catalogItem };
    },
    onMutate: async (catalogItem): Promise<SkillsMutationContext> => {
      setInstallingSkillId(catalogItem.id);
      await queryClient.cancelQueries({ queryKey: SKILLS_LIST_QUERY });
      await queryClient.cancelQueries({ queryKey: SKILLS_CATALOG_QUERY });

      const previousInstalled = queryClient.getQueryData<{ skills: InstalledSkill[] }>(
        SKILLS_LIST_QUERY,
      );
      const previousCatalog = queryClient.getQueryData<{
        items: SkillCatalogItem[];
        fetchedAt?: number;
        hasErrors?: boolean;
      }>(SKILLS_CATALOG_QUERY);

      queryClient.setQueryData<{ skills: InstalledSkill[] }>(SKILLS_LIST_QUERY, (current) => {
        const next = current?.skills ?? [];
        if (next.some((skill) => skill.name === catalogItem.name)) {
          return current ?? { skills: next };
        }
        return {
          skills: [...next, buildOptimisticInstalledSkill(catalogItem)].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        };
      });

      queryClient.setQueryData<{
        items: SkillCatalogItem[];
        fetchedAt?: number;
        hasErrors?: boolean;
      }>(SKILLS_CATALOG_QUERY, (current) => {
        if (!current) return current;
        return {
          ...current,
          items: current.items.filter((item) => item.id !== catalogItem.id),
        };
      });

      if (activeSkill?.kind === "catalog" && activeSkill.data.id === catalogItem.id) {
        setActiveSkill({ kind: "installed", data: buildOptimisticInstalledSkill(catalogItem) });
      }

      return {
        ...(previousInstalled ? { previousInstalled } : {}),
        ...(previousCatalog ? { previousCatalog } : {}),
      };
    },
    onSuccess: ({ result, catalogItem }) => {
      void queryClient.refetchQueries({ queryKey: SKILLS_LIST_QUERY, type: "active" });
      void queryClient.refetchQueries({ queryKey: SKILLS_CATALOG_QUERY, type: "active" });
      toastManager.add({
        type: "success",
        title: result.alreadyAdded ? t("skills.alreadyInstalled") : t("skills.installSuccess"),
        description: t("skills.installSuccessDescription", { name: catalogItem.displayName }),
      });
      setActiveSkill(null);
    },
    onError: (error: unknown, catalogItem, context) => {
      if (context?.previousInstalled) {
        queryClient.setQueryData(SKILLS_LIST_QUERY, context.previousInstalled);
      }
      if (context?.previousCatalog) {
        queryClient.setQueryData(SKILLS_CATALOG_QUERY, context.previousCatalog);
      }
      if (activeSkill?.kind === "installed" && activeSkill.data.name === catalogItem.name) {
        setActiveSkill({ kind: "catalog", data: catalogItem });
      }
      toastManager.add({
        type: "error",
        title: t("skills.installFailed"),
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSettled: () => {
      setInstallingSkillId(null);
      void queryClient.invalidateQueries({ queryKey: SKILLS_LIST_QUERY });
      void queryClient.invalidateQueries({ queryKey: SKILLS_CATALOG_QUERY });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (skill: InstalledSkill) => {
      const result = await getSkillsClient().uninstall({ skillName: skill.name });
      return { result, skill };
    },
    onMutate: async (skill): Promise<SkillsMutationContext> => {
      setUninstallingSkillName(skill.name);
      await queryClient.cancelQueries({ queryKey: SKILLS_LIST_QUERY });

      const previousInstalled = queryClient.getQueryData<{ skills: InstalledSkill[] }>(
        SKILLS_LIST_QUERY,
      );

      queryClient.setQueryData<{ skills: InstalledSkill[] }>(SKILLS_LIST_QUERY, (current) => ({
        skills: (current?.skills ?? []).filter((item) => item.name !== skill.name),
      }));

      if (activeSkill?.kind === "installed" && activeSkill.data.name === skill.name) {
        setActiveSkill(null);
      }

      return previousInstalled ? { previousInstalled } : {};
    },
    onSuccess: ({ skill }) => {
      void queryClient.refetchQueries({ queryKey: SKILLS_LIST_QUERY, type: "active" });
      void queryClient.refetchQueries({ queryKey: SKILLS_CATALOG_QUERY, type: "active" });
      toastManager.add({
        type: "success",
        title: t("skills.uninstallSuccess"),
        description: t("skills.uninstallSuccessDescription", {
          name: skill.displayName ?? skill.name,
        }),
      });
      setActiveSkill(null);
    },
    onError: (error: unknown, _skill, context) => {
      if (context?.previousInstalled) {
        queryClient.setQueryData(SKILLS_LIST_QUERY, context.previousInstalled);
      }
      toastManager.add({
        type: "error",
        title: t("skills.uninstallFailed"),
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSettled: () => {
      setUninstallingSkillName(null);
      void queryClient.invalidateQueries({ queryKey: SKILLS_LIST_QUERY });
      void queryClient.invalidateQueries({ queryKey: SKILLS_CATALOG_QUERY });
    },
  });

  const installedNames = useMemo(() => {
    const set = new Set<string>();
    for (const skill of installedQuery.data?.skills ?? []) {
      set.add(skill.name.toLowerCase());
    }
    return set;
  }, [installedQuery.data]);

  const filteredInstalled = useMemo(() => {
    const query = search.trim().toLowerCase();
    const items = installedQuery.data?.skills ?? [];
    if (!query) return items;
    return items.filter((skill) =>
      [skill.name, skill.displayName, skill.description, skill.shortDescription]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [installedQuery.data, search]);

  const filteredCatalog = useMemo(() => {
    const items = catalogItems.filter(
      (item) => !installedNames.has(item.name.toLowerCase()),
    );
    return items;
  }, [catalogItems, installedNames]);

  useEffect(() => {
    resetCatalogPagination();
  }, [trimmedSearch, selectedCategory, catalogSortBy, resetCatalogPagination]);

  useEffect(() => {
    const data = catalogQuery.data;
    if (!data) return;
    setCatalogCategories(data.categories);
    setCatalogTotal(data.total);
    setCatalogItems((current) => {
      if (data.page <= 1) {
        setCatalogExhausted(data.items.length < CATALOG_PAGE_SIZE);
        return [...data.items];
      }
      const byId = new Map(current.map((item) => [item.id, item]));
      const beforeSize = byId.size;
      for (const item of data.items) {
        byId.set(item.id, item);
      }
      if (data.items.length < CATALOG_PAGE_SIZE || byId.size === beforeSize) {
        setCatalogExhausted(true);
      }
      return [...byId.values()];
    });
  }, [catalogQuery.data]);

  const categories =
    catalogCategories.length > 0 ? catalogCategories : (catalogQuery.data?.categories ?? []);

  const canLoadMoreCatalog =
    view === "all" &&
    !catalogExhausted &&
    catalogItems.length < (catalogTotal || catalogQuery.data?.total || catalogItems.length);
  const hasMoreCatalog = canLoadMoreCatalog && !catalogQuery.isFetching;
  const loadingMoreCatalog = canLoadMoreCatalog && catalogPage > 1 && catalogQuery.isFetching;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMoreCatalog) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setCatalogPage((current) => current + 1);
            break;
          }
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreCatalog]);

  const refreshing = refreshMutation.isPending;
  const installedLoading = installedQuery.isLoading;
  const catalogLoading = catalogItems.length === 0 && catalogQuery.isLoading;
  const initialLoading = installedLoading || catalogLoading;

  const handleInstall = useCallback(
    (catalogItemId: string) => {
      if (installingSkillId !== null) return;
      const item = catalogItems.find((it) => it.id === catalogItemId);
      if (!item) return;
      installMutation.mutate(item);
    },
    [catalogItems, installMutation, installingSkillId],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      resetCatalogPagination();
      setSearch(value);
    },
    [resetCatalogPagination],
  );

  const handleCategoryChange = useCallback(
    (category: string) => {
      if (category === selectedCategory) return;
      resetCatalogPagination();
      setSelectedCategory(category);
    },
    [resetCatalogPagination, selectedCategory],
  );

  const handleCatalogSortChange = useCallback(
    (sortBy: CatalogSortBy) => {
      if (sortBy === catalogSortBy) return;
      resetCatalogPagination();
      setCatalogSortBy(sortBy);
    },
    [catalogSortBy, resetCatalogPagination],
  );

  const handleUninstall = useCallback(
    (skillName: string) => {
      if (uninstallingSkillName !== null) return;
      const skill = installedQuery.data?.skills.find((s) => s.name === skillName);
      if (!skill) return;
      uninstallMutation.mutate(skill);
    },
    [installedQuery.data, uninstallMutation, uninstallingSkillName],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <header
        className={
          embedded
            ? "hidden"
            : "drag-region flex min-h-[52px] shrink-0 items-center justify-end gap-3 border-b border-border/60 px-8 py-3 wco:min-h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]"
        }
      >
        <Button
          size="xs"
          variant="ghost"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshing}
        >
          <RefreshCcwIcon className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />
          {t("skills.refresh")}
        </Button>
        <div className="relative w-[260px]">
          <SearchIcon className="absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={t("skills.search")}
            className="h-8 ps-7 text-sm"
          />
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div
          className={
            embedded ? "mx-auto w-full max-w-5xl px-6 py-6" : "mx-auto w-full max-w-5xl px-8 py-10"
          }
        >
          {!embedded ? (
            <div>
              <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
                能力市场
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                从 SkillHub 安装技能，并管理本机可用能力。
                <a
                  href="https://skillhub.cn/skills"
                  target="_blank"
                  rel="noreferrer"
                  className="ms-1 text-primary hover:underline"
                >
                  {t("skills.learnMore")}
                </a>
              </p>
            </div>
          ) : null}

          {initialLoading ? (
            <div
              className="mt-8 flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Spinner className="size-4" />
              <span>{t("skills.loading")}</span>
            </div>
          ) : null}

          {view === "all" ? (
            <section className="mt-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[13px] font-medium text-muted-foreground">
                    {selectedCategory === "all"
                      ? "SkillHub 全部技能"
                      : (categories.find((category) => category.key === selectedCategory)?.name ??
                        "SkillHub 分类")}
                  </h2>
                  {catalogTotal || catalogQuery.data?.total ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {catalogTotal || catalogQuery.data?.total} 个远程技能
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
                  <div
                    className="flex h-8 shrink-0 items-center rounded-md border border-border/70 bg-background p-0.5"
                    aria-label="技能排序"
                  >
                    {CATALOG_SORT_OPTIONS.map((option) => {
                      const SortIcon = option.icon;
                      const active = catalogSortBy === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={
                            active
                              ? "inline-flex h-7 items-center gap-1.5 rounded-[5px] bg-muted px-2 text-[11px] font-medium text-foreground"
                              : "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[11px] text-muted-foreground hover:text-foreground"
                          }
                          onClick={() => handleCatalogSortChange(option.value)}
                        >
                          <SortIcon className="size-3" />
                          <span className="hidden sm:inline">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title={t("skills.refresh")}
                    aria-label={t("skills.refresh")}
                    onClick={() => refreshMutation.mutate()}
                    disabled={refreshing}
                  >
                    <RefreshCcwIcon className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />
                  </Button>
                  <div className="relative w-[240px]">
                    <SearchIcon className="absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => handleSearchChange(event.target.value)}
                      placeholder={t("skills.search")}
                      className="h-8 ps-7 text-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 [-webkit-app-region:no-drag]">
                <button
                  type="button"
                  className={
                    selectedCategory === "all"
                      ? "shrink-0 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background"
                      : "shrink-0 rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  }
                  onClick={() => handleCategoryChange("all")}
                >
                  全部
                </button>
                {categories.length === 0 ? (
                  <span className="shrink-0 px-1 py-1.5 text-xs text-muted-foreground">
                    正在等待 SkillHub 分类数据
                  </span>
                ) : (
                  categories.map((category) => (
                    <button
                      key={category.key}
                      type="button"
                      className={
                        selectedCategory === category.key
                          ? "shrink-0 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background"
                          : "shrink-0 rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                      }
                      onClick={() => handleCategoryChange(category.key)}
                    >
                      {category.name}
                      {category.count !== undefined ? (
                        <span className="ms-1 opacity-70">{category.count}</span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {view === "installed" ? (
            <section className={embedded ? "mt-2" : "mt-8"}>
              <h2 className="text-[13px] font-medium text-muted-foreground">
                {t("skills.installed")}
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {installedLoading ? (
                  <>
                    <SkillCardSkeleton />
                    <SkillCardSkeleton />
                  </>
                ) : filteredInstalled.length === 0 ? (
                  <div className="col-span-full px-3 py-6 text-sm text-muted-foreground">
                    {t("skills.empty")}
                  </div>
                ) : (
                  filteredInstalled.map((skill) => (
                    <SkillCard
                      key={skill.name}
                      icon={
                        <SkillIcon
                          iconUrl={getSkillIconUrl(skill)}
                          fallbackName={skill.displayName ?? skill.name}
                        />
                      }
                      title={skill.displayName ?? skill.name}
                      {...((skill.shortDescription ?? skill.description)
                        ? { subtitle: skill.shortDescription ?? skill.description }
                        : {})}
                      action={
                        uninstallingSkillName === skill.name ? (
                          <Loader2Icon
                            className="size-4 animate-spin text-muted-foreground/80"
                            aria-hidden
                          />
                        ) : (
                          <CheckIcon className="size-4 text-muted-foreground/80" aria-hidden />
                        )
                      }
                      onClick={() => setActiveSkill({ kind: "installed", data: skill })}
                    />
                  ))
                )}
              </div>
            </section>
          ) : null}

          {view === "all" ? (
            <section className="mt-4">
              <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {catalogLoading ? (
                  <>
                    <SkillCardSkeleton />
                    <SkillCardSkeleton />
                    <SkillCardSkeleton />
                    <SkillCardSkeleton />
                  </>
                ) : filteredCatalog.length === 0 ? (
                  <div className="col-span-full flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                    <PackageIcon className="size-4" />
                    {t("skills.empty")}
                  </div>
                ) : (
                  filteredCatalog.map((item) => (
                    <SkillCard
                      key={item.id}
                      icon={
                        <SkillIcon
                          iconUrl={getSkillIconUrl(item)}
                          fallbackName={item.displayName}
                        />
                      }
                      title={item.displayName}
                      {...((item.shortDescription ?? item.description)
                        ? { subtitle: item.shortDescription ?? item.description }
                        : {})}
                      meta={<CatalogMetaRow item={item} />}
                      action={
                        installingSkillId === item.id ? (
                          <Loader2Icon
                            className="size-4 animate-spin text-muted-foreground/80"
                            aria-hidden
                          />
                        ) : (
                          <PlusIcon className="size-4 text-muted-foreground/80" aria-hidden />
                        )
                      }
                      onClick={() => setActiveSkill({ kind: "catalog", data: item })}
                    />
                  ))
                )}
              </div>
              {canLoadMoreCatalog ? (
                <div
                  ref={sentinelRef}
                  className="mt-3 flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {loadingMoreCatalog ? (
                    <>
                      <Loader2Icon className="size-3.5 animate-spin" />
                      <span>{t("skills.loadMore")}</span>
                    </>
                  ) : (
                    <span>继续向下滚动加载更多</span>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          {view === "sources" ? (
            <section className="mt-2">
              <h2 className="text-[13px] font-medium text-muted-foreground">来源</h2>
              <div className="mt-3 grid gap-2">
                <div className="rounded-md border border-border/70 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-medium text-foreground">SkillHub</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        默认远程技能源，安装时通过 ZIP 下载并由本地服务校验。
                      </div>
                    </div>
                    <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      已启用
                    </span>
                  </div>
                  {catalogQuery.data?.categories.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {catalogQuery.data.categories.slice(0, 16).map((category) => (
                        <span
                          key={category.key}
                          className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                        >
                          {category.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-md border border-border/70 px-3 py-3">
                  <div className="text-[13px] font-medium text-foreground">T3 内置技能</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    来自随客户端分发的 extensions/skills，本地扫描，不依赖远程源。
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </ScrollArea>

      <SkillDetailDialog
        open={activeSkill !== null}
        target={activeSkill}
        installing={activeSkill?.kind === "catalog" && activeSkill.data.id === installingSkillId}
        uninstalling={
          activeSkill?.kind === "installed" && activeSkill.data.name === uninstallingSkillName
        }
        onClose={() => setActiveSkill(null)}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
      />
    </div>
  );
}
