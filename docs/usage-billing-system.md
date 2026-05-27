# T3 Code 用量计量与计费体系

本文档描述当前项目内置的计量计费雏形，供后续接入真实支付、订阅套餐和商业化网站时使用。

## 目标

T3 Code 采用类似 Gemini 的“计算用量限额”模型：所有用户都有可消费的 units，用量窗口每 5 小时刷新，同时保留每周总上限。超过任一窗口后，网关应拒绝继续调用高级模型或要求用户升级订阅。

客户端不保存真实 AI 提供方密钥。用户登录后持有的是 IDE JWT，AI 请求进入 sub2api 网关后由服务端验证、扣量、转发。

## 套餐模型

| 套餐 | 展示名称 | 限额倍率 |
| --- | --- | --- |
| `free` | 未订阅方案 | 标准限额的 1 倍 |
| `plus` | AI Plus | 标准限额的 2 倍 |
| `pro` | AI Pro | 标准限额的 4 倍 |

当前内置基线用于本地展示兜底：

| 窗口 | 标准限额 |
| --- | --- |
| 5 小时窗口 | 100 units |
| 每周窗口 | 700 units |

真实上线时，sub2api 应返回服务端配置的准确限额，客户端只负责展示。

## units 计量口径

当前版本以 `unit` 作为产品层计量单位，避免直接把不同模型、不同功能的 token 等价处理。网关返回窗口字段时以网关为准；旧网关只返回 token 或请求数时，客户端不再把这些原始计数当成 used units，避免一个很短的请求被显示成已经消耗 1 unit。

建议服务端采用以下计量方式：

| 行为 | 建议计量 |
| --- | --- |
| 普通文本对话 | `raw_units = input_tokens / 1000 + output_tokens / 1000 * 2`，单次 `raw_units < 1` 时记为 `0`，否则按 `round(raw_units, 2)` 入账 |
| Pro 模型 | 在普通文本基础上乘以模型倍率，例如 2x 到 4x |
| 扩展思考 / Deep Think | 在普通文本基础上增加 reasoning token 权重 |
| 图片生成 | 每张图片按固定 units 或按模型返回成本换算 |
| 视频生成 | 按秒数、分辨率、模型等级换算 units |
| 音乐生成 | 按秒数、模型等级换算 units |
| Deep Research | 按检索次数、子任务次数和最终 token 一起折算 |

最终扣量必须由 sub2api 在服务端完成，客户端展示值不能作为计费依据。IDE JWT 请求不应因为账户余额为 `0` 被直接拦截；是否允许继续调用由 5 小时窗口和每周窗口的 units 限额决定。

## 当前代码实现

共享模型位于 `packages/contracts/src/model.ts`：

- `CommercialSubscriptionPlanSchema`
- `CommercialUsageWindowSchema`
- `CommercialAccountUsageSchema`

共享解析与兜底计算位于 `packages/shared/src/commercialUsage.ts`：

- `buildCommercialUsageLimitSnapshot`
- `buildCommercialAccountUsageSnapshot`
- `normalizeCommercialPlan`

桌面端通过 `apps/desktop/src/ipc/methods/gatewayModels.ts` 请求：

- `/api/v1/auth/me` 获取账户余额
- `/ide/api/usage` 获取 token 成本和窗口限额

服务端 Codex provider 通过 `apps/server/src/provider/Layers/CodexProvider.ts` 将商业用量合并进 provider 状态，Web 侧可以从 `provider.auth.rateLimits.usage` 读取。

Web 设置菜单位于 `apps/web/src/components/Sidebar.tsx`。底部设置按钮弹出的菜单会展示：

- 当前登录用户
- 当前套餐和倍率
- 5 小时窗口进度
- 每周窗口进度
- 升级、个人设置、订阅账单、帮助支持和退出登录入口

## `/ide/api/usage` 建议响应

```json
{
  "data": {
    "plan": "plus",
    "total_tokens": 21000150,
    "today_tokens": 122700,
    "total_actual_cost": 994.6604659,
    "today_actual_cost": 0.0312,
    "current_window": {
      "used_units": 122.7,
      "limit_units": 200,
      "resets_at": "2026-05-27T03:00:00.000Z"
    },
    "weekly_window": {
      "used_units": 333.7,
      "limit_units": 1400,
      "resets_at": "2026-06-01T00:00:00.000Z"
    }
  }
}
```

兼容字段：

- `plan_type` 可替代 `plan`
- `current_window_units` / `current_window_limit` / `current_window_resets_at` 可替代 `current_window`
- `weekly_units` / `weekly_limit` / `weekly_resets_at` 可替代 `weekly_window`

## 支付接入边界

未来接 Stripe、支付宝、微信支付或自研订阅系统时，建议分工如下：

- 支付系统负责订单、发票、订阅状态、续费失败和退款。
- sub2api 负责把订阅状态映射为 `plan`、倍率、窗口限额，并在请求前做配额检查。
- T3 Code 客户端只展示状态和打开升级/账单网页，不直接决定是否可用。

## 安全要求

- 客户端只持有 IDE JWT。
- 所有扣量和余额判断必须在 sub2api 服务端完成。
- 日志只记录用量 metadata，不记录用户 prompt、代码内容或真实上游密钥。
