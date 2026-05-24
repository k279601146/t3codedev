import { useNavigate } from "@tanstack/react-router";
import {
  BookOpenIcon,
  BotIcon,
  ChevronDownIcon,
  MessageSquarePlusIcon,
  SettingsIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  AUTOMATION_CHAT_CREATE_PROMPT,
  AUTOMATION_REVIEW_QUEUE_TEMPLATE,
  AUTOMATION_TEMPLATES,
  type AutomationTemplate,
} from "~/automations/automationTemplates";
import { useComposerDraftStore } from "~/composerDraftStore";
import { usePrimaryEnvironmentId } from "~/environments/primary";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { ScrollArea } from "~/components/ui/scroll-area";

export function AutomationsPage() {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const setNewThreadScope = useUiStateStore((store) => store.setNewThreadScope);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const seedConversationDraft = useCallback(
    async (prompt: string) => {
      if (!primaryEnvironmentId) {
        return;
      }

      setNewThreadScope({ kind: "conversation" });
      const draftSession =
        useComposerDraftStore
          .getState()
          .getReusableConversationDraftSession() ??
        useComposerDraftStore.getState().ensureConversationDraftSession(primaryEnvironmentId);
      useComposerDraftStore.getState().setPrompt(draftSession.draftId, prompt);
      setTemplatesOpen(false);
      await navigate({ to: "/" });
    },
    [navigate, primaryEnvironmentId, setNewThreadScope],
  );

  const createFromChat = useCallback(() => {
    void seedConversationDraft(AUTOMATION_CHAT_CREATE_PROMPT);
  }, [seedConversationDraft]);

  const createFromTemplate = useCallback(
    (template: AutomationTemplate) => {
      void seedConversationDraft(template.prompt);
    },
    [seedConversationDraft],
  );

  const reviewTemplate = useMemo(() => AUTOMATION_REVIEW_QUEUE_TEMPLATE, []);
  const quickTemplates = useMemo(
    () =>
      [
        { label: "每日简报", id: "daily-git-digest" },
        { label: "每周回顾", id: "weekly-merged-pr-release-notes" },
        { label: "项目监控", id: "recent-commit-bug-scan" },
      ].flatMap((entry) => {
        const template = AUTOMATION_TEMPLATES.find((candidate) => candidate.id === entry.id);
        return template ? [{ ...entry, template }] : [];
      }),
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-border/60 px-5">
        <Button size="xs" variant="outline" onClick={() => setTemplatesOpen(true)}>
          查看模板
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                size="xs"
                className="gap-1.5 rounded-md bg-foreground text-background hover:bg-foreground/88"
              />
            }
          >
            <MessageSquarePlusIcon className="size-3.5" />
            通过聊天创建
            <ChevronDownIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" className="w-48">
            <MenuItem onClick={createFromChat}>
              <MessageSquarePlusIcon className="size-4" />
              通过聊天创建
            </MenuItem>
            <MenuItem onClick={() => createFromTemplate(reviewTemplate)}>
              <BookOpenIcon className="size-4" />
              从评审队列开始
            </MenuItem>
          </MenuPopup>
        </Menu>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col px-6 py-14">
          <section className="shrink-0">
            <h1 className="text-3xl font-semibold tracking-normal text-foreground">自动化</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              按计划或按需运行聊天。
              <a
                href="https://developers.openai.com/codex/sdk/#app-server"
                target="_blank"
                rel="noreferrer"
                className="ml-2 text-primary hover:underline"
              >
                了解更多
              </a>
            </p>
          </section>

          <Empty className="min-h-[28rem] flex-1 p-0">
            <EmptyHeader>
              <AutomationCloudIcon />
              <EmptyTitle className="text-base">创建首个自动化</EmptyTitle>
            </EmptyHeader>
            <EmptyContent className="max-w-none flex-row justify-center gap-2">
              {quickTemplates.map((entry) => (
                <AutomationQuickButton
                  key={entry.id}
                  icon={entry.template.icon}
                  label={entry.label}
                  onClick={() => createFromTemplate(entry.template)}
                />
              ))}
            </EmptyContent>
          </Empty>
        </main>
      </ScrollArea>

      <AutomationTemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onChooseTemplate={createFromTemplate}
        onManualSetup={createFromChat}
      />
    </div>
  );
}

function AutomationQuickButton({
  icon: Icon,
  label,
  onClick,
}: {
  readonly icon: AutomationTemplate["icon"];
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <Icon className="size-4" />
      {label}
    </Button>
  );
}

function AutomationTemplatesDialog({
  open,
  onOpenChange,
  onChooseTemplate,
  onManualSetup,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChooseTemplate: (template: AutomationTemplate) => void;
  readonly onManualSetup: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-h-[min(76dvh,42rem)] max-w-[50rem] rounded-3xl border-border/70"
        showCloseButton
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 px-5 py-4">
          <DialogTitle className="text-base font-semibold">自动化模板</DialogTitle>
          <Button
            size="sm"
            variant="outline"
            className="mr-9 rounded-xl"
            onClick={onManualSetup}
          >
            <SettingsIcon className="size-4" />
            手动设置
          </Button>
        </DialogHeader>
        <DialogPanel className="px-5 pb-5 pt-2">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {AUTOMATION_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="group flex min-h-36 w-full flex-col items-start rounded-3xl border border-border/70 bg-card/35 px-4 py-4 text-left transition hover:border-border hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChooseTemplate(template)}
              >
                <span
                  className={cn(
                    "mb-3 flex size-5 items-center justify-center rounded-md shadow-sm",
                    template.iconClassName,
                  )}
                  aria-hidden
                >
                  <template.icon className="size-3.5" />
                </span>
                <span className="text-sm leading-6 text-foreground">{template.description}</span>
              </button>
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function AutomationCloudIcon() {
  return (
    <div
      className="mb-8 flex size-24 items-center justify-center text-foreground"
      aria-hidden="true"
    >
      <BotIcon className="size-20 stroke-[1.8]" />
    </div>
  );
}
