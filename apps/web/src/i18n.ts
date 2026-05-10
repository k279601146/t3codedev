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
