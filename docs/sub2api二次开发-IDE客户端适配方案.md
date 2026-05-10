# sub2api 二次开发方案

## 面向 AI 编程助手 IDE 客户端的适配与扩展

> **文档版本**：1.0  
> **更新日期**：2025 年 5 月  
> **上游仓库**：[Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)  
> **关联文档**：商业化AI编程助手-最佳实践与后续开发方案-v3.md  
> **技术栈**：Go 后端（Gin + Ent ORM）· Vue3 前端（pnpm）· PostgreSQL 16 · Redis

---

## 目录

1. [整体策略：Fork 还是外挂？](#一整体策略fork-还是外挂)
2. [sub2api 现有能力盘点](#二sub2api-现有能力盘点)
3. [需要扩展的能力清单](#三需要扩展的能力清单)
4. [开发环境搭建](#四开发环境搭建)
5. [Dev 1：IDE 客户端专用认证接口](#dev-1ide-客户端专用认证接口)
6. [Dev 2：JWT 令牌体系（替代 API Key）](#dev-2jwt-令牌体系替代-api-key)
7. [Dev 3：IDE 用量查询接口](#dev-3ide-用量查询接口)
8. [Dev 4：套餐与订阅管理接口](#dev-4套餐与订阅管理接口)
9. [Dev 5：IDE 客户端版本与更新管理接口](#dev-5ide-客户端版本与更新管理接口)
10. [Dev 6：codex / t3code 兼容性适配](#dev-6codext3code-兼容性适配)
11. [Dev 7：管理后台扩展（Vue3）](#dev-7管理后台扩展vue3)
12. [部署与运维](#八部署与运维)
13. [开发优先级与工作量估算](#九开发优先级与工作量估算)

---

# 一、整体策略：Fork 还是外挂？

## 推荐方案：Fork + 薄业务层并行

sub2api 是一个编译型 Go 项目，**不能通过插件方式扩展**，必须 Fork 后在源码上修改。推荐的工程结构如下：

```
你的系统
├── sub2api-fork/               # Fork 自 Wei-Shaw/sub2api，主要改动在这里
│   ├── backend/                # Go 后端（主要扩展点）
│   │   ├── internal/
│   │   │   ├── handler/        # ← 在这里新增 IDE 专用 Handler
│   │   │   ├── service/        # ← 在这里新增业务逻辑
│   │   │   └── middleware/     # ← 在这里新增 JWT 中间件
│   │   └── ent/schema/         # ← 在这里新增数据库 Schema
│   └── frontend/               # Vue3 管理后台（新增 IDE 管理页面）
│
└── ide-biz-layer/              # 可选：薄业务层（Node.js/Hono）
    │   # 仅处理：付款回调、邮件发送、注册邀请码等
    │   # AI 请求完全走 sub2api-fork，不经过这里
    └── ...
```

**为什么不完全自研而是 Fork sub2api？**

sub2api 已经做好了最难的部分：多账号调度、粘性会话、上游负载均衡、并发控制、OpenAI 兼容协议层。这些自研至少要 3 个月。你只需要在它的基础上加 IDE 特有的接口。

**Fork 后的同步策略：**

```bash
# 添加上游 remote，定期同步上游更新
git remote add upstream https://github.com/Wei-Shaw/sub2api.git

# 定期拉取上游改动（建议每两周一次）
git fetch upstream
git checkout main
git merge upstream/main  # 或 rebase

# 你的改动都在独立的 feature 分支或专用文件里，减少冲突
```

---

# 二、sub2api 现有能力盘点

在开始开发前，先明确 sub2api **原生已有**哪些能力，避免重复造轮子：

| 能力                                         | sub2api 是否已有 | IDE 项目是否需要改动               |
| -------------------------------------------- | ---------------- | ---------------------------------- |
| OpenAI 兼容 API 转发                         | ✅ 完整支持      | 无需改动，codex-rs 直接对接        |
| 多上游账号管理（OAuth/API Key）              | ✅               | 无需改动，管理员后台配置即可       |
| 粘性会话（同一会话路由到同账号）             | ✅               | 无需改动                           |
| API Key 分发给用户                           | ✅               | **需要替换为 JWT 方案**            |
| Token 级用量追踪                             | ✅               | 无需改动，接 IDE 查询接口即可      |
| 并发控制（per-user）                         | ✅               | 无需改动，配置即可                 |
| 内置支付（EasyPay / 支付宝 / 微信 / Stripe） | ✅               | 无需改动，配置即可                 |
| 管理员后台 Web UI                            | ✅ Vue3          | **需要新增 IDE 专属管理页面**      |
| 用户注册/登录（Web 端）                      | ✅               | **需要新增 IDE 客户端 OAuth 流程** |
| 邮箱验证码登录                               | ✅               | 可直接复用                         |
| GitHub/Google 快捷登录                       | ✅（v0.1.125+）  | 可直接复用                         |
| 频道（渠道）监控                             | ✅               | 无需改动                           |
| 内容风险控制                                 | ✅（v0.1.125+）  | 无需改动，配置即可                 |
| **IDE 客户端版本管理**                       | ❌               | **需要新增**                       |
| **引擎二进制版本管理**                       | ❌               | **需要新增**                       |
| **IDE 专用 JWT 认证**                        | ❌               | **需要新增**                       |
| **套餐/功能权限与 IDE 特性绑定**             | ❌               | **需要新增**                       |
| **客户端健康/诊断上报**                      | ❌               | **需要新增**                       |

---

# 三、需要扩展的能力清单

归纳为以下 7 个开发项：

| #     | 开发项                                | 改动位置                | 优先级 |
| ----- | ------------------------------------- | ----------------------- | ------ |
| Dev 1 | IDE 客户端专用认证接口                | Go backend + Ent Schema | P0     |
| Dev 2 | JWT 令牌体系（替代 API Key 直接传输） | Go backend middleware   | P0     |
| Dev 3 | IDE 用量查询接口                      | Go backend handler      | P1     |
| Dev 4 | 套餐与订阅管理接口                    | Go backend handler      | P1     |
| Dev 5 | 客户端/引擎版本管理接口               | Go backend + Ent Schema | P1     |
| Dev 6 | codex / t3code 兼容性适配             | Go backend              | P0     |
| Dev 7 | 管理后台扩展                          | Vue3 frontend           | P2     |

---

# 四、开发环境搭建

## 4.1 Fork 并克隆

```bash
# 1. 在 GitHub 上 Fork Wei-Shaw/sub2api 到你的账号
# 2. 克隆你的 Fork
git clone https://github.com/your-org/sub2api-myide.git
cd sub2api-myide

# 3. 添加上游
git remote add upstream https://github.com/Wei-Shaw/sub2api.git
```

## 4.2 依赖安装

```bash
# 后端依赖（Go 1.25+）
cd backend
go mod download

# 前端依赖（必须用 pnpm，不能用 npm）
cd ../frontend
pnpm install
```

## 4.3 数据库初始化

```bash
# 启动 PostgreSQL 16 和 Redis
docker compose -f deploy/docker-compose.local.yml up -d postgres redis

# 初始化数据库
cd backend
go run cmd/server/main.go --migrate
```

## 4.4 本地开发启动

```bash
# 后端（热重载，使用 air）
cd backend
go install github.com/air-verse/air@latest
air

# 前端
cd frontend
pnpm dev
```

## 4.5 新增文件的约定

所有 IDE 相关的扩展，**集中在独立文件**中，减少与上游的合并冲突：

```
backend/internal/
├── handler/
│   ├── ...（上游文件，不动）
│   └── ide/                    # ← 你新增的 IDE 专用 handler 目录
│       ├── auth_handler.go
│       ├── usage_handler.go
│       ├── plan_handler.go
│       └── version_handler.go
├── service/
│   ├── ...（上游文件，不动）
│   └── ide/                    # ← 你新增的 IDE 专用 service 目录
│       ├── auth_service.go
│       ├── usage_service.go
│       └── version_service.go
└── middleware/
    ├── ...（上游文件，不动）
    └── ide_jwt.go              # ← IDE JWT 中间件
```

---

# Dev 1：IDE 客户端专用认证接口

## 背景

sub2api 原生的用户认证是面向 Web 浏览器的（Session Cookie / Web 登录页）。IDE 客户端需要一套**面向桌面应用的 OAuth PKCE 流程**，返回 JWT，客户端后续用 JWT 访问 AI 接口。

## 1.1 新增数据库 Schema

在 `backend/ent/schema/` 下新增 `ide_session.go`（不修改上游 Schema，新增文件）：

```go
// backend/ent/schema/ide_session.go
package schema

import (
    "entgo.io/ent"
    "entgo.io/ent/schema/field"
    "entgo.io/ent/schema/edge"
    "entgo.io/ent/schema/index"
)

// IDESession 存储 IDE 客户端的认证会话
type IDESession struct {
    ent.Schema
}

func (IDESession) Fields() []ent.Field {
    return []ent.Field{
        field.String("id").Unique().Immutable(),              // session UUID
        field.String("user_id").NotEmpty(),                   // 关联用户
        field.String("jwt_token").Unique().Sensitive(),       // 签发的 JWT（哈希存储）
        field.String("jwt_token_hash").Unique(),              // JWT SHA256 哈希（用于查找）
        field.String("client_version").Optional(),            // IDE 版本号（如 "1.2.3"）
        field.String("platform").Optional(),                  // "win32" | "darwin" | "linux"
        field.String("device_id").Optional(),                 // 客户端设备指纹
        field.Time("expires_at"),                             // JWT 过期时间
        field.Time("last_used_at").Optional(),                // 最后使用时间
        field.Bool("revoked").Default(false),                 // 是否已吊销
        field.String("revoke_reason").Optional(),             // 吊销原因
        field.Time("created_at").Immutable(),
    }
}

func (IDESession) Edges() []ent.Edge {
    return []ent.Edge{
        edge.From("user", User.Type).Ref("ide_sessions").Field("user_id").Unique().Required(),
    }
}

func (IDESession) Indexes() []ent.Index {
    return []ent.Index{
        index.Fields("jwt_token_hash"),
        index.Fields("user_id", "revoked"),
    }
}
```

```bash
# Schema 修改后必须重新生成
cd backend
go generate ./ent
```

## 1.2 IDE 登录流程：OAuth PKCE

IDE 客户端使用 **PKCE（Proof Key for Code Exchange）** 流程，避免在客户端存储 client_secret：

```
IDE 客户端                        sub2api 后端                    浏览器（用户操作）
    │                                  │                               │
    │ 1. 生成 code_verifier            │                               │
    │    code_challenge = SHA256(verifier)                              │
    │                                  │                               │
    │ 2. 打开系统浏览器                  │                               │
    │    https://api.yourservice.com   │                               │
    │    /ide/auth/authorize?          │                               │
    │    code_challenge=xxx&           │                               │
    │    redirect_uri=myide://callback │                               │
    │─────────────────────────────────►│                               │
    │                                  │                               │
    │                                  │ 3. 展示登录页面 ──────────────►│
    │                                  │                               │
    │                                  │◄── 4. 用户完成登录 ────────────│
    │                                  │                               │
    │                                  │ 5. 生成 auth_code             │
    │                                  │    重定向到 myide://callback   │
    │◄─────────────────────────────────│                               │
    │ 6. 客户端接收 auth_code           │                               │
    │                                  │                               │
    │ 7. POST /ide/auth/token          │                               │
    │    { code, code_verifier }       │                               │
    │─────────────────────────────────►│                               │
    │                                  │ 8. 验证 code + verifier       │
    │                                  │    签发 JWT                   │
    │◄─────────────────────────────────│                               │
    │ 9. 存储 JWT，后续 AI 请求携带      │                               │
```

## 1.3 后端实现

```go
// backend/internal/handler/ide/auth_handler.go
package ide

import (
    "crypto/sha256"
    "encoding/base64"
    "net/http"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/google/uuid"
)

type AuthHandler struct {
    authService IDEAuthService
}

// Step 1: 客户端发起授权请求，后端存储 code_challenge，返回登录页 URL
// GET /ide/auth/authorize?code_challenge=xxx&code_challenge_method=S256&redirect_uri=myide://callback&client_id=myide-desktop
func (h *AuthHandler) Authorize(c *gin.Context) {
    codeChallenge := c.Query("code_challenge")
    redirectURI := c.Query("redirect_uri")
    clientID := c.Query("client_id")

    if codeChallenge == "" || redirectURI == "" {
        c.JSON(http.StatusBadRequest, gin.H{"error": "missing required params"})
        return
    }

    // 验证 redirect_uri 白名单（防止重定向劫持）
    if !isAllowedRedirectURI(redirectURI) {
        c.JSON(http.StatusBadRequest, gin.H{"error": "invalid redirect_uri"})
        return
    }

    // 生成 auth_state，存入 Redis（5 分钟有效）
    state := uuid.NewString()
    h.authService.StoreAuthState(state, AuthState{
        CodeChallenge: codeChallenge,
        RedirectURI:   redirectURI,
        ClientID:      clientID,
        ExpiresAt:     time.Now().Add(5 * time.Minute),
    })

    // 重定向到 sub2api 的 Web 登录页，登录成功后回调 /ide/auth/callback
    loginURL := buildWebLoginURL(state)
    c.Redirect(http.StatusFound, loginURL)
}

// Step 2: Web 登录成功后的回调，生成 auth_code，重定向回 IDE 客户端
// GET /ide/auth/callback?state=xxx&user_id=xxx（内部回调，由登录成功的 handler 调用）
func (h *AuthHandler) Callback(c *gin.Context) {
    state := c.Query("state")
    userID := c.Query("user_id")

    authState, err := h.authService.GetAuthState(state)
    if err != nil || time.Now().After(authState.ExpiresAt) {
        c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or expired state"})
        return
    }

    // 生成一次性 auth_code，存入 Redis（1 分钟有效）
    authCode := generateSecureCode()
    h.authService.StoreAuthCode(authCode, AuthCode{
        UserID:        userID,
        CodeChallenge: authState.CodeChallenge,
        ExpiresAt:     time.Now().Add(1 * time.Minute),
    })

    // 重定向回 IDE 客户端（自定义协议）
    redirectURL := authState.RedirectURI + "?code=" + authCode
    c.Redirect(http.StatusFound, redirectURL)
}

// Step 3: 客户端用 auth_code + code_verifier 换取 JWT
// POST /ide/auth/token
func (h *AuthHandler) Token(c *gin.Context) {
    var req struct {
        Code          string `json:"code" binding:"required"`
        CodeVerifier  string `json:"code_verifier" binding:"required"`
        ClientID      string `json:"client_id" binding:"required"`
        ClientVersion string `json:"client_version"`
        Platform      string `json:"platform"`
        DeviceID      string `json:"device_id"`
    }
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    // 取出 auth_code
    authCode, err := h.authService.GetAuthCode(req.Code)
    if err != nil || time.Now().After(authCode.ExpiresAt) {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired code"})
        return
    }

    // 验证 PKCE：SHA256(code_verifier) == code_challenge
    hash := sha256.Sum256([]byte(req.CodeVerifier))
    computed := base64.RawURLEncoding.EncodeToString(hash[:])
    if computed != authCode.CodeChallenge {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "code_verifier mismatch"})
        return
    }

    // 用完即销毁（防重放）
    h.authService.DeleteAuthCode(req.Code)

    // 查询用户信息与套餐
    user, err := h.authService.GetUser(authCode.UserID)
    if err != nil || user.Status != "active" {
        c.JSON(http.StatusForbidden, gin.H{"error": "account not active"})
        return
    }

    // 签发 JWT（有效期 30 天，可配置）
    jwt, jwtHash, expiresAt, err := h.authService.IssueJWT(user)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
        return
    }

    // 记录 IDE Session
    h.authService.CreateIDESession(IDESessionInput{
        UserID:        authCode.UserID,
        JWTToken:      jwt,
        JWTTokenHash:  jwtHash,
        ClientVersion: req.ClientVersion,
        Platform:      req.Platform,
        DeviceID:      req.DeviceID,
        ExpiresAt:     expiresAt,
    })

    c.JSON(http.StatusOK, gin.H{
        "access_token":  jwt,
        "token_type":    "Bearer",
        "expires_in":    int(time.Until(expiresAt).Seconds()),
        "expires_at":    expiresAt.Unix(),
        // 不返回 refresh_token，到期重新登录（IDE 场景用户接受度高）
    })
}

// 吊销 Token（用户登出或管理员封号）
// POST /ide/auth/revoke
func (h *AuthHandler) Revoke(c *gin.Context) {
    userID := c.GetString("ide_user_id") // 由 JWT 中间件注入
    h.authService.RevokeAllSessions(userID, "user_logout")
    c.JSON(http.StatusOK, gin.H{"success": true})
}

// 允许的 redirect_uri 白名单
func isAllowedRedirectURI(uri string) bool {
    allowed := []string{
        "myide://callback",            // 生产环境自定义协议
        "http://127.0.0.1:49152/callback", // 开发环境 localhost
    }
    for _, a := range allowed {
        if uri == a {
            return true
        }
    }
    return false
}
```

## 1.4 路由注册

在 sub2api 的路由文件中新增 IDE 路由组（找到 `backend/internal/server/router.go` 或同等文件）：

```go
// 在路由初始化函数末尾追加，不修改上游路由
func registerIDERoutes(r *gin.Engine, handlers *IDEHandlers, jwtMiddleware gin.HandlerFunc) {
    ide := r.Group("/ide")
    {
        // 无需认证的接口
        auth := ide.Group("/auth")
        {
            auth.GET("/authorize", handlers.Auth.Authorize)
            auth.GET("/callback", handlers.Auth.Callback)
            auth.POST("/token", handlers.Auth.Token)
        }

        // 需要 IDE JWT 认证的接口
        api := ide.Group("/api", jwtMiddleware)
        {
            api.POST("/auth/revoke", handlers.Auth.Revoke)
            api.GET("/usage", handlers.Usage.GetUsage)
            api.GET("/plan", handlers.Plan.GetPlan)
            api.GET("/version/app", handlers.Version.GetAppVersion)
            api.GET("/version/engine", handlers.Version.GetEngineVersion)
            api.POST("/telemetry", handlers.Telemetry.Report)
        }
    }
}
```

---

# Dev 2：JWT 令牌体系（替代 API Key）

## 背景

sub2api 原生用自己生成的 **API Key**（如 `sk-xxxx`）作为用户访问凭证。IDE 客户端的需求是：用 **JWT** 直接作为 `OPENAI_API_KEY` 传入 codex-rs，网关识别后转换为真实 Key。

这样 **客户端存的 JWT 就是 API Key**，无需单独维护两套凭证。

## 2.1 JWT 签发

```go
// backend/internal/service/ide/jwt_service.go
package ide

import (
    "crypto/sha256"
    "encoding/hex"
    "time"

    "github.com/golang-jwt/jwt/v5"
)

type IDEClaims struct {
    UserID       string   `json:"sub"`
    Email        string   `json:"email"`
    PlanID       string   `json:"plan_id"`
    PlanFeatures []string `json:"features"`       // 套餐功能列表
    ModelTier    string   `json:"model_tier"`     // "free" | "pro" | "enterprise"
    jwt.RegisteredClaims
}

type JWTService struct {
    secret []byte
    ttl    time.Duration
}

func NewJWTService(secret string, ttlDays int) *JWTService {
    return &JWTService{
        secret: []byte(secret),
        ttl:    time.Duration(ttlDays) * 24 * time.Hour,
    }
}

func (s *JWTService) Issue(user *User) (tokenStr string, tokenHash string, expiresAt time.Time, err error) {
    expiresAt = time.Now().Add(s.ttl)

    claims := IDEClaims{
        UserID:       user.ID,
        Email:        user.Email,
        PlanID:       user.PlanID,
        PlanFeatures: getPlanFeatures(user.PlanID),
        ModelTier:    getModelTier(user.PlanID),
        RegisteredClaims: jwt.RegisteredClaims{
            Subject:   user.ID,
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            ExpiresAt: jwt.NewNumericDate(expiresAt),
            Issuer:    "myide-gateway",
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenStr, err = token.SignedString(s.secret)
    if err != nil {
        return
    }

    // 计算 hash 用于数据库存储和查找（不存明文）
    hash := sha256.Sum256([]byte(tokenStr))
    tokenHash = hex.EncodeToString(hash[:])
    return
}

func (s *JWTService) Verify(tokenStr string) (*IDEClaims, error) {
    token, err := jwt.ParseWithClaims(tokenStr, &IDEClaims{}, func(t *jwt.Token) (interface{}, error) {
        if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
        }
        return s.secret, nil
    })
    if err != nil {
        return nil, err
    }
    claims, ok := token.Claims.(*IDEClaims)
    if !ok || !token.Valid {
        return nil, fmt.Errorf("invalid token")
    }
    return claims, nil
}
```

## 2.2 JWT 中间件（核心：拦截 AI 请求）

这是最关键的改动：在 AI 请求路径上加一个中间件，**识别 JWT 格式的 Authorization，验证并更新最后使用时间，然后正常转发**。

sub2api 已有 API Key 验证中间件，找到它并**在其之前插入 JWT 识别逻辑**：

```go
// backend/internal/middleware/ide_jwt.go
package middleware

import (
    "crypto/sha256"
    "encoding/hex"
    "net/http"
    "strings"

    "github.com/gin-gonic/gin"
)

// IDEJWTAuth 专用于 /ide/api/* 路由的中间件
func IDEJWTAuth(jwtService *ide.JWTService, sessionRepo IDESessionRepo) gin.HandlerFunc {
    return func(c *gin.Context) {
        authHeader := c.GetHeader("Authorization")
        if !strings.HasPrefix(authHeader, "Bearer ") {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
            return
        }

        tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
        claims, err := jwtService.Verify(tokenStr)
        if err != nil {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
            return
        }

        // 检查数据库中的 session 是否已被吊销
        hash := sha256.Sum256([]byte(tokenStr))
        tokenHash := hex.EncodeToString(hash[:])
        session, err := sessionRepo.FindByTokenHash(c.Request.Context(), tokenHash)
        if err != nil || session.Revoked {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token revoked"})
            return
        }

        // 异步更新最后使用时间（不阻塞请求）
        go sessionRepo.UpdateLastUsed(context.Background(), session.ID)

        // 注入用户信息到 context
        c.Set("ide_user_id", claims.UserID)
        c.Set("ide_user_email", claims.Email)
        c.Set("ide_plan_id", claims.PlanID)
        c.Set("ide_model_tier", claims.ModelTier)
        c.Next()
    }
}

// APIKeyOrJWTAuth 用于 AI 转发路径（/v1/*），兼容两种认证方式
// 如果 Bearer token 是 JWT 格式，走 JWT 验证；否则走原有 API Key 验证
func APIKeyOrJWTAuth(jwtService *ide.JWTService, sessionRepo IDESessionRepo, originalKeyAuth gin.HandlerFunc) gin.HandlerFunc {
    return func(c *gin.Context) {
        authHeader := c.GetHeader("Authorization")
        token := strings.TrimPrefix(authHeader, "Bearer ")

        // 尝试解析为 JWT（JWT 通常以 eyJ 开头）
        if strings.HasPrefix(token, "eyJ") {
            claims, err := jwtService.Verify(token)
            if err != nil {
                c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid JWT"})
                return
            }

            // 检查是否已吊销
            hash := sha256.Sum256([]byte(token))
            tokenHash := hex.EncodeToString(hash[:])
            session, err := sessionRepo.FindByTokenHash(c.Request.Context(), tokenHash)
            if err != nil || session.Revoked {
                c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token revoked"})
                return
            }

            // 注入信息，后续中间件（配额检查、用量记录）通过 context 获取用户信息
            c.Set("user_id", claims.UserID)
            c.Set("plan_id", claims.PlanID)
            c.Set("model_tier", claims.ModelTier)
            c.Set("auth_type", "ide_jwt")

            go sessionRepo.UpdateLastUsed(context.Background(), session.ID)
            c.Next()
            return
        }

        // 不是 JWT，走原有 API Key 验证流程
        originalKeyAuth(c)
    }
}
```

## 2.3 在路由中替换中间件

找到 sub2api 的 `/v1/*` 路由注册处，将中间件从原有的 `APIKeyAuth` 替换为 `APIKeyOrJWTAuth`：

```go
// 找到类似这样的上游代码：
v1 := r.Group("/v1", middleware.APIKeyAuth(...))

// 改为：
v1 := r.Group("/v1", middleware.APIKeyOrJWTAuth(jwtService, sessionRepo, middleware.APIKeyAuth(...)))
```

---

# Dev 3：IDE 用量查询接口

## 背景

IDE 客户端需要在侧边栏或设置页展示用户的用量信息（本月已用 token、剩余配额、每日趋势）。sub2api 有用量数据，但没有面向客户端的查询接口，需要新增。

## 3.1 接口定义

```
GET /ide/api/usage
Authorization: Bearer {JWT}

Response:
{
  "current_month": "2025-05",
  "tokens": {
    "input": 1234567,
    "output": 345678,
    "total": 1580245,
    "limit": 10000000,          // null 表示无限制
    "percentage": 15.8
  },
  "cost": {
    "usd": 2.34,               // 本月实际消耗成本
    "credited_usd": 10.00      // 账户余额（如果用 sub2api 的余额系统）
  },
  "daily_breakdown": [         // 最近 30 天
    { "date": "2025-05-01", "input": 12345, "output": 3456 },
    ...
  ],
  "sessions_count": 42,        // 本月会话数
  "plan": {
    "id": "pro",
    "name": "Pro 套餐",
    "renews_at": "2025-06-01T00:00:00Z"
  }
}
```

## 3.2 Handler 实现

```go
// backend/internal/handler/ide/usage_handler.go
package ide

import (
    "net/http"
    "time"

    "github.com/gin-gonic/gin"
)

type UsageHandler struct {
    usageService IDEUsageService
}

func (h *UsageHandler) GetUsage(c *gin.Context) {
    userID := c.GetString("ide_user_id")
    planID := c.GetString("ide_plan_id")

    // 当前月份
    now := time.Now()
    yearMonth := now.Format("2006-01")

    // 并发查询用量数据（复用 sub2api 已有的用量数据表）
    usage, err := h.usageService.GetMonthlyUsage(c.Request.Context(), userID, yearMonth)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch usage"})
        return
    }

    daily, err := h.usageService.GetDailyBreakdown(c.Request.Context(), userID, yearMonth)
    if err != nil {
        daily = nil // 降级：日统计失败不影响主数据
    }

    plan := getPlanConfig(planID)
    var percentage *float64
    if plan.TokenLimitMonthly > 0 {
        p := float64(usage.TotalTokens) / float64(plan.TokenLimitMonthly) * 100
        percentage = &p
    }

    c.JSON(http.StatusOK, gin.H{
        "current_month": yearMonth,
        "tokens": gin.H{
            "input":      usage.InputTokens,
            "output":     usage.OutputTokens,
            "total":      usage.TotalTokens,
            "limit":      plan.TokenLimitMonthly, // 0 表示无限制
            "percentage": percentage,
        },
        "cost": gin.H{
            "usd": usage.CostUSD,
        },
        "daily_breakdown": daily,
        "sessions_count":  usage.SessionsCount,
        "plan": gin.H{
            "id":         planID,
            "name":       plan.Name,
            "renews_at":  getNextBillingDate(now),
        },
    })
}
```

---

# Dev 4：套餐与订阅管理接口

## 背景

IDE 客户端需要知道用户当前套餐、可用模型列表、以及是否有权使用某功能。

## 4.1 接口定义

```
GET /ide/api/plan
Authorization: Bearer {JWT}

Response:
{
  "plan": {
    "id": "pro",
    "name": "Pro 套餐",
    "status": "active",
    "expires_at": "2025-06-01T00:00:00Z"
  },
  "available_models": [
    {
      "id": "claude-sonnet-4-5",
      "display_name": "Claude Sonnet 4.5",
      "provider": "anthropic",
      "context_window": 200000,
      "is_default": true
    },
    {
      "id": "gpt-4o",
      "display_name": "GPT-4o",
      "provider": "openai",
      "context_window": 128000,
      "is_default": false
    }
  ],
  "features": {
    "max_concurrent_sessions": 3,
    "history_retention_days": 90,
    "can_use_pro_models": true
  }
}
```

## 4.2 模型配置与套餐绑定

在 sub2api 的配置中（或新增一张配置表），定义套餐与可用模型的映射。这部分用 YAML 配置或数据库均可：

```go
// backend/internal/service/ide/plan_service.go
package ide

type PlanConfig struct {
    ID                    string
    Name                  string
    TokenLimitMonthly     int64    // 0 = 无限制
    MaxConcurrentSessions int
    HistoryRetentionDays  int
    AllowedModelTiers     []string // "free" | "pro" | "enterprise"
}

// 套餐配置（可从数据库或配置文件读取）
var Plans = map[string]PlanConfig{
    "free": {
        ID:                    "free",
        Name:                  "免费版",
        TokenLimitMonthly:     2_000_000,
        MaxConcurrentSessions: 1,
        HistoryRetentionDays:  7,
        AllowedModelTiers:     []string{"free"},
    },
    "pro": {
        ID:                    "pro",
        Name:                  "Pro 套餐",
        TokenLimitMonthly:     0, // 无限制
        MaxConcurrentSessions: 5,
        HistoryRetentionDays:  365,
        AllowedModelTiers:     []string{"free", "pro"},
    },
}

// 可用模型列表（从 sub2api 现有的渠道/模型配置中读取，不重复维护）
func (s *PlanService) GetAvailableModels(planID string) []ModelInfo {
    plan := Plans[planID]
    allModels := s.modelRepo.GetAll() // 读取 sub2api 已配置的模型

    var available []ModelInfo
    for _, m := range allModels {
        if containsTier(plan.AllowedModelTiers, m.Tier) {
            available = append(available, ModelInfo{
                ID:            m.ID,
                DisplayName:   m.DisplayName,
                Provider:      m.Provider,
                ContextWindow: m.ContextWindow,
                IsDefault:     m.IsDefault,
            })
        }
    }
    return available
}
```

---

# Dev 5：IDE 客户端版本与更新管理接口

## 背景

IDE 客户端启动后需要检查两类更新：应用本体（Electron）和 codex 引擎二进制。这两个都需要从你的服务端拉取版本信息。

## 5.1 新增版本管理 Schema

```go
// backend/ent/schema/release.go
package schema

type Release struct {
    ent.Schema
}

func (Release) Fields() []ent.Field {
    return []ent.Field{
        field.String("id").Unique().Immutable(),
        field.Enum("type").Values("app", "engine"),  // 应用或引擎
        field.String("version").NotEmpty(),           // 语义版本，如 "1.2.3"
        field.String("min_app_version").Optional(),   // 引擎要求的最低应用版本
        field.JSON("binaries", map[string]ReleaseBinary{}), // 各平台下载信息
        field.String("release_notes").Optional(),
        field.Bool("is_latest").Default(false),
        field.Bool("is_mandatory").Default(false),   // 强制更新
        field.Time("published_at"),
        field.Time("created_at").Immutable(),
    }
}

type ReleaseBinary struct {
    URL     string `json:"url"`
    SHA256  string `json:"sha256"`
    Size    int64  `json:"size"`
}
```

## 5.2 版本查询接口

```go
// backend/internal/handler/ide/version_handler.go
package ide

// GET /ide/api/version/app
// 查询应用最新版本（供 electron-updater 使用）
func (h *VersionHandler) GetAppVersion(c *gin.Context) {
    currentVersion := c.Query("current")   // 客户端当前版本
    platform := c.Query("platform")        // "win32-x64" | "darwin-arm64" | "linux-x64"

    latest, err := h.versionService.GetLatestRelease("app")
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch version"})
        return
    }

    binary, ok := latest.Binaries[platform]
    if !ok {
        c.JSON(http.StatusNotFound, gin.H{"error": "no release for platform"})
        return
    }

    c.JSON(http.StatusOK, gin.H{
        "latest_version":  latest.Version,
        "current_version": currentVersion,
        "has_update":      isNewerVersion(latest.Version, currentVersion),
        "is_mandatory":    latest.IsMandatory,
        "release_notes":   latest.ReleaseNotes,
        "published_at":    latest.PublishedAt,
        "download": gin.H{
            "url":    binary.URL,
            "sha256": binary.SHA256,
            "size":   binary.Size,
        },
    })
}

// GET /ide/api/version/engine
// 查询引擎最新版本（供引擎热更新使用）
func (h *VersionHandler) GetEngineVersion(c *gin.Context) {
    currentEngineVersion := c.Query("current")
    currentAppVersion := c.Query("app_version") // 检查兼容性
    platform := c.Query("platform")

    latest, err := h.versionService.GetLatestRelease("engine")
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch version"})
        return
    }

    // 检查应用版本兼容性
    if latest.MinAppVersion != "" && !isVersionCompatible(currentAppVersion, latest.MinAppVersion) {
        c.JSON(http.StatusOK, gin.H{
            "has_update": false,
            "reason":     "app_version_too_old",
            "requires_app_version": latest.MinAppVersion,
        })
        return
    }

    binary, ok := latest.Binaries[platform]
    if !ok {
        c.JSON(http.StatusNotFound, gin.H{"error": "no release for platform"})
        return
    }

    c.JSON(http.StatusOK, gin.H{
        "latest_version":  latest.Version,
        "current_version": currentEngineVersion,
        "has_update":      isNewerVersion(latest.Version, currentEngineVersion),
        "min_app_version": latest.MinAppVersion,
        "download": gin.H{
            "url":    binary.URL,
            "sha256": binary.SHA256,
            "size":   binary.Size,
        },
    })
}
```

## 5.3 管理员发布新版本接口

```go
// POST /admin/ide/releases （管理员接口，需要 admin 权限）
func (h *VersionHandler) PublishRelease(c *gin.Context) {
    var req struct {
        Type         string                    `json:"type" binding:"required,oneof=app engine"`
        Version      string                    `json:"version" binding:"required"`
        MinAppVersion string                   `json:"min_app_version"`
        Binaries     map[string]ReleaseBinary  `json:"binaries" binding:"required"`
        ReleaseNotes string                    `json:"release_notes"`
        IsMandatory  bool                      `json:"is_mandatory"`
    }
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    release, err := h.versionService.Publish(c.Request.Context(), req)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }

    c.JSON(http.StatusCreated, release)
}
```

---

# Dev 6：codex / t3code 兼容性适配

## 背景

codex-rs（codex-app-server）对 OpenAI API 有一些特殊行为，sub2api 在转发时需要做兼容性处理。

## 6.1 粘性会话（Sticky Session）

codex-rs 在多轮对话中会复用同一个上游账号（避免上下文丢失）。sub2api 本身已支持粘性会话，通过请求头 `session_id` 实现。

**注意**：Nginx 默认丢弃带下划线的请求头，需要在 Nginx 配置中开启：

```nginx
# /etc/nginx/nginx.conf 的 http 块中添加
http {
    underscores_in_headers on;  # ← 必须加，否则 session_id 头被丢弃
    ...
}
```

codex-rs 会在请求中带 `session_id` 头，sub2api 收到后根据 session_id 路由到同一账号，**无需额外开发**，配置好 Nginx 即可。

## 6.2 流式响应（SSE）的超时设置

codex-rs 的 AI 响应可能很长（复杂任务几分钟），需要确保代理层不会超时断开：

```nginx
location /v1/ {
    proxy_pass http://sub2api:8080;

    # 流式响应必须关闭缓冲
    proxy_buffering off;
    proxy_cache off;

    # 超时设置（codex 长任务需要较长时间）
    proxy_read_timeout 600s;      # 10 分钟
    proxy_send_timeout 600s;
    proxy_connect_timeout 10s;

    # 保持连接
    proxy_http_version 1.1;
    proxy_set_header Connection "";

    # 传递必要的头（包括 session_id）
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## 6.3 codex-rs 发送的特殊请求头透传

codex-rs 在请求中可能包含 `anthropic-beta` 等特殊头，需要确保 sub2api 透传这些头到上游：

在 sub2api 的转发逻辑中（找到处理转发请求的代码），确认以下头被透传：

```go
// 确保这些头被透传（在 sub2api 的转发 handler 中确认）
passthroughHeaders := []string{
    "anthropic-beta",
    "anthropic-version",
    "x-request-id",
    "session_id",
}
```

如果上游代码没有透传，找到转发 handler 并添加：

```go
// 在构造上游请求时，将这些头从原始请求复制过去
for _, header := range passthroughHeaders {
    if val := c.GetHeader(header); val != "" {
        upstreamReq.Header.Set(header, val)
    }
}
```

## 6.4 模型名称映射

codex-rs 使用的模型 ID 可能与 sub2api 配置的模型 ID 不同。在 sub2api 的渠道配置中，设置好模型名称映射：

```yaml
# sub2api config.yaml（或管理后台配置）
channels:
  - name: "我的第三方反代"
    base_url: "https://your-proxy.com/v1"
    api_key: "your-real-api-key"
    model_mapping:
      # codex-rs 发来的模型名 → 上游实际的模型名
      "claude-sonnet-4-5": "claude-sonnet-4-5-20251001"
      "claude-opus-4": "claude-opus-4-20250514"
      "gpt-4o": "gpt-4o-2024-11-20"
```

---

# Dev 7：管理后台扩展（Vue3）

## 背景

sub2api 有完整的 Vue3 管理后台，需要在此基础上新增 IDE 专属的管理页面。

## 7.1 新增页面列表

在 `frontend/src/views/` 下新增：

```
frontend/src/views/
└── ide/
    ├── IDESessions.vue      # IDE 客户端会话管理
    ├── IDEReleases.vue      # 版本发布管理
    └── IDEStats.vue         # IDE 客户端使用统计
```

## 7.2 IDE 会话管理页面

```vue
<!-- frontend/src/views/ide/IDESessions.vue -->
<template>
  <div class="ide-sessions">
    <PageHeader title="IDE 客户端会话" />

    <!-- 统计卡片 -->
    <StatsRow :stats="stats" />

    <!-- 搜索和过滤 -->
    <SearchBar v-model="searchQuery" placeholder="搜索用户邮箱、设备 ID..." />

    <!-- 会话列表 -->
    <DataTable :columns="columns" :data="sessions" :loading="loading">
      <template #platform="{ row }">
        <PlatformBadge :platform="row.platform" />
      </template>
      <template #status="{ row }">
        <StatusBadge :revoked="row.revoked" :expired="isExpired(row.expires_at)" />
      </template>
      <template #actions="{ row }">
        <Button v-if="!row.revoked" @click="revokeSession(row.id)" danger> 吊销 </Button>
      </template>
    </DataTable>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useIDESessionAPI } from "@/api/ide";

const { getSessions, revokeSession: apiRevoke } = useIDESessionAPI();
const sessions = ref([]);
const loading = ref(false);

const columns = [
  { key: "user_email", label: "用户" },
  { key: "client_version", label: "IDE 版本" },
  { key: "platform", label: "平台" },
  { key: "last_used_at", label: "最后使用" },
  { key: "expires_at", label: "过期时间" },
  { key: "status", label: "状态" },
  { key: "actions", label: "操作" },
];

onMounted(async () => {
  loading.value = true;
  sessions.value = await getSessions();
  loading.value = false;
});

async function revokeSession(sessionId: string) {
  await apiRevoke(sessionId);
  sessions.value = await getSessions();
}
</script>
```

## 7.3 版本发布管理页面

```vue
<!-- frontend/src/views/ide/IDEReleases.vue -->
<template>
  <div class="ide-releases">
    <PageHeader title="版本发布管理">
      <Button @click="showPublishModal = true" type="primary"> 发布新版本 </Button>
    </PageHeader>

    <!-- 版本列表（分 app / engine 两个 tab） -->
    <Tabs v-model="activeTab">
      <Tab label="应用版本" value="app">
        <ReleaseTable :releases="appReleases" @set-latest="setLatest" />
      </Tab>
      <Tab label="引擎版本" value="engine">
        <ReleaseTable :releases="engineReleases" @set-latest="setLatest" />
      </Tab>
    </Tabs>

    <!-- 发布弹窗 -->
    <PublishReleaseModal v-model:visible="showPublishModal" @published="refreshReleases" />
  </div>
</template>
```

```vue
<!-- 发布弹窗：填写版本信息 -->
<template>
  <Modal
    title="发布新版本"
    :visible="visible"
    @ok="submit"
    @cancel="$emit('update:visible', false)"
  >
    <Form :model="form">
      <FormItem label="类型">
        <RadioGroup v-model="form.type">
          <Radio value="app">应用（Electron）</Radio>
          <Radio value="engine">引擎（codex-rs）</Radio>
        </RadioGroup>
      </FormItem>
      <FormItem label="版本号">
        <Input v-model="form.version" placeholder="1.2.3" />
      </FormItem>
      <FormItem label="最低应用版本" v-if="form.type === 'engine'">
        <Input v-model="form.min_app_version" placeholder="1.0.0（留空表示不限制）" />
      </FormItem>
      <FormItem label="强制更新">
        <Switch v-model="form.is_mandatory" />
      </FormItem>
      <FormItem label="发布说明">
        <Textarea v-model="form.release_notes" rows="4" />
      </FormItem>

      <!-- 各平台下载信息 -->
      <FormItem label="平台下载">
        <div v-for="platform in platforms" :key="platform.key" class="platform-input">
          <span>{{ platform.label }}</span>
          <Input v-model="form.binaries[platform.key].url" placeholder="下载 URL" />
          <Input v-model="form.binaries[platform.key].sha256" placeholder="SHA256" />
          <InputNumber v-model="form.binaries[platform.key].size" placeholder="文件大小（bytes）" />
        </div>
      </FormItem>
    </Form>
  </Modal>
</template>

<script setup lang="ts">
const platforms = [
  { key: "win32-x64", label: "Windows x64" },
  { key: "darwin-arm64", label: "macOS Apple Silicon" },
  { key: "darwin-x64", label: "macOS Intel" },
  { key: "linux-x64", label: "Linux x64" },
];
</script>
```

## 7.4 在路由中注册新页面

```typescript
// frontend/src/router/index.ts（找到路由配置，追加 IDE 路由）
{
  path: '/admin/ide',
  component: AdminLayout,
  children: [
    {
      path: 'sessions',
      component: () => import('@/views/ide/IDESessions.vue'),
      meta: { title: 'IDE 会话管理', requiresAdmin: true }
    },
    {
      path: 'releases',
      component: () => import('@/views/ide/IDEReleases.vue'),
      meta: { title: '版本发布', requiresAdmin: true }
    },
    {
      path: 'stats',
      component: () => import('@/views/ide/IDEStats.vue'),
      meta: { title: 'IDE 统计', requiresAdmin: true }
    },
  ]
}
```

## 7.5 在侧边栏菜单中注册

找到 sub2api 的菜单配置文件，追加 IDE 管理入口（不修改上游菜单项，只追加）：

```typescript
// frontend/src/config/menu.ts 或类似文件
// 在 adminMenuItems 末尾追加：
{
  key: 'ide',
  label: 'IDE 客户端',
  icon: 'CodeOutlined',
  children: [
    { key: 'ide-sessions', label: '客户端会话', path: '/admin/ide/sessions' },
    { key: 'ide-releases', label: '版本发布', path: '/admin/ide/releases' },
    { key: 'ide-stats', label: '使用统计', path: '/admin/ide/stats' },
  ]
}
```

---

# 八、部署与运维

## 8.1 完整系统架构

```
Internet
    │
    ▼
┌─────────────┐
│   Nginx      │  443 (HTTPS + TLS 终止)
│   反向代理    │  ← 配置 underscores_in_headers on
└──────┬──────┘
       │
       ▼
┌─────────────┐          ┌───────────────┐
│  sub2api    │          │   PostgreSQL  │
│  (Go binary)│◄────────►│   + Redis     │
│  port 8080  │          └───────────────┘
└──────┬──────┘
       │ 转发 AI 请求
       ▼
┌─────────────┐
│ 你的第三方   │
│ 反代服务     │
│ (base_url   │
│  + API Key) │
└─────────────┘
```

## 8.2 Docker Compose 配置

```yaml
# deploy/docker-compose.prod.yml
version: "3.8"

services:
  sub2api:
    image: your-registry/sub2api-myide:latest
    restart: always
    ports:
      - "127.0.0.1:8080:8080" # 只监听本地，通过 Nginx 暴露
    environment:
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=sub2api
      - DB_USER=sub2api
      - DB_PASSWORD=${DB_PASSWORD}
      - REDIS_ADDR=redis:6379
      # IDE JWT 配置
      - IDE_JWT_SECRET=${IDE_JWT_SECRET} # 强随机字符串，至少 64 字节
      - IDE_JWT_TTL_DAYS=30
      # 上游 AI 服务（管理员在后台配置，这里是环境变量备用）
      - UPSTREAM_BASE_URL=${UPSTREAM_BASE_URL}
      - UPSTREAM_API_KEY=${UPSTREAM_API_KEY}
    volumes:
      - sub2api-data:/opt/sub2api/data
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      - POSTGRES_DB=sub2api
      - POSTGRES_USER=sub2api
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sub2api"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s

volumes:
  sub2api-data:
  postgres-data:
  redis-data:
```

## 8.3 CI/CD：自动构建与发布

```yaml
# .github/workflows/build-and-push.yml
name: Build and Push

on:
  push:
    tags: ["v*"]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: "1.25"

      - name: Run tests
        run: |
          cd backend
          go test -tags=unit ./...
          go test -tags=integration ./...

      - name: Build Docker image
        run: |
          docker build -t your-registry/sub2api-myide:${{ github.ref_name }} .
          docker push your-registry/sub2api-myide:${{ github.ref_name }}

      - name: Deploy to production
        run: |
          ssh deploy@your-server "
            docker compose -f deploy/docker-compose.prod.yml pull
            docker compose -f deploy/docker-compose.prod.yml up -d --no-deps sub2api
          "
```

## 8.4 IDE 引擎发布 CI（自动更新 manifest）

每次 codex-rs 有新版本时，CI 自动构建各平台二进制，上传 CDN，并更新 manifest：

```yaml
# .github/workflows/release-engine.yml
name: Release Engine

on:
  workflow_dispatch:
    inputs:
      version:
        description: "Engine version (e.g. 0.5.2)"
        required: true

jobs:
  build-and-publish:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            platform: linux-x64
          - os: macos-latest
            target: aarch64-apple-darwin
            platform: darwin-arm64
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            platform: win32-x64

    runs-on: ${{ matrix.os }}
    steps:
      - name: Build codex-rs binary
        run: cargo build --release --target ${{ matrix.target }}

      - name: Calculate SHA256
        id: hash
        run: |
          sha256sum target/${{ matrix.target }}/release/codex > hash.txt
          echo "sha256=$(cat hash.txt | cut -d' ' -f1)" >> $GITHUB_OUTPUT

      - name: Upload to CDN
        run: |
          # 上传到你的 CDN（S3、Cloudflare R2 等）
          aws s3 cp target/${{ matrix.target }}/release/codex \
            s3://your-releases/engine/${{ inputs.version }}/${{ matrix.platform }}/codex

  update-manifest:
    needs: build-and-publish
    runs-on: ubuntu-latest
    steps:
      - name: Call sub2api API to publish new engine release
        run: |
          curl -X POST https://api.yourservice.com/admin/ide/releases \
            -H "Authorization: Bearer ${{ secrets.ADMIN_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{
              "type": "engine",
              "version": "${{ inputs.version }}",
              "binaries": {
                "win32-x64":    { "url": "...", "sha256": "...", "size": 0 },
                "darwin-arm64": { "url": "...", "sha256": "...", "size": 0 },
                "linux-x64":    { "url": "...", "sha256": "...", "size": 0 }
              }
            }'
```

---

# 九、开发优先级与工作量估算

## 优先级矩阵

| #        | 开发项                          | 优先级 | 预计工时           | 说明                            |
| -------- | ------------------------------- | ------ | ------------------ | ------------------------------- |
| Dev 1    | IDE 客户端 OAuth PKCE 认证      | **P0** | 3天                | 没有这个，客户端无法登录        |
| Dev 2    | JWT 中间件（兼容 API Key 认证） | **P0** | 2天                | 核心安全架构，必须先做          |
| Dev 6    | codex/t3code 兼容性适配         | **P0** | 1天                | Nginx 配置 + 头透传，工作量小   |
| Dev 3    | IDE 用量查询接口                | P1     | 1天                | 复用现有用量数据，接口薄        |
| Dev 4    | 套餐与模型权限接口              | P1     | 1天                | 配置驱动，开发量小              |
| Dev 5    | 版本管理接口                    | P1     | 2天                | 含 Schema + Handler + 管理接口  |
| Dev 7    | 管理后台 Vue3 扩展              | P2     | 3天                | 有现成组件可复用，主要是页面    |
| —        | 部署与 CI/CD 配置               | P1     | 1天                | Docker Compose + GitHub Actions |
| **合计** |                                 |        | **约 14 个工作日** |                                 |

## 与上游同步风险评估

| 改动方式                   | 冲突风险  | 建议                                 |
| -------------------------- | --------- | ------------------------------------ |
| 新增文件（`ide/` 目录）    | ✅ 无风险 | 所有 IDE 代码都放独立目录            |
| 修改路由注册（追加）       | ⚠️ 低风险 | 在末尾追加，不修改上游路由块         |
| 修改 Nginx 中间件（插入）  | ⚠️ 低风险 | 在上游中间件前插入，保持上游逻辑不变 |
| 新增 Ent Schema 文件       | ✅ 无风险 | 新增文件，不修改上游 Schema          |
| 修改前端路由和菜单（追加） | ⚠️ 低风险 | 只追加，不修改上游项                 |
| 修改 AI 转发中间件（替换） | ⚠️ 中风险 | 保存上游实现，用包装函数调用         |

> **同步上游的频率建议**：每两周同步一次上游，保持与上游的改动在 200 行以内，出现冲突时优先保留上游逻辑，在其基础上重新应用你的改动。

---

_文档持续更新，与开发进展同步。优先完成 P0 项目，确保 IDE 客户端可以完整走通登录 → 请求 AI → 查看用量的核心链路。_
