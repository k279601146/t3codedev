# 本地服务 URL 临时切换提醒

当前开发阶段，根目录环境变量已临时指向本地服务：

```env
MYIDE_WEB_AUTH_BASE_URL=http://localhost:3001/
MYIDE_GATEWAY_BASE_URL=http://localhost:3000
```

## 上线前必须恢复

正式上线前检查并恢复以下位置：

- `.env`
- `.env.example`
- 部署平台或打包流水线中注入的同名环境变量

建议恢复为当前线上默认值：

```env
MYIDE_WEB_AUTH_BASE_URL=https://www.bahew.com/
MYIDE_GATEWAY_BASE_URL=https://sub.bahew.com/v1
```

## 地址语义

- `MYIDE_WEB_AUTH_BASE_URL` 是 Web 认证服务根地址，程序会自动拼接 `/ide/auth/authorize`。
- `MYIDE_GATEWAY_BASE_URL` 是 sub2api 网关地址。填写根地址时，OpenAI 兼容模型调用会自动使用 `/v1`；登录换取 IDE token、用量和账户接口会使用网关根地址。
- 如果未来线上网关不再使用 `/v1` 作为 OpenAI 兼容前缀，需要同步检查 `packages/shared/src/commercialEngine.ts` 中的 `resolveCommercialEngineOpenAiBaseUrl`。
