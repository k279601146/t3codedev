# 能力市场与 SkillHub 技能源接入说明

本文记录 T3 Code 侧栏“技能 / 插件”合并为统一入口 **能力市场** 的重构结果，以及将 **SkillHub** 作为默认远程市场源后的接入方式、安装流程和后续演进规则。

## 背景

原先左侧栏同时存在“技能”和“插件”两个入口，且两边内容有明显重叠，容易让用户混淆。  
当前方案将两者统一为一个入口：

- 左侧入口：`扩展`
- 页面标题：`能力市场`
- 旧路由 `/skills`、`/plugins` 保留重定向，避免历史链接失效

## 当前结构

能力市场现在分为两条主线：

1. **SkillHub 技能源**
   - 作为默认远程市场源
   - 远程只启用 SkillHub，不再使用 OpenAI curated 源
   - 条目通过 ZIP 下载，由服务端完成安全校验后安装

2. **T3 内置扩展**
   - 继续从仓库根目录 `extensions/` 发现
   - 主要包括内置技能和 T3 自有插件 / 桥接能力
   - 保持现有 `plugins.list` / `skills.list` 体系，不另起一套发现链路

## 代码层接入点

当前实现主要分布在以下模块：

- `packages/contracts/src/skills.ts`
- `apps/server/src/skills/SkillCatalogProvider.ts`
- `apps/server/src/skills/SkillHubCatalogProvider.ts`
- `apps/server/src/skills/SkillsCatalogService.ts`
- `apps/server/src/skills/SkillsService.ts`
- `apps/web/src/components/extensions/ExtensionsPage.tsx`
- `apps/web/src/components/skills/SkillsPage.tsx`

## UI 调整

能力市场页面做了这些调整：

- 合并“技能 / 插件”为一个统一页面
- 新增顶部 tab：
  - `全部能力`
  - `已安装`
  - `来源`
  - `插件与桥接`
- 去掉“全部能力”页里的插件预览块，避免和首页瀑布流混在一起
- 技能卡片优先显示 `iconUrl`，没有图标才回退到首字母
- 分类、搜索、分页加载改为同一内容区内的连续体验
- 滚动触底时采用追加加载，避免列表闪回顶部
- 搜索和刷新控制收紧为紧凑按钮，不再占用过多横向空间

## SkillHub 安装流程

SkillHub 条目点击安装后，服务端会：

1. 读取条目详情
2. 下载 ZIP
3. 做安全校验
4. 解压到用户级目录 `BAHEW_HOME/agent-data/skills/<skill-name>`
5. 刷新技能源
6. 让聊天输入框可直接使用 `$<skill-name>`

### 安全校验

当前 ZIP 安装会校验：

- 下载大小上限
- 解压后总大小上限
- 文件数上限
- 路径穿越
- 绝对路径 / 盘符 / 空字节
- 危险扩展名
- `SKILL.md` 是否存在
- `sha256` 是否匹配（如果 SkillHub 文件清单可用）

## SkillHub 数据结构

SkillHub 目录页支持：

- 分类
- 搜索
- 分页
- 排序

展示字段会尽量保留：

- `categoryKey / categoryName`
- `sourceLabel`
- `version`
- `downloads / installs / stars`
- `requiresApiKey`
- `securityStatus`
- `homepage`
- `sourceUrl`
- `iconUrl`

## 分类和内容

当前能力市场中的 SkillHub 技能采用“分类和内容一体化”的方式展示：

- 点击分类后，内容区直接切换到该分类结果
- 滚动继续加载更多，不再把分类和推荐区拆开
- 服务端返回的分类数据会用于顶部筛选和来源面板展示

## 插件与技能的边界

当前默认规则是：

- **SkillHub 大多数条目先作为技能安装**
- 只有当条目具备明确的插件特征时，才考虑升级为插件型扩展

### 可以升级为插件型扩展的条件

满足以下任一类特征时，可以进入“插件候选”流程：

- 包含 MCP server
- 包含 hooks
- 包含 apps 面板或独立 UI
- 包含二进制工具或外部运行时
- 包含 OAuth / 授权流程

### 升级方式

建议使用显式 manifest 或 T3 适配配方，不要靠名称猜测：

- `SKILL.md` 只描述工作流和说明时，仍按技能安装
- ZIP 内若包含插件 manifest，则升级为插件安装
- 若 SkillHub 原包没有插件 manifest，可先在 T3 侧维护一份映射配方，再逐步推动上游标准化

## 推荐的长期演进

后续如果要把 SkillHub 里的某些条目真正做成插件市场，建议补一层标准化能力：

- 为 SkillHub 条目增加可机器读取的插件 manifest
- 为插件安装增加权限说明页
- 为 MCP / OAuth / 二进制依赖增加显式审查流程
- 为“技能安装”和“插件安装”保留同一市场入口，但维持不同安装路径

## 结论

当前方案的目标不是把所有 SkillHub 条目都变成插件，而是：

- 先把技能和插件统一到一个清晰入口
- 让 SkillHub 成为默认远程市场源
- 让安装流程可直接在 T3 客户端内完成
- 让高风险能力只有在显式声明和安全校验后才升级为插件

