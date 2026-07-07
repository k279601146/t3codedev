# T3 Code 用量计量与计费体系

更新时间：2026-07-07

T3 Code 的登录、IDE JWT、模型请求入口、模型列表、账户余额、5 小时窗口、每周窗口和扣费都以 dev2 为后端。dev2 Web/API 的资产权威已经迁移到 dev2 本地数据库；计费、扣费、5 小时窗口、每周窗口、余额、奖励和退款只以 `D:\workspace\dev2_OpenHarness_SaaS\docs\dev2-local-billing-authority.md` 为准。

## 当前边界

T3 Code 客户端负责：

- 打开 dev2 Web 授权页。
- 安全保存 dev2 签发的 IDE JWT。
- 把 `MYIDE_IDE_JWT` 注入 app-server / ai-engine 子进程。
- 从 dev2 查询模型列表、账户余额和 usage 窗口。
- 展示余额不足、窗口超限、模型不可用等错误。

dev2 负责：

- 签发 IDE authorization code 和 IDE JWT。
- 用本地 IDE session 记录 IDE JWT 的 `jti`，支持撤销、过期和用户停用校验。
- 暴露 OpenAI-compatible `/v1/models`、`/v1/responses`、`/v1/chat/completions`。
- 在后台 “T3 Code 客户端” 菜单维护专用 upstream `base_url`、API key、模型白名单、输出 token 上限和超时。
- 请求前做本地额度预检。
- 请求后解析 upstream usage，并按本地账务规则写 `ResourceLog`、`BillingLedgerEntry` 和 `BillingAccount`。

T3 Code 不保存真实 AI 提供方密钥，不保存真实 upstream Base URL，不用客户端上报值作为扣费依据。

## 套餐和窗口

套餐语义沿用 dev2：

| 套餐 | 展示名称 | 限额倍率 |
| --- | --- | --- |
| `free` | Free | 标准限额 1 倍 |
| `plus` | AI Plus | 按 dev2 配置 |
| `pro` | AI Pro | 按 dev2 配置 |

窗口默认基线以 dev2 为准：

| 窗口 | 默认标准限额 |
| --- | --- |
| 5 小时窗口 | 100 units |
| 每周窗口 | 700 units |

客户端展示窗口进度，但最终放行或拒绝由 dev2 代理返回决定。

## 请求路径

```text
MYIDE_WEB_AUTH_BASE_URL -> dev2 Web
MYIDE_GATEWAY_BASE_URL  -> dev2 /v1 billing proxy
```

关键接口：

- `POST /ide/auth/token`
- `GET /api/v1/auth/me`
- `GET /ide/api/usage`
- `GET /ide/api/usage/stats`
- `GET /ide/api/usage/trend`
- `GET /ide/api/usage/models`
- `GET /v1/models`
- `POST /v1/responses`
- `POST /v1/chat/completions`
- `POST /ide/api/telemetry`
- `POST /ide/api/installations/heartbeat`

## `/ide/api/usage` 响应

客户端从 dev2 读取本地聚合结果，兼容字段如下：

```json
{
  "data": {
    "provider": "dev2",
    "plan": "free",
    "balance": 0,
    "total_tokens": 21000150,
    "today_tokens": 122700,
    "total_actual_cost": 994.66,
    "today_actual_cost": 0.03,
    "current_window": {
      "used_units": 122.7,
      "limit_units": 200,
      "remaining_units": 77.3,
      "resets_at": "2026-05-27T03:00:00Z"
    },
    "weekly_window": {
      "used_units": 333.7,
      "limit_units": 1400,
      "remaining_units": 1066.3,
      "resets_at": "2026-06-01T00:00:00Z"
    }
  }
}
```

兼容字段：

- `plan_type` 可替代 `plan`
- `current_window_units` / `current_window_limit` / `current_window_resets_at` 可替代 `current_window`
- `weekly_units` / `weekly_limit` / `weekly_resets_at` 可替代 `weekly_window`

## 安全要求

- `MYIDE_IDE_JWT` 不进入 shell include list，不进入普通前端页面状态。
- `MYIDE_IDE_JWT` 必须来自 dev2 PKCE 授权码交换；撤销后 `/v1/*`、`/ide/api/*` 和 `/api/v1/auth/me` 都应返回 401。
- `CODEX_OPENAI_BASE_URL`、`OPENAI_BASE_URL` 和 `CODEX_MODEL_PROVIDERS_*_BASE_URL` 只能指向 dev2 `/v1`。
- 真实 upstream Base URL 和 API key 只在 dev2 后台 “T3 Code 客户端” 菜单的专用配置中保存，不能复用 dev2 全局 OpenAI 配置。
- usage 缺失、流式中断、upstream 失败或 dev2 扣费失败时，dev2 fail closed。
- 客户端 usage gate 只做用户体验预阻断，不作为计费权威。
