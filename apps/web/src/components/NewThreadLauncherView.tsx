import type { PluginSummary } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRightIcon,
  BotIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  DownloadIcon,
  FileBarChartIcon,
  FileTextIcon,
  Grid3X3Icon,
  HeadphonesIcon,
  ImageIcon,
  ImportIcon,
  LaptopIcon,
  LayoutTemplateIcon,
  LightbulbIcon,
  Loader2Icon,
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
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";

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

type SlidePromptCard = StarterCard & {
  prompt: string;
};

const LAUNCHER_MODES: Array<{ id: LauncherModeId; label: string; icon: LucideIcon }> = [
  { id: "slides", label: "制作幻灯片", icon: PresentationIcon },
  { id: "research", label: "联网调研", icon: SearchIcon },
  { id: "website", label: "创建网站", icon: FileTextIcon },
  { id: "desktop", label: "开发桌面应用", icon: LaptopIcon },
  { id: "design", label: "设计", icon: Wand2Icon },
];

const MORE_MODES: Array<{ id: LauncherModeId; label: string; icon: LucideIcon }> = [
  { id: "video", label: "视频", icon: VideoIcon },
  { id: "app", label: "开发应用", icon: MonitorIcon },
  { id: "schedule", label: "定时任务", icon: CalendarDaysIcon },
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
  research: "联网调研",
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
  research: "描述你想调研的主题、链接或公开资料问题",
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

const SLIDE_PROMPTS: SlidePromptCard[] = [
  {
    title: "完整生成工作流",
    desc: "从主题到大纲、视觉方向、页面 SVG、校验与可编辑 PPTX 导出。",
    icon: PresentationIcon,
    prompt:
      "$ppt-master 请按 PPT Master 的完整生成工作流制作一份 8-12 页可编辑 PPTX。请先确认主题、受众、页数、叙事 mode、视觉 style 和素材来源；确认后生成结构化大纲、设计规格、页面内容、讲稿备注，并导出 PPTX。主题：",
  },
  {
    title: "文档转汇报",
    desc: "把 PRD、报告、会议纪要或长文整理成结论先行的管理层材料。",
    icon: FileTextIcon,
    prompt:
      "$ppt-master 我会提供文档、会议纪要或要点，请按 pyramid / briefing 中更适合的一种叙事方式整理为管理层汇报 PPTX。请压缩文字、补充页标题结论、规划图表页和讲稿备注，并生成可编辑 PPTX。",
  },
  {
    title: "PPTX 模板填充",
    desc: "上传现有 PPTX 后，选页、换文案、保留原 PowerPoint 设计。",
    icon: ImportIcon,
    prompt:
      "$ppt-master 请使用 template-fill-pptx 工作流。我会提供一个现有 PPTX 模板和新内容，请先分析模板页库，选择最适合的源页面，可重排、复用或删减页面；然后把新内容填回原生 PowerPoint 模板，保留原设计、表格、图表和转场，输出可编辑 PPTX。",
  },
  {
    title: "创建品牌/模板",
    desc: "从品牌规范、参考 PPT 或视觉截图生成可复用模板资产。",
    icon: LayoutTemplateIcon,
    prompt:
      "$ppt-master 请使用 create-brand / create-template 相关工作流，帮我把品牌规范、参考 PPT 或视觉截图沉淀为可复用的 PPT Master 模板。请先询问模板 ID、适用场景、画布比例、视觉保真度和要保留的页面类型。",
  },
  {
    title: "主题研究成稿",
    desc: "围绕一个主题先做资料结构化，再生成报告型演示。",
    icon: SearchIcon,
    prompt:
      "$ppt-master 请使用 topic-research 工作流，把我的主题整理成可演示的研究型 PPTX。请先明确研究问题、受众、证据来源和输出页数，再生成大纲、关键论点、引用说明、图表建议和可编辑 PPTX。主题：",
  },
  {
    title: "数据图表校验",
    desc: "适合经营指标、趋势、对比、漏斗、矩阵和时间线页面。",
    icon: FileBarChartIcon,
    prompt:
      "$ppt-master 请制作一份数据型汇报 PPTX，并使用 verify-charts 工作流检查图表表达。请包含指标定义、趋势解读、关键发现、风险、下一步行动；图表需可读、比例合理、标题结论明确。数据或背景：",
  },
  {
    title: "视觉审查改稿",
    desc: "对已有草稿做可读性、层级、溢出、配色和一致性检查。",
    icon: CheckIcon,
    prompt:
      "$ppt-master 请使用 visual-review / refine-spec 工作流审查并改进我提供的 PPT 草稿或页面规格。重点检查文字溢出、标题结论、视觉层级、版式一致性、图表可读性和导出质量，并给出修订后的可编辑 PPTX。",
  },
  {
    title: "旁白与动画",
    desc: "为演示补充讲稿备注、旁白音频和对象级动画节奏。",
    icon: HeadphonesIcon,
    prompt:
      "$ppt-master 请为一份演示文稿补充讲稿备注、旁白音频和动画节奏。请使用 generate-audio / customize-animations 相关能力，先确认语种、声音风格、每页讲稿长度和动画密度，再生成可编辑 PPTX。",
  },
];

const SLIDE_TEMPLATES: SlidePromptCard[] = [
  {
    title: "投资人路演",
    desc: "叙事型 pitch：问题、方案、市场、商业模式、路线图与融资计划。",
    icon: LineChartIcon,
    prompt:
      "$ppt-master 请为一个新产品设计一份 10-12 页投资人路演 PPTX。叙事 mode 使用 narrative，视觉 style 可在 glassmorphism / dark-tech / swiss-minimal 中推荐一个；包含问题、解决方案、市场机会、商业模式、竞争优势、路线图、团队和融资计划。",
  },
  {
    title: "经营复盘",
    desc: "结论先行：指标、进展、风险、决策点、行动计划。",
    icon: FileBarChartIcon,
    prompt:
      "$ppt-master 请创建一份 8-10 页季度经营复盘 PPTX。mode 使用 pyramid，visual style 推荐 data-journalism 或 editorial；结构包含目标回顾、核心指标、关键进展、风险阻塞、决策点和下一步行动。",
  },
  {
    title: "AI 产品发布",
    desc: "参考 Glassmorphism Demo：毛玻璃 SaaS、能力演示、发布节奏。",
    icon: SparklesIcon,
    prompt:
      "$ppt-master 请制作一份 AI 产品发布会 PPTX，参考 PPT Master 示例 Glassmorphism Demo 的现代 SaaS 视觉语言。mode 使用 showcase，visual style 使用 glassmorphism；包含用户痛点、核心能力、产品演示流程、发布节奏、传播计划和 FAQ。",
  },
  {
    title: "培训课件",
    desc: "教学型结构：目标、概念、步骤、案例、测验、课后任务。",
    icon: ClipboardListIcon,
    prompt:
      "$ppt-master 请设计一套 12 页培训课件 PPTX。mode 使用 instructional，visual style 可推荐 sketch-notes / soft-rounded / chalkboard；包含学习目标、概念拆解、步骤示范、案例练习、课堂测验和课后任务。",
  },
  {
    title: "论文/技术解读",
    desc: "参考 Transformer / LoRA 示例：蓝图风、结构图、公式、表格。",
    icon: SearchIcon,
    prompt:
      "$ppt-master 请把一个技术论文或工程主题整理成 12-16 页深读 PPTX，参考 Attention Is All You Need / LoRA Hu 2021 示例。mode 使用 instructional 或 briefing，visual style 使用 blueprint；包含背景、核心方法、架构图、关键公式/表格、实验结果、局限和影响。",
  },
  {
    title: "财经数据年报",
    desc: "参考 Global AI Capital：Bloomberg / Economist 信息图风。",
    icon: LineChartIcon,
    prompt:
      "$ppt-master 请制作一份财经或行业数据年报 PPTX，参考 Global AI Capital 2026 示例。mode 使用 pyramid，visual style 使用 data-journalism；包含年度摘要、资本/市场格局、关键排名、趋势图、风险矩阵和结论页。",
  },
  {
    title: "建筑/设计长读",
    desc: "参考 Pritzker / 高层住宅：摄影主导、杂志化排版。",
    icon: ImageIcon,
    prompt:
      "$ppt-master 请制作一份建筑、空间或设计主题的长读型 PPTX，参考 Pritzker 2026 / 高层住宅主动再生示例。mode 使用 briefing 或 narrative，visual style 使用 photo-editorial；请突出大图、图注、案例对比和编辑杂志节奏。",
  },
  {
    title: "MBB 战略提案",
    desc: "参考 Kimsoong：高端咨询、根因分析、四支柱和路线图。",
    icon: LayoutTemplateIcon,
    prompt:
      "$ppt-master 请生成一份 MBB 风格战略提案 PPTX，参考 Kimsoong Loyalty Programme 示例。mode 使用 pyramid，visual style 使用 swiss-minimal；包含关键挑战、现状诊断、根因分析、战略支柱、实施路线图、资源投入和预期收益。",
  },
  {
    title: "工程架构蓝图",
    desc: "参考 Kubernetes Blueprint：系统结构、拓扑、流程和组件关系。",
    icon: Grid3X3Icon,
    prompt:
      "$ppt-master 请制作一份工程架构讲解 PPTX，参考 Kubernetes Blueprint 2026 示例。mode 使用 instructional，visual style 使用 blueprint；包含系统目标、架构总览、核心组件、数据流、部署拓扑、风险和演进路线。",
  },
  {
    title: "奢侈品周报",
    desc: "参考时尚美学周鉴：高端杂志、品牌动态、生活方式。",
    icon: SparklesIcon,
    prompt:
      "$ppt-master 请制作一份奢侈品、时尚或生活方式品牌周报 PPTX，参考时尚美学周鉴示例。mode 使用 briefing，visual style 使用 editorial 或 photo-editorial；包含品牌动态、重点案例、趋势观察、视觉亮点和下周关注。",
  },
  {
    title: "东方文化叙事",
    desc: "参考植物染/藏拙：新中式、水墨留白、文化解释。",
    icon: ImageIcon,
    prompt:
      "$ppt-master 请制作一份东方文化或传统美学主题 PPTX，参考李子柒植物染色彩 / 藏拙示例。mode 使用 narrative，visual style 使用 ink-wash；请结合文化背景、色彩/器物/人物故事、视觉留白和讲稿备注。",
  },
  {
    title: "图文版式图鉴",
    desc: "参考 Image-Text Showcase：20 种图文组合与页面范式。",
    icon: LayoutTemplateIcon,
    prompt:
      "$ppt-master 请制作一份图文组合范式展示 PPTX，参考 Image-Text Showcase 示例。请在 12-20 页中覆盖不同图文比例、拼贴、九宫格、底图浮文、对角分割、时间线、矩阵和中心放射等版式，并导出可编辑 PPTX。",
  },
];

const RESEARCH_PROMPTS: SlidePromptCard[] = [
  {
    title: "全网主题调研",
    desc: "围绕一个问题梳理公开资料、关键观点、证据链接和待确认信息。",
    icon: SearchIcon,
    prompt:
      "$agent-reach 请围绕这个主题做一次公开资料调研。请先给出调研路径和信息来源类型，再收集关键事实、不同观点、证据链接、不确定点和下一步追问建议。主题：",
  },
  {
    title: "URL / 文章阅读",
    desc: "读取网页链接，提取核心观点、数据、引用和可复用摘要。",
    icon: FileTextIcon,
    prompt:
      "$agent-reach 我会提供一个或多个 URL。请读取公开页面内容，提取核心观点、关键数据、重要引用、来源链接、潜在偏见和适合继续追问的问题。",
  },
  {
    title: "GitHub 项目调研",
    desc: "比较仓库定位、活跃度、生态、文档质量、风险和适用场景。",
    icon: Grid3X3Icon,
    prompt:
      "$agent-reach 请调研并对比这些 GitHub 项目或技术方案。请关注仓库定位、活跃度、维护状态、文档质量、生态依赖、典型使用场景、风险和推荐结论。对象：",
  },
  {
    title: "视频资料整理",
    desc: "整理 YouTube、B站等公开视频资料的主题、结构和关键信息。",
    icon: VideoIcon,
    prompt:
      "$agent-reach 请整理我提供的公开视频链接或视频主题。请提取标题、来源、发布时间、内容结构、关键观点、可引用片段、相关链接和后续资料线索。",
  },
];

const RESEARCH_TEMPLATES: SlidePromptCard[] = [
  {
    title: "竞品公开信息调研",
    desc: "官网、文档、公开发布、仓库和媒体资料，整理定位与差异。",
    icon: FileBarChartIcon,
    prompt:
      "$agent-reach 请对这些竞品做公开信息调研。请覆盖官网/文档/公开发布/媒体资料/GitHub 等公开来源，整理产品定位、核心功能、定价线索、近期变化、差异点、证据链接和可验证假设。竞品：",
  },
  {
    title: "技术选型资料收集",
    desc: "面向工程决策，收集官方文档、仓库、案例和限制条件。",
    icon: ClipboardListIcon,
    prompt:
      "$agent-reach 请为这个技术选型收集公开资料。请优先查官方文档、GitHub、技术博客和案例，整理能力边界、成熟度、学习成本、集成风险、替代方案和推荐结论。技术方向：",
  },
  {
    title: "行业趋势追踪",
    desc: "用公开文章、RSS、报告和新闻线索整理趋势与时间线。",
    icon: LineChartIcon,
    prompt:
      "$agent-reach 请围绕这个行业主题追踪近期公开资料和 RSS/新闻线索，整理时间线、关键事件、主要参与者、数据点、争议问题、来源链接和对 T3 Code 的启发。主题：",
  },
  {
    title: "产品口碑公开信息",
    desc: "整理公开评论、测评、社区讨论和常见正负面反馈。",
    icon: SparklesIcon,
    prompt:
      "$agent-reach 请整理这个产品的公开口碑信息。请只基于可访问的公开资料，归纳正面评价、负面反馈、典型用户场景、反复出现的问题、证据链接和后续验证建议。产品：",
  },
  {
    title: "论文 / 报告速读",
    desc: "读取公开论文、白皮书或长报告，提炼结构化摘要。",
    icon: FileTextIcon,
    prompt:
      "$agent-reach 请读取我提供的公开论文、白皮书或长报告链接，整理研究问题、方法、关键结论、数据来源、局限性、可引用观点和适合做成汇报的结构。",
  },
  {
    title: "开源生态地图",
    desc: "围绕一个领域找到代表项目、工具链、社区和演进方向。",
    icon: Grid3X3Icon,
    prompt:
      "$agent-reach 请围绕这个开源领域做生态地图调研。请找出代表项目、工具链、社区资源、维护活跃度、许可证线索、技术路线差异、风险和推荐关注列表。领域：",
  },
  {
    title: "公开资料事实核对",
    desc: "对一个结论或说法查找来源，区分事实、推断和争议。",
    icon: CheckIcon,
    prompt:
      "$agent-reach 请对这个说法做公开资料事实核对。请查找原始来源和多个可信公开来源，区分已证实事实、合理推断、争议点、缺失证据，并给出引用链接。说法：",
  },
  {
    title: "学习路线资料包",
    desc: "收集官方文档、教程、示例项目和视频资料，形成学习路径。",
    icon: LayoutTemplateIcon,
    prompt:
      "$agent-reach 请为这个主题收集公开学习资料包。请包含官方文档、入门教程、示例项目、公开视频、进阶文章、常见坑和 7 天学习路线。主题：",
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
  research: "想调研什么公开资料？",
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

const PLUGINS_LIST_QUERY = ["plugins", "list"] as const;

function getPluginsClient() {
  return getPrimaryEnvironmentConnection().client.plugins;
}

function findPluginByName(
  plugins: ReadonlyArray<PluginSummary>,
  pluginName: string,
): PluginSummary | null {
  return (
    plugins.find(
      (plugin) =>
        plugin.name === pluginName ||
        plugin.location.pluginName === pluginName ||
        plugin.id.includes(pluginName),
    ) ?? null
  );
}

function useBundledPlugin(pluginName: string) {
  const queryClient = useQueryClient();
  const pluginsQuery = useQuery({
    queryKey: PLUGINS_LIST_QUERY,
    queryFn: () => getPluginsClient().list(),
    staleTime: 30_000,
  });
  const plugin = useMemo(
    () =>
      findPluginByName(
        pluginsQuery.data?.marketplaces.flatMap((marketplace) => marketplace.plugins) ?? [],
        pluginName,
      ),
    [pluginName, pluginsQuery.data],
  );
  const installMutation = useMutation({
    mutationFn: (target: PluginSummary) =>
      getPluginsClient().install({
        pluginName: target.location.pluginName,
        marketplacePath: target.location.marketplacePath ?? null,
        remoteMarketplaceName: target.location.remoteMarketplaceName ?? null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLUGINS_LIST_QUERY });
    },
  });
  return {
    plugin,
    loading: pluginsQuery.isLoading || pluginsQuery.isFetching,
    error: pluginsQuery.error,
    installError: installMutation.error,
    installing: installMutation.isPending,
    install: async () => {
      if (!plugin) return;
      await installMutation.mutateAsync(plugin);
    },
  };
}

function usePptMasterPlugin() {
  return useBundledPlugin("ppt-master");
}

function useAgentReachPlugin() {
  return useBundledPlugin("agent-reach");
}

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
  const shouldLiftEmptyGeneralLauncher = mode === "general" && !shouldShowIdleSuggestions;
  const shouldShowModeRecommendations = !shouldShowIdleSuggestions && mode !== "general";

  return (
    <main
      className={cn(
        "flex min-h-0 flex-1 flex-col px-4 sm:px-6",
        mode === "general" ? "overflow-hidden" : "overflow-y-auto",
      )}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[48rem] flex-col items-center">
        <div
          className={cn(
            "flex w-full flex-col items-center",
            mode === "general" ? "min-h-full justify-center" : "pb-8 pt-[8vh]",
            shouldLiftEmptyGeneralLauncher && "pb-14 sm:pb-20",
          )}
        >
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

          {shouldShowModeRecommendations ? (
            <div
              key={mode}
              className="mt-7 w-full animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <ModeRecommendations mode={mode} onSubmitPreset={onSubmitPreset} />
            </div>
          ) : null}
        </div>
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
    return <SlidesRecommendations onSubmitPreset={onSubmitPreset} />;
  }

  if (mode === "research") {
    return <ResearchRecommendations onSubmitPreset={onSubmitPreset} />;
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

function SlidesRecommendations({
  onSubmitPreset,
}: {
  onSubmitPreset: (prompt: string, mode?: LauncherModeId) => void;
}) {
  const pptMaster = usePptMasterPlugin();
  const installed = pptMaster.plugin?.installed === true;
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installDialogError, setInstallDialogError] = useState<string | null>(null);

  const submitSlidePrompt = (prompt: string) => {
    if (installed) {
      onSubmitPreset(prompt, "slides");
      return;
    }
    setPendingPrompt(prompt);
    setInstallDialogError(null);
    setInstallDialogOpen(true);
  };

  const installAndContinue = async () => {
    if (!pptMaster.plugin || !pendingPrompt) return;
    setInstallDialogError(null);
    try {
      await pptMaster.install();
      setInstallDialogOpen(false);
      onSubmitPreset(pendingPrompt, "slides");
      setPendingPrompt(null);
    } catch (error) {
      setInstallDialogError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <section className="mx-auto w-full max-w-[744px]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionTitle className="mb-0">工作流入口</SectionTitle>
          <PluginStatusBadge installed={installed} loading={pptMaster.loading} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SLIDE_PROMPTS.map((prompt, index) => {
            const Icon = prompt.icon ?? PresentationIcon;
            return (
              <button
                key={prompt.title}
                type="button"
                onClick={() => submitSlidePrompt(prompt.prompt)}
                className="flex min-h-[118px] animate-in flex-col justify-between rounded-[10px] border border-border bg-background p-3 text-left text-[13px] leading-5 text-foreground fade-in slide-in-from-bottom-2 transition-colors duration-300 hover:bg-accent"
                style={{ animationDelay: `${index * 55}ms`, animationFillMode: "both" }}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4 text-[#147DFF]" />
                  {prompt.title}
                </span>
                {prompt.desc ? (
                  <span className="mt-2 text-[12px] leading-5 text-muted-foreground">
                    {prompt.desc}
                  </span>
                ) : null}
                <ArrowUpRightIcon className="ml-auto mt-2 h-3.5 w-3.5 text-muted-foreground" />
              </button>
            );
          })}
        </div>

        <div className="mt-8">
          <SectionTitle className="mb-3">演示模板</SectionTitle>
          <button
            type="button"
            onClick={() =>
              submitSlidePrompt(
                "$ppt-master 请使用 template-fill-pptx 工作流。我会提供一个现有 PPTX 模板和新内容，请先告诉我需要上传哪些文件；收到后分析模板页库，选择最适合的源页面，可重排、复用或删减页面；然后把新内容填回原生 PowerPoint 模板，保留原设计、表格、图表和转场，输出可编辑 PPTX。",
              )
            }
            className="group flex min-h-[86px] w-full animate-in items-center gap-3 rounded-[10px] border border-border bg-background px-4 py-3 text-left fade-in slide-in-from-bottom-2 transition-colors duration-300 hover:bg-accent"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#147DFF]/10 text-[#147DFF]">
              <ImportIcon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-foreground">
                导入现有 PPTX 模板填充
              </span>
              <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-muted-foreground">
                上传已有 PPTX 和新内容，保留原设计，自动选页、重排、替换文案并导出。
              </span>
            </span>
            <ArrowUpRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-[#147DFF]" />
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SLIDE_TEMPLATES.map((template, index) => {
            const TemplateIcon = template.icon ?? PresentationIcon;
            return (
              <button
                key={template.title}
                type="button"
                onClick={() => submitSlidePrompt(template.prompt)}
                className="group flex min-h-[136px] animate-in flex-col rounded-[10px] border border-border bg-background p-3 text-left fade-in slide-in-from-bottom-2 transition-colors duration-300 hover:bg-accent"
                style={{ animationDelay: `${(index + 1) * 55}ms`, animationFillMode: "both" }}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-muted text-[#147DFF] transition-colors group-hover:bg-[#147DFF]/10">
                    <TemplateIcon className="h-4.5 w-4.5" />
                  </span>
                  <ArrowUpRightIcon className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-[#147DFF]" />
                </span>
                <span className="mt-3 block text-[13px] font-medium leading-5 text-foreground">
                  {template.title}
                </span>
                {template.desc ? (
                  <span className="mt-1 line-clamp-3 block text-[12px] leading-5 text-muted-foreground">
                    {template.desc}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>安装 PPT Master 插件</DialogTitle>
            <DialogDescription>
              制作幻灯片需要安装 T3 Code 内置插件 PPT Master。安装后即可用 $ppt-master 生成可编辑
              PowerPoint 文件。
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="rounded-[10px] border border-border bg-muted/30 px-4 py-3 text-[13px] leading-5 text-muted-foreground">
              {pptMaster.plugin
                ? "安装完成后会自动继续你刚才选择的幻灯片任务。"
                : pptMaster.loading
                  ? "正在检查内置插件，请稍候。"
                  : "当前未发现 PPT Master 插件，请确认内置扩展资源已正确打包。"}
              {pptMaster.error || pptMaster.installError || installDialogError ? (
                <span className="mt-2 block text-destructive">
                  {installDialogError ??
                    (pptMaster.installError instanceof Error
                      ? pptMaster.installError.message
                      : pptMaster.error instanceof Error
                        ? pptMaster.error.message
                        : String(pptMaster.installError ?? pptMaster.error))}
                </span>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pptMaster.installing}
              onClick={() => setInstallDialogOpen(false)}
            >
              稍后
            </Button>
            <Button
              type="button"
              disabled={!pptMaster.plugin || pptMaster.installing}
              onClick={() => void installAndContinue()}
            >
              {pptMaster.installing ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
              {pptMaster.installing ? "安装中" : "安装并继续"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function ResearchRecommendations({
  onSubmitPreset,
}: {
  onSubmitPreset: (prompt: string, mode?: LauncherModeId) => void;
}) {
  const agentReach = useAgentReachPlugin();
  const installed = agentReach.plugin?.installed === true;
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installDialogError, setInstallDialogError] = useState<string | null>(null);

  const submitResearchPrompt = (prompt: string) => {
    if (installed) {
      onSubmitPreset(prompt, "research");
      return;
    }
    setPendingPrompt(prompt);
    setInstallDialogError(null);
    setInstallDialogOpen(true);
  };

  const installAndContinue = async () => {
    if (!agentReach.plugin || !pendingPrompt) return;
    setInstallDialogError(null);
    try {
      await agentReach.install();
      setInstallDialogOpen(false);
      onSubmitPreset(pendingPrompt, "research");
      setPendingPrompt(null);
    } catch (error) {
      setInstallDialogError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <section className="mx-auto w-full max-w-[744px]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionTitle className="mb-0">调研入口</SectionTitle>
          <PluginStatusBadge installed={installed} loading={agentReach.loading} />
        </div>

        {!installed ? (
          <button
            type="button"
            onClick={() => submitResearchPrompt(RESEARCH_PROMPTS[0]?.prompt ?? "$agent-reach ")}
            className="group mb-4 flex min-h-[86px] w-full animate-in items-center gap-3 rounded-[10px] border border-[#147DFF]/30 bg-[#147DFF]/5 px-4 py-3 text-left fade-in slide-in-from-bottom-2 transition-colors duration-300 hover:bg-[#147DFF]/10"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#147DFF]/10 text-[#147DFF]">
              <DownloadIcon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-foreground">
                安装 Agent Reach 插件
              </span>
              <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-muted-foreground">
                安装后可用 $agent-reach 做网页搜索、链接阅读、GitHub、RSS 和公开视频资料调研。
              </span>
            </span>
            <ArrowUpRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-[#147DFF]" />
          </button>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {RESEARCH_PROMPTS.map((prompt, index) => {
            const Icon = prompt.icon ?? SearchIcon;
            return (
              <button
                key={prompt.title}
                type="button"
                onClick={() => submitResearchPrompt(prompt.prompt)}
                className="flex min-h-[118px] animate-in flex-col justify-between rounded-[10px] border border-border bg-background p-3 text-left text-[13px] leading-5 text-foreground fade-in slide-in-from-bottom-2 transition-colors duration-300 hover:bg-accent"
                style={{ animationDelay: `${index * 55}ms`, animationFillMode: "both" }}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4 text-[#147DFF]" />
                  {prompt.title}
                </span>
                {prompt.desc ? (
                  <span className="mt-2 text-[12px] leading-5 text-muted-foreground">
                    {prompt.desc}
                  </span>
                ) : null}
                <ArrowUpRightIcon className="ml-auto mt-2 h-3.5 w-3.5 text-muted-foreground" />
              </button>
            );
          })}
        </div>

        <div className="mt-8">
          <SectionTitle className="mb-3">演示模板</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {RESEARCH_TEMPLATES.map((template, index) => {
              const TemplateIcon = template.icon ?? SearchIcon;
              return (
                <button
                  key={template.title}
                  type="button"
                  onClick={() => submitResearchPrompt(template.prompt)}
                  className="group flex min-h-[136px] animate-in flex-col rounded-[10px] border border-border bg-background p-3 text-left fade-in slide-in-from-bottom-2 transition-colors duration-300 hover:bg-accent"
                  style={{ animationDelay: `${index * 55}ms`, animationFillMode: "both" }}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-muted text-[#147DFF] transition-colors group-hover:bg-[#147DFF]/10">
                      <TemplateIcon className="h-4.5 w-4.5" />
                    </span>
                    <ArrowUpRightIcon className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-[#147DFF]" />
                  </span>
                  <span className="mt-3 block text-[13px] font-medium leading-5 text-foreground">
                    {template.title}
                  </span>
                  {template.desc ? (
                    <span className="mt-1 line-clamp-3 block text-[12px] leading-5 text-muted-foreground">
                      {template.desc}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>安装 Agent Reach 插件</DialogTitle>
            <DialogDescription>
              联网调研需要安装 T3 Code 内置插件 Agent Reach。安装后即可用 $agent-reach
              发起公开资料搜索、链接阅读和研究整理任务。
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="rounded-[10px] border border-border bg-muted/30 px-4 py-3 text-[13px] leading-5 text-muted-foreground">
              {agentReach.plugin
                ? "安装完成后会自动继续你刚才选择的调研任务。"
                : agentReach.loading
                  ? "正在检查内置插件，请稍候。"
                  : "当前未发现 Agent Reach 插件，请确认内置扩展资源已正确打包。"}
              {agentReach.error || agentReach.installError || installDialogError ? (
                <span className="mt-2 block text-destructive">
                  {installDialogError ??
                    (agentReach.installError instanceof Error
                      ? agentReach.installError.message
                      : agentReach.error instanceof Error
                        ? agentReach.error.message
                        : String(agentReach.installError ?? agentReach.error))}
                </span>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={agentReach.installing}
              onClick={() => setInstallDialogOpen(false)}
            >
              稍后
            </Button>
            <Button
              type="button"
              disabled={!agentReach.plugin || agentReach.installing}
              onClick={() => void installAndContinue()}
            >
              {agentReach.installing ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
              {agentReach.installing ? "安装中" : "安装并继续"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function PluginStatusBadge({ installed, loading }: { installed: boolean; loading: boolean }) {
  if (installed) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-emerald-500/30 bg-emerald-500/10 px-3 text-[13px] text-emerald-700 dark:text-emerald-300">
        <CheckIcon className="h-3.5 w-3.5" />
        已启用
      </span>
    );
  }
  return (
    <span className="inline-flex h-8 items-center rounded-[8px] border border-border px-3 text-[13px] text-muted-foreground">
      {loading ? "正在检查" : "首次使用需安装"}
    </span>
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
