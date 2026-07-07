# 本地服务 URL 切换提醒

当前 T3 Code 商业化后端全量指向 dev2，不再默认依赖 sub2api。

本地开发推荐：

```env
MYIDE_WEB_AUTH_BASE_URL=http://localhost:3001
MYIDE_GATEWAY_BASE_URL=http://localhost:8000/v1
```

线上默认：

```env
MYIDE_WEB_AUTH_BASE_URL=https://www.bahew.com
MYIDE_GATEWAY_BASE_URL=https://www.bahew.com/v1
```

## 地址语义

- `MYIDE_WEB_AUTH_BASE_URL` 是 dev2 Web 根地址，程序会自动拼接 `/ide/auth/authorize`。
- `MYIDE_GATEWAY_BASE_URL` 变量名保留，但语义已经改为 “dev2 billing proxy base URL”，不是 sub2api 网关地址。
- 登录 token exchange、模型列表、账户余额、usage 窗口、遥测和模型请求都走 dev2。
- `CODEX_OPENAI_BASE_URL`、`OPENAI_BASE_URL`、`CODEX_MODEL_PROVIDERS_*_BASE_URL` 会由运行时注入为 dev2 `/v1`，不得配置为真实第三方 upstream。
- 真实 upstream Base URL 和 API key 在 dev2 后台 “T3 Code 客户端” 菜单配置，不进入客户端环境变量。

如果线上 API 域名与 Web 域名不同，部署或打包流水线应显式覆盖 `MYIDE_GATEWAY_BASE_URL`，但仍必须指向 dev2 计费代理。
