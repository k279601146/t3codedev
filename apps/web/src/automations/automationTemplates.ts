import {
  BellIcon,
  BookOpenIcon,
  BugIcon,
  GitPullRequestIcon,
  NetworkIcon,
  PowerIcon,
  StarIcon,
  type LucideIcon,
} from "lucide-react";

export interface AutomationTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
  readonly icon: LucideIcon;
  readonly iconClassName: string;
}

export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: "recent-commit-bug-scan",
    title: "最近提交巡检",
    description:
      "扫描最近的 commit（自上次运行以来，或过去 24 小时内），查找可能的 bug 并提出最小修复方案。",
    prompt:
      "创建一个自动化：扫描最近的 commit（自上次运行以来，或过去 24 小时内），查找可能的 bug 并提出最小修复方案。依据规则：只使用仓库中的具体证据（commit SHA、PR、文件路径、diff、失败的测试、CI 信号）。不要臆造 bug；如果证据不足，请说明并跳过。优先选择最小且安全的修复，避免重构和无关清理。",
    icon: BugIcon,
    iconClassName: "bg-red-500 text-white",
  },
  {
    id: "weekly-merged-pr-release-notes",
    title: "每周 PR 发布说明",
    description:
      "根据已合并的 PR 起草每周发布说明，范围与依据严格限制在仓库历史记录内。",
    prompt:
      "创建一个自动化：根据已合并的 PR 起草每周发布说明。如有链接请附上。范围与依据：严格以该仓库当周历史记录为限；不要添加超出数据支持的额外部分。使用 PR 编号/标题；除非仓库中的 PR 描述、测试或指标支持，否则避免对影响作出结论。",
    icon: BookOpenIcon,
    iconClassName: "bg-orange-500 text-white",
  },
  {
    id: "daily-git-digest",
    title: "每日 Git 简报",
    description:
      "为站会总结昨天的 git 活动，只陈述应锚定到 commit、PR 或文件的事实。",
    prompt:
      "创建一个自动化：每天为站会总结昨天的 git 活动。依据规则：陈述应锚定到 commit、PR 或文件；不要臆测意图或未来工作。保持便于快速浏览，并适合团队同步。",
    icon: BellIcon,
    iconClassName: "bg-violet-500 text-white",
  },
  {
    id: "ci-failure-triage",
    title: "CI 失败归因",
    description:
      "总结上一个 CI 窗口中的 CI 失败和不稳定测试，提出首要修复建议。",
    prompt:
      "创建一个自动化：总结上一个 CI 窗口中的 CI 失败和不稳定测试，提出首要修复建议。依据规则：尽可能引用具体作业、测试、错误信息或日志片段。避免过度自信地断言根因；区分“已观察到”与“疑似”。",
    icon: PowerIcon,
    iconClassName: "bg-teal-500 text-white",
  },
  {
    id: "small-classic-game",
    title: "经典小游戏原型",
    description:
      "创建一个范围尽可能小的经典小游戏，复用现有仓库工具和模式。",
    prompt:
      "创建一个自动化：创建一个范围尽可能小的经典小游戏。约束：除非必要，否则不要添加额外功能、样式系统、内容或新的依赖项。复用现有仓库的工具和模式。",
    icon: StarIcon,
    iconClassName: "bg-indigo-500 text-yellow-300",
  },
  {
    id: "pr-improvement-plan",
    title: "PR 改进建议",
    description:
      "根据近期 PR 和评审，建议下一步需要深入提升的技能或工程能力。",
    prompt:
      "创建一个自动化：根据近期 PR 和评审，建议下一步需要深入提升的技能或工程能力。依据规则：每条建议都要锚定具体证据（PR 主题、评审意见、反复出现的问题）。避免空泛建议；每条建议都要可执行且具体。",
    icon: NetworkIcon,
    iconClassName: "bg-blue-500 text-white",
  },
];

export const AUTOMATION_CHAT_CREATE_PROMPT =
  "我想创建一个自动化。请先询问我任务目标、运行频率、工作区范围、运行环境、成功输出格式和安全边界，然后把它整理成可保存的自动化配置。";

export const AUTOMATION_REVIEW_QUEUE_TEMPLATE: AutomationTemplate = {
  id: "review-queue",
  title: "自动评审队列",
  description:
    "让 Codex 定期检查待评审 PR、CI 状态或仓库风险，并把结果交回给你审阅。",
  prompt:
    "创建一个自动化：定期检查待评审 PR、CI 状态或仓库风险，并把结果交回给我审阅。请先确认仓库范围、运行频率、需要检查的信号，以及哪些操作必须只建议不执行。",
  icon: GitPullRequestIcon,
  iconClassName: "bg-emerald-500 text-white",
};
