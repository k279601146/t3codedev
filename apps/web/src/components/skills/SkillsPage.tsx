import { type SkillCatalogItem, type InstalledSkill } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  Loader2Icon,
  PackageIcon,
  PlusIcon,
  RefreshCcwIcon,
  SearchIcon,
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

import { SkillDetailDialog } from "./SkillDetailDialog";

const SKILLS_LIST_QUERY = ["skills", "list"] as const;
const SKILLS_CATALOG_QUERY = ["skills", "catalog"] as const;
const CATALOG_PAGE_SIZE = 20;

function getSkillsClient() {
  return getPrimaryEnvironmentConnection().client.skills;
}

function getSkillIconUrl(skill: { iconSmallUrl?: string; iconLargeUrl?: string }): string | null {
  return skill.iconSmallUrl ?? skill.iconLargeUrl ?? null;
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
  readonly action: React.ReactNode;
  readonly onClick: () => void;
}

const SkillCard = memo(function SkillCard({
  icon,
  title,
  subtitle,
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
      className="size-8 object-contain"
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

export function SkillsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeSkill, setActiveSkill] = useState<
    { kind: "installed"; data: InstalledSkill } | { kind: "catalog"; data: SkillCatalogItem } | null
  >(null);
  const [catalogVisibleCount, setCatalogVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [uninstallingSkillName, setUninstallingSkillName] = useState<string | null>(null);

  const installedQuery = useQuery({
    queryKey: SKILLS_LIST_QUERY,
    queryFn: () => getSkillsClient().list(),
    staleTime: 30_000,
  });

  const catalogQuery = useQuery({
    queryKey: SKILLS_CATALOG_QUERY,
    queryFn: () => getSkillsClient().catalog(),
    staleTime: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => getSkillsClient().refresh({ force: true }),
    onSuccess: () => {
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

      const previousInstalled = queryClient.getQueryData<{ skills: InstalledSkill[] }>(SKILLS_LIST_QUERY);
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

      const previousInstalled = queryClient.getQueryData<{ skills: InstalledSkill[] }>(SKILLS_LIST_QUERY);

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
    const query = search.trim().toLowerCase();
    const items = (catalogQuery.data?.items ?? []).filter(
      (item) => !installedNames.has(item.name.toLowerCase()),
    );
    if (!query) return items;
    return items.filter((item) =>
      [item.name, item.displayName, item.description, item.shortDescription]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [catalogQuery.data, installedNames, search]);

  useEffect(() => {
    setCatalogVisibleCount(CATALOG_PAGE_SIZE);
  }, [search, catalogQuery.data]);

  const visibleCatalog = useMemo(
    () => filteredCatalog.slice(0, catalogVisibleCount),
    [filteredCatalog, catalogVisibleCount],
  );

  const hasMoreCatalog = visibleCatalog.length < filteredCatalog.length;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMoreCatalog) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setCatalogVisibleCount((current) =>
              Math.min(current + CATALOG_PAGE_SIZE, filteredCatalog.length),
            );
            break;
          }
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreCatalog, filteredCatalog.length]);

  const refreshing = refreshMutation.isPending;
  const installedLoading = installedQuery.isLoading;
  const catalogLoading = catalogQuery.isLoading;
  const initialLoading = installedLoading || catalogLoading;

  const handleInstall = useCallback(
    (catalogItemId: string) => {
      if (installingSkillId !== null) return;
      const item = catalogQuery.data?.items.find((it) => it.id === catalogItemId);
      if (!item) return;
      installMutation.mutate(item);
    },
    [catalogQuery.data, installMutation, installingSkillId],
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
      <header className="flex items-center justify-end gap-3 border-b border-border/60 px-8 py-3">
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
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("skills.search")}
            className="h-8 ps-7 text-sm"
          />
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="mx-auto w-full max-w-5xl px-8 py-10">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
              {t("skills.title")}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t("skills.subtitle")}
              <a
                href="https://platform.openai.com/docs/codex/concepts/skills"
                target="_blank"
                rel="noreferrer"
                className="ms-1 text-primary hover:underline"
              >
                {t("skills.learnMore")}
              </a>
            </p>
          </div>

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

          <section className="mt-8">
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

          <section className="mt-10">
            <h2 className="text-[13px] font-medium text-muted-foreground">
              {t("skills.recommended")}
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {catalogLoading ? (
                <>
                  <SkillCardSkeleton />
                  <SkillCardSkeleton />
                  <SkillCardSkeleton />
                  <SkillCardSkeleton />
                </>
              ) : visibleCatalog.length === 0 ? (
                <div className="col-span-full flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <PackageIcon className="size-4" />
                  {t("skills.empty")}
                </div>
              ) : (
                visibleCatalog.map((item) => (
                  <SkillCard
                    key={item.id}
                    icon={
                      <SkillIcon iconUrl={getSkillIconUrl(item)} fallbackName={item.displayName} />
                    }
                    title={item.displayName}
                    {...((item.shortDescription ?? item.description)
                      ? { subtitle: item.shortDescription ?? item.description }
                      : {})}
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
            {hasMoreCatalog ? (
              <div
                ref={sentinelRef}
                className="mt-3 flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <Loader2Icon className="size-3.5 animate-spin" />
                <span>{t("skills.loadMore")}</span>
              </div>
            ) : null}
          </section>
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
