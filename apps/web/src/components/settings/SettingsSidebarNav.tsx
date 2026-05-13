import { useCallback, type ComponentType } from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  GitBranchIcon,
  KeyboardIcon,
  Link2Icon,
  Settings2Icon,
} from "lucide-react";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "../ui/sidebar";
import { useI18n } from "../../i18n";

export type SettingsSectionPath =
  | "/settings/general"
  | "/settings/keybindings"
  | "/settings/source-control"
  | "/settings/connections"
  | "/settings/archived";

export const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  labelKey:
    | "settings.general"
    | "settings.nav.keybindings"
    | "settings.nav.sourceControl"
    | "settings.nav.connections"
    | "settings.nav.archive";
  to: SettingsSectionPath;
  icon: ComponentType<{ className?: string }>;
}> = [
  { labelKey: "settings.general", to: "/settings/general", icon: Settings2Icon },
  { labelKey: "settings.nav.keybindings", to: "/settings/keybindings", icon: KeyboardIcon },
  { labelKey: "settings.nav.sourceControl", to: "/settings/source-control", icon: GitBranchIcon },
  { labelKey: "settings.nav.connections", to: "/settings/connections", icon: Link2Icon },
  { labelKey: "settings.nav.archive", to: "/settings/archived", icon: ArchiveIcon },
];

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();
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

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="px-2 py-3">
          <SidebarMenu>
            {SETTINGS_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={isActive}
                    className={
                      isActive
                        ? "gap-2.5 px-2.5 py-2 text-left text-[13px] font-medium text-foreground"
                        : "gap-2.5 px-2.5 py-2 text-left text-[13px] text-muted-foreground/70 hover:text-foreground/80"
                    }
                    onClick={() => handleSectionClick(item.to)}
                  >
                    <Icon
                      className={
                        isActive
                          ? "size-4 shrink-0 text-foreground"
                          : "size-4 shrink-0 text-muted-foreground/60"
                      }
                    />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              className="gap-2 px-2 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={handleBackClick}
            >
              <ArrowLeftIcon className="size-4" />
              <span>{t("settings.nav.back")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
