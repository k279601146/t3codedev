import { useCallback, useMemo, useState, type ComponentType } from "react";
import {
  ActivityIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  BotIcon,
  GitBranchIcon,
  InfoIcon,
  KeyboardIcon,
  Link2Icon,
  SearchIcon,
  Settings2Icon,
} from "lucide-react";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";

import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { useI18n, type TranslationKey } from "../../i18n";

export type SettingsSectionPath =
  | "/settings/general"
  | "/settings/providers"
  | "/settings/keybindings"
  | "/settings/connections"
  | "/settings/source-control"
  | "/settings/about"
  | "/settings/diagnostics"
  | "/settings/archived";

type SettingsNavItem = {
  to: SettingsSectionPath;
  labelKey: TranslationKey;
  icon: ComponentType<{ className?: string }>;
};

type SettingsNavGroup = {
  labelKey: TranslationKey;
  items: ReadonlyArray<SettingsNavItem>;
};

export const SETTINGS_NAV_GROUPS: ReadonlyArray<SettingsNavGroup> = [
  {
    labelKey: "settings.nav.group.basic",
    items: [
      { labelKey: "settings.general", to: "/settings/general", icon: Settings2Icon },
      { labelKey: "settings.nav.providers", to: "/settings/providers", icon: BotIcon },
      { labelKey: "settings.nav.keybindings", to: "/settings/keybindings", icon: KeyboardIcon },
    ],
  },
  {
    labelKey: "settings.nav.group.development",
    items: [
      { labelKey: "settings.nav.connections", to: "/settings/connections", icon: Link2Icon },
      { labelKey: "settings.nav.git", to: "/settings/source-control", icon: GitBranchIcon },
    ],
  },
  {
    labelKey: "settings.nav.group.maintenance",
    items: [
      { labelKey: "settings.nav.about", to: "/settings/about", icon: InfoIcon },
      { labelKey: "settings.diagnostics", to: "/settings/diagnostics", icon: ActivityIcon },
      { labelKey: "settings.nav.archivedThreads", to: "/settings/archived", icon: ArchiveIcon },
    ],
  },
];

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();
  const [search, setSearch] = useState("");
  const handleSectionClick = useCallback(
    (to: SettingsSectionPath) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to, replace: true });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const handleBackClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, isMobile, navigate, setOpenMobile]);
  const searchQuery = search.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!searchQuery) return SETTINGS_NAV_GROUPS;
    return SETTINGS_NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        [t(item.labelKey), t(group.labelKey), item.to]
          .join(" ")
          .toLowerCase()
          .includes(searchQuery),
      ),
    })).filter((group) => group.items.length > 0);
  }, [searchQuery, t]);

  return (
    <>
      <SidebarHeader className="gap-3 px-2 pt-3 pb-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              className="h-7 gap-2 px-2 text-[13px] text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={handleBackClick}
            >
              <ArrowLeftIcon className="size-4" />
              <span>{t("settings.nav.back")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <SidebarInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("settings.nav.search")}
            className="h-8 rounded-lg border-border/70 bg-background/70 ps-8 text-[13px]"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-1 overflow-x-hidden px-0 pb-3">
        {visibleGroups.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            {t("settings.nav.noResults")}
          </div>
        ) : (
          visibleGroups.map((group) => (
            <SidebarGroup key={group.labelKey} className="px-2 py-1">
              <SidebarGroupLabel className="h-6 px-2 text-[12px] font-medium text-muted-foreground/70">
                {t(group.labelKey)}
              </SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.to;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        size="sm"
                        isActive={isActive}
                        className={
                          isActive
                            ? "h-8 gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium text-foreground"
                            : "h-8 gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-foreground/80 hover:bg-accent/55 hover:text-foreground"
                        }
                        onClick={() => handleSectionClick(item.to)}
                      >
                        <Icon
                          className={
                            isActive
                              ? "size-4 shrink-0 text-foreground"
                              : "size-4 shrink-0 text-muted-foreground/70"
                          }
                        />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))
        )}
      </SidebarContent>
    </>
  );
}
