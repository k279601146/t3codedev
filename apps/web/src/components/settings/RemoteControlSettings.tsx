import {
  LinkIcon,
  LoaderIcon,
  PowerIcon,
  RefreshCwIcon,
  SaveIcon,
  SmartphoneIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QqBotConfig,
  RemoteControlPairingSession,
  RemoteControlSnapshot,
} from "@t3tools/contracts";

import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { QRCodeSvg } from "../ui/qr-code";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: RemoteControlSnapshot }
  | { readonly status: "error"; readonly message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败。";
}

function formatUnixSeconds(value: number | null): string {
  if (!value) {
    return "未知";
  }
  return new Date(value * 1000).toLocaleString();
}

function formatOptionalText(value: string | null | undefined): string {
  return value && value.trim() ? value : "未设置";
}

export function buildPairingQrPayload(session: RemoteControlPairingSession): string {
  const code = session.manualPairingCode ?? session.pairingCode;
  const params = new URLSearchParams({
    code,
    environmentId: session.environmentId,
  });
  return `t3code://remote-control/bind?${params.toString()}`;
}

function BotConfigForm({
  config,
  disabled,
  onSaved,
}: {
  config: QqBotConfig;
  disabled: boolean;
  onSaved: (config: QqBotConfig) => void;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [appId, setAppId] = useState(config.appId ?? "");
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(config.enabled);
    setAppId(config.appId ?? "");
    setSecret("");
    setToken("");
  }, [config]);

  const handleSave = useCallback(() => {
    setSaving(true);
    void ensureLocalApi()
      .remoteControl.updateQqBotConfig({
        enabled,
        appId: appId.trim() || null,
        ...(secret.trim() ? { secret } : {}),
        ...(token.trim() ? { token } : {}),
      })
      .then((nextConfig) => {
        onSaved(nextConfig);
        toastManager.add({ type: "success", title: "QQ Bot 配置已保存" });
      })
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "保存 QQ Bot 配置失败",
            description: errorMessage(error),
          }),
        );
      })
      .finally(() => setSaving(false));
  }, [appId, enabled, onSaved, secret, token]);

  return (
    <div className="grid gap-3 pb-4 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <label className="grid gap-1.5 text-xs font-medium text-foreground/80">
        App ID
        <Input
          value={appId}
          disabled={disabled || saving}
          placeholder="QQ Bot App ID"
          onChange={(event) => setAppId(event.target.value)}
        />
      </label>
      <div className="flex items-end gap-3">
        <label className="grid min-w-0 flex-1 gap-1.5 text-xs font-medium text-foreground/80">
          启用
          <div className="flex h-9 items-center">
            <Switch checked={enabled} disabled={disabled || saving} onCheckedChange={setEnabled} />
          </div>
        </label>
        <Button size="sm" disabled={disabled || saving} onClick={handleSave}>
          {saving ? (
            <LoaderIcon className="size-3.5 animate-spin" />
          ) : (
            <SaveIcon className="size-3.5" />
          )}
          保存
        </Button>
      </div>
      <label className="grid gap-1.5 text-xs font-medium text-foreground/80">
        App Secret
        <Input
          type="password"
          value={secret}
          disabled={disabled || saving}
          placeholder={config.secretConfigured ? "已保存，留空不修改" : "QQ Bot App Secret"}
          onChange={(event) => setSecret(event.target.value)}
        />
      </label>
      <label className="grid gap-1.5 text-xs font-medium text-foreground/80">
        Token
        <Input
          type="password"
          value={token}
          disabled={disabled || saving}
          placeholder={config.tokenConfigured ? "已保存，留空不修改" : "QQ Bot Token"}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
    </div>
  );
}

export function RemoteControlSettingsPanel() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [pairing, setPairing] = useState<RemoteControlPairingSession | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const snapshot = state.status === "ready" ? state.snapshot : null;
  const pairingCode = pairing?.manualPairingCode ?? pairing?.pairingCode ?? null;
  const pairingQrPayload = useMemo(
    () => (pairing ? buildPairingQrPayload(pairing) : null),
    [pairing],
  );

  const reload = useCallback(() => {
    setState({ status: "loading" });
    void ensureLocalApi()
      .remoteControl.getSnapshot()
      .then((nextSnapshot) => setState({ status: "ready", snapshot: nextSnapshot }))
      .catch((error) => setState({ status: "error", message: errorMessage(error) }));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const updateSnapshot = useCallback((patch: Partial<RemoteControlSnapshot>) => {
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", snapshot: { ...current.snapshot, ...patch } }
        : current,
    );
  }, []);

  const runAction = useCallback((name: string, action: () => Promise<void>) => {
    setBusyAction(name);
    void action()
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "远程控制操作失败",
            description: errorMessage(error),
          }),
        );
      })
      .finally(() => setBusyAction(null));
  }, []);

  const disabled = state.status !== "ready" || busyAction !== null;

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Codex 远程控制"
        icon={<SmartphoneIcon className="size-3.5" />}
        headerAction={
          <Button size="icon-xs" variant="ghost" aria-label="刷新远程控制" onClick={reload}>
            <RefreshCwIcon className="size-3.5" />
          </Button>
        }
      >
        <SettingsRow
          title="连接状态"
          description="状态来自 Codex app-server remoteControl/status/read。"
          status={
            state.status === "loading"
              ? "读取中..."
              : state.status === "error"
                ? state.message
                : `server=${snapshot?.status.serverName} · installation=${snapshot?.status.installationId}`
          }
          control={
            <div className="flex items-center gap-2">
              <span className="rounded-sm border px-2 py-1 text-xs text-muted-foreground">
                {snapshot?.status.status ?? "unknown"}
              </span>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() =>
                  runAction("enable", async () => {
                    const status = await ensureLocalApi().remoteControl.enable({
                      ephemeral: false,
                    });
                    updateSnapshot({ status });
                  })
                }
              >
                <PowerIcon className="size-3.5" />
                启用
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  runAction("disable", async () => {
                    const status = await ensureLocalApi().remoteControl.disable({
                      ephemeral: false,
                    });
                    updateSnapshot({ status });
                    setPairing(null);
                  })
                }
              >
                停用
              </Button>
            </div>
          }
        />
        <SettingsRow
          title="QQ 扫码绑定"
          description="生成 Codex remoteControl/pairing/start 手动绑定码，QQ 端发送 /bind <code> 完成绑定。"
          control={
            <Button
              size="sm"
              disabled={disabled}
              onClick={() =>
                runAction("pairing", async () => {
                  const status = await ensureLocalApi().remoteControl.enable({
                    ephemeral: false,
                  });
                  const session = await ensureLocalApi().remoteControl.startPairing({
                    manualCode: true,
                  });
                  updateSnapshot({ status });
                  setPairing(session);
                })
              }
            >
              <LinkIcon className="size-3.5" />
              生成绑定码
            </Button>
          }
        >
          {pairing && pairingCode && pairingQrPayload ? (
            <div className="grid gap-4 pb-4 pt-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <div className="flex size-40 items-center justify-center rounded-lg border bg-white p-3">
                <QRCodeSvg
                  value={pairingQrPayload}
                  size={136}
                  marginSize={2}
                  title="远程控制绑定二维码"
                />
              </div>
              <div className="min-w-0 space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground">绑定码</div>
                  <div className="mt-1 select-all break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-lg font-semibold tracking-[0.08em]">
                    {pairingCode}
                  </div>
                </div>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <span>QQ 指令：/bind {pairingCode}</span>
                  <span>环境：{pairing.environmentId}</span>
                  <span>过期时间：{formatUnixSeconds(pairing.expiresAt)}</span>
                </div>
              </div>
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      {snapshot ? (
        <>
          <SettingsSection title="QQ Bot">
            <SettingsRow
              title="官方 Bot 配置"
              description={`Webhook 路径：${snapshot.qqBot.webhookPath}`}
              status={`secret=${snapshot.qqBot.secretConfigured ? "已保存" : "未保存"} · token=${
                snapshot.qqBot.tokenConfigured ? "已保存" : "未保存"
              }`}
            >
              <BotConfigForm
                config={snapshot.qqBot}
                disabled={busyAction !== null}
                onSaved={(qqBot) => updateSnapshot({ qqBot })}
              />
            </SettingsRow>
            <SettingsRow
              title="已绑定 QQ 身份"
              description="绑定记录保存在 server secret store，撤销后该 QQ 身份不能继续控制当前环境。"
            >
              <div className="divide-y divide-border/60 pt-2">
                {snapshot.bindings.length === 0 ? (
                  <div className="pb-4 text-xs text-muted-foreground">暂无绑定。</div>
                ) : (
                  snapshot.bindings.map((binding) => (
                    <div
                      key={binding.id}
                      className="flex min-w-0 items-center gap-3 py-3 first:pt-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {formatOptionalText(binding.displayName)} · {binding.qqUserId}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          群：{formatOptionalText(binding.qqGroupId)} · 环境：
                          {binding.environmentId}
                        </div>
                      </div>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="撤销 QQ 绑定"
                        disabled={busyAction !== null}
                        onClick={() =>
                          runAction("revoke-qq-binding", async () => {
                            const result = await ensureLocalApi().remoteControl.revokeQqBinding({
                              bindingId: binding.id,
                            });
                            updateSnapshot({ bindings: result.bindings });
                          })
                        }
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Codex Remote Clients">
            <SettingsRow
              title="已授权客户端"
              description="列表来自 Codex app-server remoteControl/client/list，撤销会调用 remoteControl/client/revoke。"
            >
              <div className="divide-y divide-border/60 pt-2">
                {snapshot.clients.length === 0 ? (
                  <div className="pb-4 text-xs text-muted-foreground">暂无远程客户端。</div>
                ) : (
                  snapshot.clients.map((client) => (
                    <div
                      key={client.clientId}
                      className="flex min-w-0 items-center gap-3 py-3 first:pt-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {formatOptionalText(client.displayName)} · {client.clientId}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {formatOptionalText(client.platform)} ·{" "}
                          {formatOptionalText(client.deviceModel)} · 最近：
                          {formatUnixSeconds(client.lastSeenAt)}
                        </div>
                      </div>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="撤销远程客户端"
                        disabled={busyAction !== null || !snapshot.status.environmentId}
                        onClick={() =>
                          runAction("revoke-client", async () => {
                            if (!snapshot.status.environmentId) return;
                            await ensureLocalApi().remoteControl.revokeClient({
                              environmentId: snapshot.status.environmentId,
                              clientId: client.clientId,
                            });
                            updateSnapshot({
                              clients: snapshot.clients.filter(
                                (current) => current.clientId !== client.clientId,
                              ),
                            });
                          })
                        }
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : null}
    </SettingsPageContainer>
  );
}
