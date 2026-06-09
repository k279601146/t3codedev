import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRightIcon,
  BotIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  FileBarChartIcon,
  FileTextIcon,
  Grid3X3Icon,
  HeadphonesIcon,
  ImageIcon,
  ImportIcon,
  LaptopIcon,
  LayoutTemplateIcon,
  LightbulbIcon,
  LineChartIcon,
  MonitorIcon,
  PlusIcon,
  PresentationIcon,
  RefreshCcwIcon,
  SearchIcon,
  SparklesIcon,
  VideoIcon,
  Wand2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";

export type LauncherModeId =
  | "general"
  | "slides"
  | "website"
  | "desktop"
  | "design"
  | "video"
  | "app"
  | "schedule"
  | "research"
  | "spreadsheet"
  | "visualization"
  | "audio"
  | "chat"
  | "playbook";

type StarterCard = {
  title: string;
  desc?: string;
  image?: string;
  icon?: LucideIcon;
};

const LAUNCHER_MODES: Array<{ id: LauncherModeId; label: string; icon: LucideIcon }> = [
  { id: "slides", label: "制作幻灯片", icon: PresentationIcon },
  { id: "website", label: "创建网站", icon: FileTextIcon },
  { id: "desktop", label: "开发桌面应用", icon: LaptopIcon },
  { id: "design", label: "设计", icon: Wand2Icon },
];

const MORE_MODES: Array<{ id: LauncherModeId; label: string; icon: LucideIcon }> = [
  { id: "video", label: "视频", icon: VideoIcon },
  { id: "app", label: "开发应用", icon: MonitorIcon },
  { id: "schedule", label: "定时任务", icon: CalendarDaysIcon },
  { id: "research", label: "Wide Research", icon: SearchIcon },
  { id: "spreadsheet", label: "电子表格", icon: Grid3X3Icon },
  { id: "visualization", label: "可视化", icon: FileBarChartIcon },
  { id: "audio", label: "音频", icon: HeadphonesIcon },
  { id: "chat", label: "Chat 模式", icon: BotIcon },
  { id: "playbook", label: "Playbook", icon: ClipboardListIcon },
];

const MODE_LABELS: Record<LauncherModeId, string> = {
  general: "通用任务",
  slides: "制作幻灯片",
  website: "创建网站",
  desktop: "开发桌面应用",
  design: "设计",
  video: "视频",
  app: "开发应用",
  schedule: "定时任务",
  research: "Wide Research",
  spreadsheet: "电子表格",
  visualization: "可视化",
  audio: "音频",
  chat: "Chat 模式",
  playbook: "Playbook",
};

export const MODE_PLACEHOLDERS: Record<LauncherModeId, string> = {
  general: "随心输入",
  slides: "描述你的演示文稿主题",
  website: "描述你想创建的网站",
  desktop: "描述你想开发的桌面应用",
  design: "描述你想要生成的图像",
  video: "描述你想制作的视频",
  app: "描述你想开发的应用",
  schedule: "描述你希望我定时执行的操作，例如每天早上8点发送市场简报",
  research: "描述你想深入研究的问题",
  spreadsheet: "上传一个电子表格进行分析，或者从零开始创建一个",
  visualization: "描述你想分析和可视化的数据",
  audio: "描述你想生成或处理的音频",
  chat: "直接开始一次对话",
  playbook: "描述你想沉淀成流程的工作",
};

const DESIGN_CARDS: StarterCard[] = [
  {
    title: "制作咖啡趋势的数据信息图",
    desc: "将关于全球咖啡消费趋势文章中的关键数据转换为便于社交媒体分享的信息图。",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/E2ZI4bnxDESWD9fE.png?x-oss-process=image/resize,w_224,m_lfit/format,webp",
  },
  {
    title: "设计日式餐厅菜单布局",
    desc: "为高端日式餐厅设计菜单，体现 Sakura Omakase 的优雅和留白。",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/AS2Aiol4oZeDVekX.png?x-oss-process=image/resize,w_224,m_lfit/format,webp",
  },
  {
    title: "设计智能手环及包装",
    desc: "为健康监测智能手环设计产品概念图和包装视觉。",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/C6EDJVYTLZ9SUpda.jpg?x-oss-process=image/resize,w_224,m_lfit/format,webp",
  },
  {
    title: "设计 SaaS 产品发布海报套装",
    desc: "为项目管理 SaaS 工具设计一组产品发布宣传海报。",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/1gIDh9E7dR8JggPO.png?x-oss-process=image/resize,w_224,m_lfit/format,webp",
  },
  {
    title: "设计互动科技博览会展台",
    desc: "为人工智能公司设计科技展览展台，突出开放布局和演示区域。",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/rL3xPANkxcCTGGb9.png?x-oss-process=image/resize,w_224,m_lfit/format,webp",
  },
  {
    title: "设计现代咖啡品牌标识",
    desc: "为精品咖啡品牌 Urban Bloom Roasters 设计现代化视觉标识。",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/1Kb0Wpp7MJWqvDsw.jpg?x-oss-process=image/resize,w_224,m_lfit/format,webp",
  },
];

const GENERAL_PROMPTS: StarterCard[] = [
  { title: "整理本周客户反馈并给出优先级", icon: SparklesIcon },
  { title: "把一个模糊想法拆成可执行项目计划", icon: LayoutTemplateIcon },
  { title: "研究竞争对手最近的产品更新", icon: FileBarChartIcon },
  { title: "生成一份面向团队的状态报告", icon: PresentationIcon },
  { title: "把会议记录整理成行动项和负责人", icon: CalendarDaysIcon },
  { title: "创建一个用于演示的落地页草案", icon: Wand2Icon },
];

const SPREADSHEET_PROMPTS = [
  "创建带公式的折现现金流模型",
  "通过每日记录追踪个人财务",
  "分析北美天然气 IMF 数据",
  "编制 2025 年北美 AI 会议日历",
  "优雅地跟踪项目生命周期中的任务",
];

const SCHEDULE_PROMPTS: StarterCard[] = [
  { title: "监控每日竞品新闻更新", icon: RefreshCcwIcon },
  { title: "生成每周股票投资组合报告", icon: FileBarChartIcon },
  { title: "整理每周行业趋势摘要", icon: LineChartIcon },
  { title: "跟踪每日社交媒体提及", icon: SparklesIcon },
  { title: "扫描每周监管政策更新", icon: CalendarDaysIcon },
  { title: "生成每周就业市场报告", icon: LineChartIcon },
];

const SLIDE_PROMPTS = [
  "设计带预测数据的投资者推介材料",
  "创建战略商业回顾演示文稿",
  "研究产品发布的市场机会",
  "自动化每周团队状态报告",
];

const SLIDE_TEMPLATES: StarterCard[] = [
  {
    title: "刻印",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/Rj5QxJUkkxDAWQQo.png?x-oss-process=image/resize,w_272,m_lfit/format,webp",
  },
  {
    title: "刊物",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/AS2Aiol4oZeDVekX.png?x-oss-process=image/resize,w_272,m_lfit/format,webp",
  },
  {
    title: "像素",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/1YShOwNjzNMwVxEl.png?x-oss-process=image/resize,w_272,m_lfit/format,webp",
  },
  {
    title: "皮纸",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/C6EDJVYTLZ9SUpda.jpg?x-oss-process=image/resize,w_272,m_lfit/format,webp",
  },
  {
    title: "卷宗",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/3bKSHJi2otnPHzV4.jpg?x-oss-process=image/resize,w_272,m_lfit/format,webp",
  },
  {
    title: "白板",
    image:
      "https://xla-persist.xingliu.art/artifacts/agent/1Kb0Wpp7MJWqvDsw.jpg?x-oss-process=image/resize,w_272,m_lfit/format,webp",
  },
];

const DEFAULT_TITLES = [
  "我能为你做什么？",
  "今天想推进哪件事？",
  "把想法交给我来处理",
  "从一个任务开始",
];

const MODE_TITLES: Record<LauncherModeId, string> = {
  general: "我能为你做什么？",
  slides: "想做一份怎样的演示？",
  website: "想创建什么样的网站？",
  desktop: "想开发什么桌面应用？",
  design: "想生成什么视觉内容？",
  video: "想制作什么视频？",
  app: "想开发什么应用？",
  schedule: "要我定期帮你做什么？",
  research: "想深入研究什么问题？",
  spreadsheet: "要分析或创建什么数据？",
  visualization: "想把什么数据可视化？",
  audio: "想处理或生成什么音频？",
  chat: "想聊点什么？",
  playbook: "想沉淀哪套流程？",
};

const IDLE_SUGGESTION_POOL = [
  "整理最近的客户反馈，并提炼出优先级和下一步行动。",
  "研究一个竞品最近的产品更新，并总结值得借鉴的变化。",
  "生成一份团队周报或项目状态报告。",
  "把一个模糊想法拆成可执行的项目计划。",
  "创建一份产品介绍幻灯片大纲。",
  "分析一份表格并找出关键趋势。",
  "为一个新功能设计落地页文案。",
  "定期追踪行业新闻并生成摘要。",
  "把会议记录整理成待办事项和负责人。",
  "比较两个方案的优劣并给出决策建议。",
  "为一次产品发布准备传播计划。",
  "生成一份用户调研访谈提纲。",
  "梳理一个功能的 PRD 初稿。",
  "把长文档总结成一页执行摘要。",
  "设计一组社交媒体宣传图的创意方向。",
  "创建一份预算规划表并列出关键公式。",
  "分析销售漏斗数据并找出转化瓶颈。",
  "为招聘岗位生成面试问题清单。",
  "把学习目标拆成一周行动计划。",
  "生成一份面向管理层的简报提纲。",
];

export function getLauncherModeLabel(mode: LauncherModeId) {
  return MODE_LABELS[mode] || MODE_LABELS.general;
}

export function NewThreadLauncherView({
  mode,
  isComposerEmpty,
  projectName,
  composer,
  footer,
  onModeChange,
  onSubmitPreset,
}: {
  mode: LauncherModeId;
  isComposerEmpty: boolean;
  projectName?: string | undefined;
  composer: ReactNode;
  footer: ReactNode;
  onModeChange: (mode: LauncherModeId) => void;
  onSubmitPreset: (prompt: string, mode?: LauncherModeId) => void;
}) {
  const title = useLauncherTitle(mode, isComposerEmpty, projectName);
  const showIdleSuggestions = useIdleSuggestionsVisibility(mode, isComposerEmpty);
  const [isIdleSuggestionsDismissed, setIsIdleSuggestionsDismissed] = useState(false);

  useEffect(() => {
    if (mode !== "general" || !isComposerEmpty) {
      setIsIdleSuggestionsDismissed(false);
    }
  }, [isComposerEmpty, mode]);

  const shouldShowIdleSuggestions = showIdleSuggestions && !isIdleSuggestionsDismissed;

  return (
    <main
      className={cn(
        "flex min-h-0 flex-1 flex-col px-4 sm:px-6",
        mode === "general" ? "overflow-hidden" : "overflow-y-auto",
      )}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[48rem] flex-col items-center">
        <div className="flex min-h-full w-full flex-col items-center justify-center">
          <h1 className="mb-10 min-h-[40px] text-center font-sans text-[28px] font-normal leading-tight text-foreground sm:text-[30px]">
            <span key={title.key} className="block animate-in fade-in duration-500">
              {title.node}
            </span>
          </h1>

          <div className="w-full">
            <div className="relative isolate">{composer}</div>
            {footer}
          </div>

          {shouldShowIdleSuggestions ? (
            <IdleSuggestionsPanel
              onClose={() => setIsIdleSuggestionsDismissed(true)}
              onSubmitPreset={onSubmitPreset}
            />
          ) : (
            <LauncherModeBar activeMode={mode} onModeChange={onModeChange} />
          )}
        </div>

        {!shouldShowIdleSuggestions && mode !== "general" ? (
          <div
            key={mode}
            className="mt-7 w-full animate-in fade-in slide-in-from-bottom-2 duration-300"
          >
            <ModeRecommendations mode={mode} onSubmitPreset={onSubmitPreset} />
          </div>
        ) : null}
      </div>
    </main>
  );
}

function useLauncherTitle(
  mode: LauncherModeId,
  isComposerEmpty: boolean,
  projectName?: string | undefined,
): { key: string; node: ReactNode } {
  const [defaultTitleIndex, setDefaultTitleIndex] = useState(0);
  const shouldRotate = mode === "general" && isComposerEmpty && !projectName;

  useEffect(() => {
    if (!shouldRotate) return;
    const timer = window.setInterval(() => {
      setDefaultTitleIndex((index) => (index + 1) % DEFAULT_TITLES.length);
    }, 25000);
    return () => window.clearInterval(timer);
  }, [shouldRotate]);

  if (mode !== "general") return { key: mode, node: MODE_TITLES[mode] };
  if (projectName && isComposerEmpty) {
    return {
      key: `project:${projectName}`,
      node: (
        <>
          我们应该在 <span className="font-normal">{projectName}</span> 中构建什么？
        </>
      ),
    };
  }
  const fallbackTitle = DEFAULT_TITLES[0] ?? "我能为你做什么？";
  if (!isComposerEmpty) return { key: fallbackTitle, node: fallbackTitle };
  const title = DEFAULT_TITLES[defaultTitleIndex] ?? fallbackTitle;
  return { key: title, node: title };
}

function useIdleSuggestionsVisibility(mode: LauncherModeId, isComposerEmpty: boolean) {
  const [isVisible, setIsVisible] = useState(false);
  const isEligible = mode === "general" && isComposerEmpty;

  useEffect(() => {
    if (!isEligible) {
      setIsVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setIsVisible(true), 45000);
    return () => window.clearTimeout(timer);
  }, [isEligible]);

  return isVisible;
}

function IdleSuggestionsPanel({
  onClose,
  onSubmitPreset,
}: {
  onClose: () => void;
  onSubmitPreset: (prompt: string, mode?: LauncherModeId) => void;
}) {
  const suggestions = useMemo(() => getRandomIdleSuggestions(5), []);

  return (
    <section className="mt-4 w-full animate-in fade-in slide-in-from-top-1 px-3 duration-300 sm:px-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">以下是您可以让我做的事情:</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭建议"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 divide-y divide-border">
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSubmitPreset(suggestion, "general")}
            className="flex min-h-10 w-full animate-in items-center gap-2 py-2 text-left text-[14px] text-muted-foreground fade-in slide-in-from-bottom-1 transition-colors duration-300 hover:text-[#147DFF]"
            style={{ animationDelay: `${index * 45}ms`, animationFillMode: "both" }}
          >
            <LightbulbIcon className="h-4 w-4 shrink-0 text-muted-foreground/70" />
            <span>{suggestion}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function getRandomIdleSuggestions(count: number) {
  return [...IDLE_SUGGESTION_POOL].sort(() => Math.random() - 0.5).slice(0, count);
}

function LauncherModeBar({
  activeMode,
  onModeChange,
}: {
  activeMode: LauncherModeId;
  onModeChange: (mode: LauncherModeId) => void;
}) {
  return (
    <div className="mt-5 flex w-full flex-wrap items-center justify-center gap-2">
      {LAUNCHER_MODES.map((item) => (
        <LauncherModeChip
          key={item.id}
          mode={item.id}
          activeMode={activeMode}
          onModeChange={onModeChange}
          label={item.label}
          icon={item.icon}
        />
      ))}
      <LauncherMoreModesMenu activeMode={activeMode} onModeChange={onModeChange} />
    </div>
  );
}

function LauncherModeChip({
  mode,
  activeMode,
  onModeChange,
  label,
  icon: Icon,
}: {
  mode: LauncherModeId;
  activeMode: LauncherModeId;
  onModeChange: (mode: LauncherModeId) => void;
  label: string;
  icon: LucideIcon;
}) {
  const active = activeMode === mode;
  return (
    <button
      type="button"
      onClick={() => onModeChange(active ? "general" : mode)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
        active
          ? "border-[#147DFF] bg-[#EAF5FF] text-[#147DFF] dark:bg-[#147DFF]/10"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function LauncherMoreModesMenu({
  activeMode,
  onModeChange,
}: {
  activeMode: LauncherModeId;
  onModeChange: (mode: LauncherModeId) => void;
}) {
  const activeModeConfig = MORE_MODES.find((item) => item.id === activeMode);
  const active = Boolean(activeModeConfig);
  const ActiveIcon = activeModeConfig?.icon;

  return (
    <div className="group/more relative">
      <button
        type="button"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
          active
            ? "border-[#147DFF] bg-[#EAF5FF] text-[#147DFF] dark:bg-[#147DFF]/10"
            : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {activeModeConfig ? (
          <>
            {ActiveIcon ? <ActiveIcon className="h-3.5 w-3.5" /> : null}
            {activeModeConfig.label}
          </>
        ) : (
          <>
            <PlusIcon className="h-3.5 w-3.5" />
            更多
          </>
        )}
        <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
      </button>
      <div className="invisible absolute left-1/2 top-full z-40 mt-2 w-[220px] -translate-x-1/2 opacity-0 transition-all duration-150 group-hover/more:visible group-hover/more:opacity-100">
        <div className="overflow-hidden rounded-[10px] border border-border bg-popover p-1 shadow-lg">
          {MORE_MODES.map((item) => {
            const Icon = item.icon;
            const selected = activeMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onModeChange(item.id)}
                className={cn(
                  "flex h-9 w-full items-center justify-between rounded-[7px] px-3 text-left text-[13px] transition-colors",
                  selected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {selected ? <span className="h-1.5 w-1.5 rounded-full bg-[#147DFF]" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ModeRecommendations({
  mode,
  onSubmitPreset,
}: {
  mode: LauncherModeId;
  onSubmitPreset: (prompt: string, mode?: LauncherModeId) => void;
}) {
  if (mode === "design") {
    return (
      <section className="w-full">
        <SectionTitle>开始使用</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          {DESIGN_CARDS.map((card, index) => (
            <ImagePromptCard
              key={card.title}
              card={card}
              index={index}
              onClick={() => onSubmitPreset(card.title, "design")}
            />
          ))}
        </div>
      </section>
    );
  }

  if (mode === "spreadsheet") {
    return (
      <section className="mx-auto w-full max-w-[760px]">
        <div className="flex flex-col divide-y divide-border">
          {SPREADSHEET_PROMPTS.map((prompt, index) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSubmitPreset(prompt, "spreadsheet")}
              className="flex h-10 animate-in items-center justify-between text-left text-[14px] text-foreground fade-in slide-in-from-bottom-1 transition-colors duration-300 hover:text-[#147DFF]"
              style={{ animationDelay: `${index * 55}ms`, animationFillMode: "both" }}
            >
              <span>{prompt}</span>
              <ArrowUpRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (mode === "slides") {
    return (
      <section className="mx-auto w-full max-w-[744px]">
        <SectionTitle>示例提示词</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SLIDE_PROMPTS.map((prompt, index) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSubmitPreset(prompt, "slides")}
              className="flex min-h-[82px] animate-in flex-col justify-between rounded-[10px] border border-border bg-background p-3 text-left text-[13px] leading-5 text-foreground fade-in slide-in-from-bottom-2 transition-colors duration-300 hover:bg-accent"
              style={{ animationDelay: `${index * 55}ms`, animationFillMode: "both" }}
            >
              <span>{prompt}</span>
              <ArrowUpRightIcon className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-between">
          <SectionTitle className="mb-0">选择模板</SectionTitle>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-border px-3 text-[13px] text-muted-foreground"
          >
            <LayoutTemplateIcon className="h-4 w-4" />8 - 12
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          <button
            type="button"
            className="flex aspect-[16/9] items-center justify-center rounded-[10px] border border-border bg-background text-[13px] text-muted-foreground transition-colors hover:bg-accent"
          >
            <ImportIcon className="mr-2 h-4 w-4" />
            导入模板
          </button>
          {SLIDE_TEMPLATES.map((template, index) => (
            <button
              key={template.title}
              type="button"
              onClick={() => onSubmitPreset(`使用${template.title}模板制作演示文稿`, "slides")}
              className="group animate-in text-left fade-in slide-in-from-bottom-2 duration-300"
              style={{ animationDelay: `${(index + 1) * 55}ms`, animationFillMode: "both" }}
            >
              <span className="block aspect-[16/9] overflow-hidden rounded-[10px] border border-border bg-muted">
                {template.image ? (
                  <img
                    src={template.image}
                    alt={template.title}
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                ) : null}
              </span>
              <span className="mt-2 block text-center text-[13px] text-foreground">
                {template.title} <span className="text-muted-foreground">•</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (mode === "schedule") {
    return (
      <section className="w-full">
        <div className="mb-4 flex items-center justify-between">
          <SectionTitle className="mb-0">开始使用</SectionTitle>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border border-border text-muted-foreground"
            >
              <CalendarDaysIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onSubmitPreset("新建一个定时任务", "schedule")}
              className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-border px-3 text-[14px] font-medium text-foreground"
            >
              <PlusIcon className="h-4 w-4" />
              新建定时任务
            </button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {SCHEDULE_PROMPTS.map((card, index) => (
            <PlainPromptCard
              key={card.title}
              card={card}
              index={index}
              onClick={() => onSubmitPreset(card.title, "schedule")}
            />
          ))}
        </div>
      </section>
    );
  }

  if (mode === "general") {
    return null;
  }

  return (
    <section className="w-full">
      <SectionTitle>{`${getLauncherModeLabel(mode)}建议`}</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {GENERAL_PROMPTS.map((card, index) => {
          const prompt = `${getLauncherModeLabel(mode)}：${card.title}`;
          return (
            <PlainPromptCard
              key={card.title}
              index={index}
              card={{ ...card, title: prompt }}
              onClick={() => onSubmitPreset(prompt, mode)}
            />
          );
        })}
      </div>
    </section>
  );
}

function SectionTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("mb-4 text-[15px] font-semibold text-foreground", className)}>{children}</h2>
  );
}

function PlainPromptCard({
  card,
  onClick,
  index = 0,
}: {
  card: StarterCard;
  onClick: () => void;
  index?: number;
}) {
  const Icon = card.icon || SparklesIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[54px] animate-in items-center justify-between rounded-[10px] border border-border bg-background px-4 py-3 text-left fade-in slide-in-from-bottom-2 transition-colors duration-300 hover:bg-accent"
      style={{ animationDelay: `${index * 55}ms`, animationFillMode: "both" }}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-[14px] text-foreground">{card.title}</span>
      </span>
      <ArrowUpRightIcon className="ml-3 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ImagePromptCard({
  card,
  onClick,
  index = 0,
}: {
  card: StarterCard;
  onClick: () => void;
  index?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-[94px] animate-in overflow-hidden rounded-[12px] border border-border bg-background text-left fade-in slide-in-from-bottom-2 transition-colors duration-300 hover:bg-accent"
      style={{ animationDelay: `${index * 55}ms`, animationFillMode: "both" }}
    >
      <span className="flex min-w-0 flex-1 flex-col justify-center px-4">
        <span className="flex items-center gap-1 text-[14px] font-semibold text-foreground">
          <span className="truncate">{card.title}</span>
          <ArrowUpRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </span>
        {card.desc ? (
          <span className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
            {card.desc}
          </span>
        ) : null}
      </span>
      <span className="relative h-full w-[126px] shrink-0 overflow-hidden bg-muted">
        {card.image ? (
          <img
            src={card.image}
            alt={card.title}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
          />
        ) : (
          <ImageIcon className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />
        )}
      </span>
    </button>
  );
}
