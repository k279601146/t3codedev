import {
  BellIcon,
  CalendarDaysIcon,
  InboxIcon,
  GitPullRequestIcon,
  PhoneCallIcon,
  SparklesIcon,
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
    id: "daily-checkin",
    title: "每日收件箱",
    description: "整理今天需要处理的事项、提醒和跟进，适合日常自我管理。",
    prompt:
      "创建一个自动化：每天整理今天需要处理的事项、提醒和跟进。优先输出可执行的三部分：今天最重要的 3 件事、需要等待别人回复的事项、可以顺手完成的短任务。不要依赖仓库或 Git；如果信息不足，就说明需要我补充什么。",
    icon: InboxIcon,
    iconClassName: "bg-slate-700 text-white",
  },
  {
    id: "follow-up-reminder",
    title: "待办提醒",
    description: "盯住某件事，定时提醒我继续推进或确认结果。",
    prompt:
      "创建一个自动化：定时提醒我继续推进某件事，并在每次运行时先判断是否已经有新的结果、回复或进展。若有新信息，就帮我总结下一步；若没有，就给我一句简短的催办提醒。重点是日常跟进，不要依赖 Git。",
    icon: BellIcon,
    iconClassName: "bg-amber-500 text-white",
  },
  {
    id: "daily-summary",
    title: "每日摘要",
    description: "把昨天的沟通、笔记或任务整理成一段简洁摘要。",
    prompt:
      "创建一个自动化：每天把昨天的重要沟通、笔记或任务整理成简洁摘要。输出要分成：发生了什么、哪些事情还没结束、今天要接着做什么。不要默认只看仓库；如果只能看到有限信息，要直接说明范围。",
    icon: CalendarDaysIcon,
    iconClassName: "bg-indigo-600 text-white",
  },
  {
    id: "research-loop",
    title: "持续研究",
    description: "让同一个线程定期回来补充资料、收敛问题和结论。",
    prompt:
      "创建一个自动化：在同一个线程里持续推进一个研究或分析任务。每次运行先检查是否已有新资料，再决定是继续收集信息、更新结论，还是直接汇报已完成内容。保持上下文连续，不要创建新的项目依赖。",
    icon: SparklesIcon,
    iconClassName: "bg-emerald-600 text-white",
  },
  {
    id: "project-review",
    title: "项目巡检",
    description: "偏技术场景的模板，适合仓库、PR、CI 或代码质量巡检。",
    prompt:
      "创建一个自动化：定期检查项目的最近变更、PR、CI 状态或风险点，并输出简洁的巡检结果。只使用仓库中的具体证据；如果证据不足，不要下结论。适合技术工作流，但不是唯一用途。",
    icon: GitPullRequestIcon,
    iconClassName: "bg-sky-600 text-white",
  },
  {
    id: "family-or-life-admin",
    title: "生活杂事清单",
    description: "适合记录缴费、预约、办事、跟进和生活管理。",
    prompt:
      "创建一个自动化：定期帮我整理生活杂事清单，包括缴费、预约、办事和需要跟进的事项。输出要偏日常，不要假设有项目或仓库背景；如果需要更多上下文，就先问我。",
    icon: PhoneCallIcon,
    iconClassName: "bg-rose-600 text-white",
  },
];

export const AUTOMATION_CHAT_CREATE_PROMPT =
  "我想创建一个自动化。请先询问我它是通用任务、线程心跳还是项目巡检，再继续问运行频率、是否要绑定项目、结果要出现在哪里、运行环境和安全边界，最后把它整理成可保存的自动化配置。";

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
