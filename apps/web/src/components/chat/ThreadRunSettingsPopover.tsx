import {
  type ModelSelection,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type RuntimeMode,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  createModelSelection,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  setProviderOptionDescriptorCurrentValue,
} from "@t3tools/shared/model";
import { SlidersHorizontalIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { getProviderModelCapabilities } from "../../providerModels";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { getAppModelOptionsForInstance } from "../../modelSelection";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { cn } from "~/lib/utils";

type Personality = "none" | "friendly" | "pragmatic";
type ReasoningSummary = "auto" | "concise" | "detailed" | "none";
const CLEAR_OVERRIDE = "__clear__";

interface ThreadRunSettingsPopoverProps {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly cwd: string | null;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly providerStatuses: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
  readonly disabled?: boolean;
  readonly onSave: (input: {
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly cwd?: string;
    readonly permissionProfileId?: string | null;
    readonly personality?: Personality | null;
    readonly reasoningSummary?: ReasoningSummary | null;
    readonly serviceTier?: string | null;
  }) => Promise<void>;
}

const RUNTIME_MODE_LABELS: Record<RuntimeMode, string> = {
  "approval-required": "只读审批",
  "auto-accept-edits": "自动接受编辑",
  "full-access": "完全访问",
};

export const ThreadRunSettingsPopover = memo(function ThreadRunSettingsPopover(
  props: ThreadRunSettingsPopoverProps,
) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState(props.modelSelection.instanceId);
  const [model, setModel] = useState(props.modelSelection.model);
  const [modelOptions, setModelOptions] = useState<ReadonlyArray<ProviderOptionSelection>>(
    props.modelSelection.options ?? [],
  );
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(props.runtimeMode);
  const [cwd, setCwd] = useState(props.cwd ?? "");
  const [permissionProfileId, setPermissionProfileId] = useState("");
  const [personality, setPersonality] = useState<"" | typeof CLEAR_OVERRIDE | Personality>("");
  const [reasoningSummary, setReasoningSummary] = useState<
    "" | typeof CLEAR_OVERRIDE | ReasoningSummary
  >("");
  const [serviceTier, setServiceTier] = useState("");

  useEffect(() => {
    if (!open) return;
    setInstanceId(props.modelSelection.instanceId);
    setModel(props.modelSelection.model);
    setModelOptions(props.modelSelection.options ?? []);
    setRuntimeMode(props.runtimeMode);
    setCwd(props.cwd ?? "");
    setPermissionProfileId("");
    setPersonality("");
    setReasoningSummary("");
    setServiceTier("");
    setError(null);
  }, [open, props.threadId]);

  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(deriveProviderInstanceEntries(props.providerStatuses)).filter(
        (entry) => entry.enabled && entry.isAvailable && entry.status === "ready",
      ),
    [props.providerStatuses],
  );
  const selectedEntry = entries.find((entry) => entry.instanceId === instanceId) ?? entries[0];
  const selectedModels = selectedEntry
    ? getAppModelOptionsForInstance(props.settings, selectedEntry)
    : [];
  const selectedSnapshot = selectedEntry?.snapshot;
  const selectedModel = selectedModels.find((candidate) => candidate.slug === model);
  const capabilities =
    selectedEntry && selectedModel
      ? getProviderModelCapabilities(selectedEntry.models, model, selectedEntry.driverKind)
      : null;
  const optionDescriptors = useMemo(
    () =>
      capabilities
        ? getProviderOptionDescriptors({
            caps: capabilities,
            selections: modelOptions,
          })
        : [],
    [capabilities, modelOptions],
  );
  const reasoningDescriptor = optionDescriptors.find(
    (descriptor): descriptor is Extract<(typeof optionDescriptors)[number], { type: "select" }> =>
      descriptor.type === "select" && descriptor.id === "reasoningEffort",
  );
  const reasoningValue = getProviderOptionCurrentValue(reasoningDescriptor);
  const permissionProfiles = selectedSnapshot?.permissionProfiles ?? [];
  const canSyncProviderSettings = selectedEntry?.driverKind === "codex";

  const handleInstanceChange = (nextInstanceId: string) => {
    const nextEntry = entries.find((entry) => entry.instanceId === nextInstanceId);
    if (!nextEntry) return;
    const nextModels = getAppModelOptionsForInstance(props.settings, nextEntry);
    setInstanceId(nextEntry.instanceId);
    setModel(nextModels[0]?.slug ?? "");
    setModelOptions([]);
    setPermissionProfileId("");
  };

  const handleReasoningChange = (value: string) => {
    if (!reasoningDescriptor) return;
    const nextDescriptors = optionDescriptors.map((descriptor) =>
      descriptor.id === reasoningDescriptor.id
        ? setProviderOptionDescriptorCurrentValue(descriptor, value)
        : descriptor,
    );
    setModelOptions(buildProviderOptionSelectionsFromDescriptors(nextDescriptors) ?? []);
  };

  const handleSave = async () => {
    if (!selectedEntry || !model) return;
    const nextPermissionProfileId =
      permissionProfileId === CLEAR_OVERRIDE
        ? null
        : permissionProfileId
          ? permissionProfileId
          : undefined;
    const nextPersonality =
      personality === CLEAR_OVERRIDE ? null : personality ? personality : undefined;
    const nextReasoningSummary =
      reasoningSummary === CLEAR_OVERRIDE ? null : reasoningSummary ? reasoningSummary : undefined;
    const nextServiceTier =
      serviceTier === CLEAR_OVERRIDE ? null : serviceTier ? serviceTier : undefined;
    setSaving(true);
    setError(null);
    try {
      await props.onSave({
        modelSelection: createModelSelection(instanceId, model, modelOptions),
        runtimeMode,
        ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        ...(nextPermissionProfileId !== undefined
          ? { permissionProfileId: nextPermissionProfileId }
          : {}),
        ...(nextPersonality !== undefined ? { personality: nextPersonality } : {}),
        ...(nextReasoningSummary !== undefined ? { reasoningSummary: nextReasoningSummary } : {}),
        ...(nextServiceTier !== undefined ? { serviceTier: nextServiceTier } : {}),
      });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存运行设置失败。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            className="size-6 rounded-md"
            disabled={props.disabled}
            aria-label="线程运行设置"
            title="线程运行设置"
          >
            <SlidersHorizontalIcon className="size-3.5" />
          </Button>
        }
      />
      <PopoverPopup align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="space-y-3 p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{props.title}</div>
            <div className="text-xs text-muted-foreground">
              {canSyncProviderSettings
                ? "保存后立即同步到 Codex 线程。"
                : "当前 provider 暂不支持即时同步。"}
            </div>
          </div>

          <Field label="提供方">
            <select
              className={selectClassName}
              value={instanceId}
              onChange={(event) => handleInstanceChange(event.target.value)}
            >
              {entries.map((entry) => (
                <option key={entry.instanceId} value={entry.instanceId}>
                  {entry.displayName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="模型">
            <select
              className={selectClassName}
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setModelOptions([]);
              }}
            >
              {selectedModels.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.shortName ?? option.name}
                </option>
              ))}
            </select>
          </Field>

          {reasoningDescriptor ? (
            <Field label="推理强度">
              <select
                className={selectClassName}
                value={typeof reasoningValue === "string" ? reasoningValue : ""}
                onChange={(event) => handleReasoningChange(event.target.value)}
              >
                {reasoningDescriptor.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label="权限模式">
            <select
              className={selectClassName}
              value={runtimeMode}
              onChange={(event) => setRuntimeMode(event.target.value as RuntimeMode)}
            >
              {Object.entries(RUNTIME_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          {permissionProfiles.length > 0 ? (
            <Field label="权限 Profile">
              <select
                className={selectClassName}
                value={permissionProfileId}
                onChange={(event) => setPermissionProfileId(event.target.value)}
              >
                <option value="">按权限模式</option>
                <option value={CLEAR_OVERRIDE}>清除已选 Profile</option>
                {permissionProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.id}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label="工作目录">
            <input
              className={selectClassName}
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="使用当前项目目录"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="个性">
              <select
                className={selectClassName}
                value={personality}
                onChange={(event) =>
                  setPersonality(event.target.value as "" | typeof CLEAR_OVERRIDE | Personality)
                }
              >
                <option value="">保持不变</option>
                <option value={CLEAR_OVERRIDE}>清除覆盖</option>
                <option value="none">none</option>
                <option value="friendly">friendly</option>
                <option value="pragmatic">pragmatic</option>
              </select>
            </Field>
            <Field label="推理摘要">
              <select
                className={selectClassName}
                value={reasoningSummary}
                onChange={(event) =>
                  setReasoningSummary(
                    event.target.value as "" | typeof CLEAR_OVERRIDE | ReasoningSummary,
                  )
                }
              >
                <option value="">保持不变</option>
                <option value={CLEAR_OVERRIDE}>清除覆盖</option>
                <option value="auto">auto</option>
                <option value="concise">concise</option>
                <option value="detailed">detailed</option>
                <option value="none">none</option>
              </select>
            </Field>
          </div>

          <Field label="服务档位">
            <select
              className={selectClassName}
              value={serviceTier}
              onChange={(event) => setServiceTier(event.target.value)}
            >
              <option value="">保持不变</option>
              <option value={CLEAR_OVERRIDE}>清除覆盖</option>
              <option value="fast">fast</option>
            </select>
          </Field>

          {error ? <div className="text-xs text-destructive">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || !canSyncProviderSettings}
              onClick={() => void handleSave()}
            >
              {saving ? "保存中" : "保存"}
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});

function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

const selectClassName = cn(
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
);
