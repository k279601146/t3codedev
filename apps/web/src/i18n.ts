import type { ClientLanguage } from "@t3tools/contracts/settings";
import { useMemo } from "react";

import { useSettings } from "./hooks/useSettings";

type Locale = "en" | "zh-CN";

const TRANSLATIONS = {
  en: {
    "auth.welcome": "Welcome to {appName}",
    "auth.planIncluded": "All IDE plans included",
    "auth.continueWithAccount": "Continue with account",
    "auth.cancelLogin": "Cancel login",
    "auth.otherLogin": "Use another sign-in method",
    "auth.register": "Register",
    "auth.checking": "Checking sign-in status",
    "auth.connecting": "Connecting",
    "auth.connect": "Connect",
    "auth.webAccessToken": "Web access token",
    "auth.failed": "Sign-in failed. Please try again.",
    "sidebar.search": "Search",
    "sidebar.projects": "Projects",
    "sidebar.noProjects": "No projects yet",
    "sidebar.addProject": "Add project",
    "sidebar.settings": "Settings",
    "sidebar.signOut": "Sign out",
    "sidebar.signingOut": "Signing out",
    "sidebar.signOutFailed": "Could not sign out",
    "settings.general": "General",
    "settings.theme": "Theme",
    "settings.themeDescription": "Choose how T3 Code looks across the app.",
    "settings.language": "Language",
    "settings.languageDescription": "System default follows your browser or operating system.",
    "settings.languageSystem": "System",
    "settings.languageEnglish": "English",
    "settings.languageChinese": "简体中文",
    "settings.timeFormat": "Time format",
    "settings.timeFormatDescription": "System default follows your browser or OS clock preference.",
    "settings.restoreDefaults": "Restore defaults",
    "settings.nav.keybindings": "Keybindings",
    "settings.nav.providers": "Providers",
    "settings.nav.sourceControl": "Source Control",
    "settings.nav.connections": "Connections",
    "settings.nav.archive": "Archive",
    "settings.nav.back": "Back",
    "skills.title": "Skills",
    "skills.subtitle": "Give Codex stronger capabilities.",
    "skills.learnMore": "Learn more",
    "skills.refresh": "Refresh",
    "skills.search": "Search skills",
    "skills.installed": "Installed",
    "skills.recommended": "Recommended",
    "skills.empty": "No skills available.",
    "skills.install": "Install",
    "skills.uninstall": "Uninstall",
    "skills.installing": "Installing…",
    "skills.uninstalling": "Uninstalling…",
    "skills.installFailed": "Install failed",
    "skills.uninstallFailed": "Uninstall failed",
    "skills.refreshFailed": "Refresh failed",
    "skills.skill": "Skill",
    "skills.systemTag": "Built-in",
    "skills.userTag": "User",
    "skills.repoTag": "Project",
    "skills.loading": "Loading skills…",
    "skills.installSuccess": "Skill installed",
    "skills.uninstallSuccess": "Skill uninstalled",
    "skills.installSuccessDescription": "{name} is ready to use.",
    "skills.uninstallSuccessDescription": "{name} has been removed.",
    "skills.alreadyInstalled": "Already installed",
    "skills.confirmUninstall": "Remove {name}?",
    "skills.confirmUninstallDescription":
      "The skill will be deleted from your machine. You can reinstall it later from the catalog.",
    "skills.cancel": "Cancel",
    "skills.loadMore": "Loading more…",
  },
  "zh-CN": {
    "auth.welcome": "欢迎使用 {appName}",
    "auth.planIncluded": "所有 IDE 套餐均包含",
    "auth.continueWithAccount": "使用账户继续",
    "auth.cancelLogin": "取消登录",
    "auth.otherLogin": "使用其他方式登录",
    "auth.register": "注册",
    "auth.checking": "正在检查登录状态",
    "auth.connecting": "正在连接",
    "auth.connect": "连接",
    "auth.webAccessToken": "Web 访问令牌",
    "auth.failed": "登录失败，请稍后再试。",
    "sidebar.search": "搜索",
    "sidebar.projects": "项目",
    "sidebar.noProjects": "暂无项目",
    "sidebar.addProject": "添加项目",
    "sidebar.settings": "设置",
    "sidebar.signOut": "退出登录",
    "sidebar.signingOut": "正在退出",
    "sidebar.signOutFailed": "退出登录失败",
    "settings.general": "通用",
    "settings.theme": "主题",
    "settings.themeDescription": "选择 T3 Code 在应用中的显示外观。",
    "settings.language": "语言",
    "settings.languageDescription": "系统默认会跟随浏览器或操作系统语言。",
    "settings.languageSystem": "跟随系统",
    "settings.languageEnglish": "English",
    "settings.languageChinese": "简体中文",
    "settings.timeFormat": "时间格式",
    "settings.timeFormatDescription": "系统默认会跟随浏览器或操作系统时钟偏好。",
    "settings.restoreDefaults": "恢复默认设置",
    "settings.nav.keybindings": "快捷键",
    "settings.nav.providers": "模型服务",
    "settings.nav.sourceControl": "源代码管理",
    "settings.nav.connections": "连接",
    "settings.nav.archive": "归档",
    "settings.nav.back": "返回",
    "skills.title": "技能",
    "skills.subtitle": "赋予 Codex 更强大的能力。",
    "skills.learnMore": "了解更多",
    "skills.refresh": "刷新",
    "skills.search": "搜索技能",
    "skills.installed": "已安装",
    "skills.recommended": "推荐",
    "skills.empty": "暂无技能。",
    "skills.install": "安装",
    "skills.uninstall": "卸载",
    "skills.installing": "正在安装…",
    "skills.uninstalling": "正在卸载…",
    "skills.installFailed": "安装失败",
    "skills.uninstallFailed": "卸载失败",
    "skills.refreshFailed": "刷新失败",
    "skills.skill": "Skill",
    "skills.systemTag": "内置",
    "skills.userTag": "用户",
    "skills.repoTag": "项目",
    "skills.loading": "正在加载技能…",
    "skills.installSuccess": "已安装技能",
    "skills.uninstallSuccess": "已卸载技能",
    "skills.installSuccessDescription": "{name} 已可使用。",
    "skills.uninstallSuccessDescription": "已移除 {name}。",
    "skills.alreadyInstalled": "已经安装",
    "skills.confirmUninstall": "确定要移除 {name} 吗？",
    "skills.confirmUninstallDescription": "该技能将从本机删除，需要时可以再次从市场安装。",
    "skills.cancel": "取消",
    "skills.loadMore": "正在加载更多…",
  },
} as const;

type TranslationKey = keyof (typeof TRANSLATIONS)["en"];

function detectSystemLocale(): Locale {
  const language =
    typeof navigator === "undefined"
      ? ""
      : [navigator.language, ...(navigator.languages ?? [])].join(" ").toLowerCase();
  return language.includes("zh") ? "zh-CN" : "en";
}

export function resolveClientLocale(language: ClientLanguage): Locale {
  return language === "system" ? detectSystemLocale() : language;
}

export function useI18n() {
  const language = useSettings((settings) => settings.language);
  const locale = resolveClientLocale(language);

  return useMemo(() => {
    const messages = TRANSLATIONS[locale];
    const t = (key: TranslationKey, values?: Readonly<Record<string, string | number>>) => {
      let text: string = messages[key] ?? TRANSLATIONS.en[key] ?? key;
      if (!values) {
        return text;
      }
      for (const [name, value] of Object.entries(values)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
      return text;
    };

    return { locale, t };
  }, [locale]);
}
