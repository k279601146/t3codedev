# T3Code 二次开发方案：新增 Cursor 风格三栏布局与代码编辑器

> 基于 [pingdotgg/t3code](https://github.com/pingdotgg/t3code) 开发，版本参考 v0.0.21

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [T3Code 现有架构分析](#2-t3code-现有架构分析)
3. [整体方案设计](#3-整体方案设计)
4. [技术选型](#4-技术选型)
5. [目录结构规划](#5-目录结构规划)
6. [核心实现步骤](#6-核心实现步骤)
7. [后端扩展（文件读写）](#7-后端扩展文件读写)
8. [用户偏好设置集成](#8-用户偏好设置集成)
9. [布局切换与路由](#9-布局切换与路由)
10. [Monaco Editor 深度集成](#10-monaco-editor-深度集成)
11. [AI 与编辑器联动](#11-ai-与编辑器联动)
12. [开发计划与里程碑](#12-开发计划与里程碑)
13. [风险与注意事项](#13-风险与注意事项)

---

## 1. 背景与目标

### 现状

T3Code 目前采用**两栏布局**：
- **左栏**：对话侧边栏（会话列表）
- **右栏**：聊天视图 + Diff 面板（代码差异预览）

这个布局没有真正的代码编辑器，用户只能查看 AI 生成的 Diff，无法像在 Cursor、VS Code 那样直接在编辑器中修改代码。

### 目标

新增一种**三栏布局（Cursor 模式）**，包含：

| 栏位 | 内容 |
|------|------|
| 左栏 | 文件树 + 会话列表（可折叠） |
| 中栏 | **Monaco Editor**（完整代码编辑器，支持读写） |
| 右栏 | AI 对话面板 |

用户可在**个性化设置**中自由切换：
- `codex`（默认）：现有两栏布局，无代码编辑器
- `cursor`：三栏布局，带 Monaco Editor 完整编辑体验

---

## 2. T3Code 现有架构分析

### 2.1 技术栈总览

```
monorepo (bun workspaces)
├── apps/
│   ├── web/          # React + Vite + TanStack Router/Query + Zustand
│   ├── server/       # Node.js WebSocket 服务器（wsServer.ts）
│   └── desktop/      # Electron 包装器（三进程模型）
└── packages/
    └── contracts/    # 共享类型定义（WS RPC 契约）
```

### 2.2 前端核心组件

```
apps/web/src/
├── routes/
│   ├── __root.tsx            # 根布局
│   ├── _chat.tsx             # 聊天布局外壳（当前两栏）
│   ├── _chat.$threadId.tsx   # 具体会话页
│   └── _chat.index.tsx       # 会话列表首页
├── components/
│   ├── ChatView.tsx          # AI 对话界面
│   ├── DiffPanel.tsx         # Diff 查看器（只读）
│   ├── DiffPanelShell.tsx    # Diff 面板容器
│   └── Sidebar.tsx           # 左侧边栏
└── store.ts                  # Zustand 全局状态
```

### 2.3 后端通信模式

前后端通过单条 WebSocket 连接通信，分为两类：
- **RPC 请求-响应**：客户端调用 `WS_METHODS`，服务器返回结果
- **服务器推送**：服务器通过 `WS_CHANNELS` 广播状态变更

文件读写需要通过新增 WS RPC 方法来实现（见第7节）。

### 2.4 设置系统

当前设置存储在 `apps/web/src/` 的 Zustand store 中，并持久化到 localStorage（用户端偏好）或通过 WS 同步到后端（服务端配置）。

---

## 3. 整体方案设计

### 3.1 布局模式枚举

```typescript
// packages/contracts/src/layout.ts（新建）
export type LayoutMode = 'codex' | 'cursor';
```

### 3.2 三栏布局示意

```
┌─────────────────────────────────────────────────────────────┐
│  [文件树/会话列表]  │    Monaco Editor     │   AI 对话面板   │
│     ~240px         │       flex-1         │    ~380px       │
│                    │                      │                 │
│  📁 src/           │  import React from   │  💬 AI:         │
│    📄 App.tsx  ←───┼──▶ 'react'           │  已为您修改     │
│    📄 index.ts     │  function App() {    │  App.tsx        │
│  📁 components/    │    return <div>      │                 │
│    📄 Button.tsx   │      Hello World     │  [用户输入框]   │
│                    │    </div>            │                 │
│  ─────────────     │  }                   │                 │
│  💬 会话列表        │                      │                 │
│  > Session 1       │  ← 可直接编辑，保存   │                 │
│    Session 2       │                      │                 │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 核心功能列表

- **文件树**：展示当前工作区目录结构，点击打开文件到 Monaco
- **Monaco Editor**：完整编辑器（语法高亮、IntelliSense、多标签页）
- **文件读写**：通过 WebSocket RPC 读取/保存文件到磁盘
- **AI 联动**：AI 修改代码时，在编辑器中显示差异并可一键接受/拒绝
- **布局切换**：在设置中一键切换，状态持久化
- **面板调整**：各栏宽度可拖拽调整

---

## 4. 技术选型

### 4.1 Monaco Editor

**选择 `@monaco-editor/react`**，理由：

| 方案 | 优点 | 缺点 |
|------|------|------|
| `@monaco-editor/react` | 开箱即用，React 集成好，自动加载 worker | 包体较大 |
| 裸 `monaco-editor` | 更灵活 | 需要手动配置 webpack/vite 插件 |
| CodeMirror 6 | 更轻量 | 功能不如 Monaco 完整，无 IntelliSense |

Monaco Editor 完全满足需求：语法高亮、多语言、LSP（Language Server Protocol）支持、差异视图（diff editor）、多标签、主题等。

安装：

```bash
bun add @monaco-editor/react monaco-editor --filter @t3tools/web
```

需在 `vite.config.ts` 中配置 Monaco worker：

```typescript
// apps/web/vite.config.ts
import { defineConfig } from 'vite'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

export default defineConfig({
  plugins: [
    monacoEditorPlugin({
      languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html']
    })
  ]
})
```

```bash
bun add vite-plugin-monaco-editor -D --filter @t3tools/web
```

### 4.2 文件树组件

**选择 `react-arborist`**（基于 react-virtual，性能好，支持拖拽）：

```bash
bun add react-arborist --filter @t3tools/web
```

### 4.3 面板拖拽分割

**选择 `react-resizable-panels`**（Shadcn UI 同款，轻量）：

```bash
bun add react-resizable-panels --filter @t3tools/web
```

---

## 5. 目录结构规划

新增/修改的文件如下（以 `+` 标记新建，`~` 标记修改）：

```
apps/web/src/
├── routes/
│   ├── __root.tsx                          # ~ 注入布局偏好 Provider
│   ├── _chat.tsx                           # ~ 根据偏好渲染不同布局
│   ├── _cursor.tsx                         # + Cursor 三栏布局外壳（新路由）
│   └── _cursor.$threadId.tsx              # + Cursor 模式下的具体会话页
│
├── components/
│   ├── editor/                             # + 新增编辑器模块
│   │   ├── MonacoEditor.tsx               # + Monaco 编辑器封装
│   │   ├── EditorTabs.tsx                 # + 多标签页管理
│   │   ├── EditorStatusBar.tsx            # + 底部状态栏（行列号/语言/编码）
│   │   └── EditorDiffOverlay.tsx          # + AI 修改时的差异覆层
│   │
│   ├── file-tree/                          # + 新增文件树模块
│   │   ├── FileTree.tsx                   # + 文件树主组件
│   │   ├── FileTreeNode.tsx               # + 单个节点渲染
│   │   └── FileTreeContext.tsx            # + 文件树上下文
│   │
│   ├── layout/                             # + 新增布局组件
│   │   ├── CursorLayout.tsx               # + 三栏布局容器
│   │   ├── ResizablePanel.tsx             # + 可拖拽面板封装
│   │   └── LayoutSwitcher.tsx             # + 布局切换按钮
│   │
│   ├── ChatView.tsx                        # ~ 保持不变（在两种布局中复用）
│   ├── DiffPanel.tsx                       # ~ 保持不变
│   └── Sidebar.tsx                         # ~ 保持不变
│
├── store/
│   ├── store.ts                            # ~ 现有 store（迁移到目录结构）
│   ├── editorStore.ts                      # + 编辑器状态（打开的标签页、活动文件等）
│   └── layoutStore.ts                      # + 布局偏好状态
│
├── hooks/
│   ├── useFileContent.ts                   # + 通过 WS 读取文件内容
│   ├── useFileSave.ts                      # + 通过 WS 保存文件
│   └── useFileTree.ts                      # + 获取目录树数据
│
└── types/
    └── editor.ts                           # + 编辑器相关类型定义

packages/contracts/src/
├── ws.ts                                   # ~ 新增文件操作 WS 方法
└── layout.ts                               # + 布局模式类型

apps/server/src/
├── wsServer.ts                             # ~ 新增文件读写 RPC handler
└── services/
    └── fileService.ts                      # + 文件系统操作封装
```

---

## 6. 核心实现步骤

### 步骤 1：安装依赖

```bash
cd apps/web
bun add @monaco-editor/react monaco-editor react-arborist react-resizable-panels
bun add -D vite-plugin-monaco-editor
```

### 步骤 2：配置 Vite（Monaco Worker）

```typescript
// apps/web/vite.config.ts
import react from '@vitejs/plugin-react'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    monacoEditorPlugin({
      languageWorkers: [
        'editorWorkerService',
        'typescript',
        'json',
        'css',
        'html',
        'markdown'
      ]
    })
  ]
})
```

### 步骤 3：定义编辑器全局状态

```typescript
// apps/web/src/store/editorStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface EditorTab {
  id: string
  filePath: string       // 绝对路径
  fileName: string       // 显示名
  content: string        // 当前编辑器内容
  savedContent: string   // 磁盘上的内容（用于判断是否有未保存修改）
  language: string       // Monaco 语言 ID
  isDirty: boolean       // 有未保存修改
  cursorPosition?: { line: number; column: number }
}

interface EditorState {
  tabs: EditorTab[]
  activeTabId: string | null
  openFile: (filePath: string, content: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateContent: (tabId: string, content: string) => void
  markSaved: (tabId: string) => void
  applyAiDiff: (filePath: string, newContent: string) => void
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      openFile: (filePath, content) => {
        const existing = get().tabs.find(t => t.filePath === filePath)
        if (existing) {
          set({ activeTabId: existing.id })
          return
        }
        const tab: EditorTab = {
          id: crypto.randomUUID(),
          filePath,
          fileName: filePath.split('/').pop() ?? filePath,
          content,
          savedContent: content,
          language: inferLanguage(filePath),
          isDirty: false,
        }
        set(s => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
      },

      closeTab: (tabId) => set(s => {
        const tabs = s.tabs.filter(t => t.id !== tabId)
        const activeTabId = s.activeTabId === tabId
          ? (tabs[tabs.length - 1]?.id ?? null)
          : s.activeTabId
        return { tabs, activeTabId }
      }),

      setActiveTab: (tabId) => set({ activeTabId: tabId }),

      updateContent: (tabId, content) => set(s => ({
        tabs: s.tabs.map(t =>
          t.id === tabId
            ? { ...t, content, isDirty: content !== t.savedContent }
            : t
        )
      })),

      markSaved: (tabId) => set(s => ({
        tabs: s.tabs.map(t =>
          t.id === tabId
            ? { ...t, savedContent: t.content, isDirty: false }
            : t
        )
      })),

      applyAiDiff: (filePath, newContent) => {
        const tab = get().tabs.find(t => t.filePath === filePath)
        if (tab) {
          set(s => ({
            tabs: s.tabs.map(t =>
              t.id === tab.id
                ? { ...t, content: newContent, isDirty: true }
                : t
            )
          }))
        }
      }
    }),
    { name: 'editor-store', partialize: s => ({ tabs: s.tabs, activeTabId: s.activeTabId }) }
  )
)

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown',
    css: 'css', scss: 'scss',
    html: 'html', py: 'python',
    rs: 'rust', go: 'go',
  }
  return map[ext ?? ''] ?? 'plaintext'
}
```

### 步骤 4：定义布局偏好状态

```typescript
// apps/web/src/store/layoutStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LayoutMode = 'codex' | 'cursor'

interface LayoutState {
  mode: LayoutMode
  setMode: (mode: LayoutMode) => void

  // 面板宽度（百分比），cursor 模式专用
  panelSizes: [number, number, number] // [左栏, 中栏, 右栏]
  setPanelSizes: (sizes: [number, number, number]) => void
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      mode: 'codex',
      setMode: (mode) => set({ mode }),
      panelSizes: [18, 50, 32],
      setPanelSizes: (panelSizes) => set({ panelSizes }),
    }),
    { name: 'layout-store' }
  )
)
```

### 步骤 5：Monaco Editor 封装组件

```typescript
// apps/web/src/components/editor/MonacoEditor.tsx
import Editor, { DiffEditor, useMonaco } from '@monaco-editor/react'
import { useEffect, useRef } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { useFileSave } from '../../hooks/useFileSave'

export function MonacoEditorPanel() {
  const { tabs, activeTabId, updateContent } = useEditorStore()
  const activeTab = tabs.find(t => t.id === activeTabId)
  const { saveFile } = useFileSave()
  const monaco = useMonaco()

  // 注册全局快捷键 Ctrl+S 保存
  useEffect(() => {
    if (!monaco || !activeTab) return
    const disposable = monaco.editor.addEditorAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        saveFile(activeTab.filePath, activeTab.content)
      }
    })
    return () => disposable.dispose()
  }, [monaco, activeTab])

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>在左侧文件树中选择一个文件以开始编辑</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <EditorTabs />
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={activeTab.language}
          value={activeTab.content}
          theme="vs-dark"
          onChange={(value) => {
            if (value !== undefined) updateContent(activeTab.id, value)
          }}
          options={{
            fontSize: 14,
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            fontLigatures: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'off',
            tabSize: 2,
            insertSpaces: true,
            formatOnPaste: true,
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
          }}
        />
      </div>
      <EditorStatusBar tab={activeTab} />
    </div>
  )
}
```

### 步骤 6：文件树组件

```typescript
// apps/web/src/components/file-tree/FileTree.tsx
import { Tree, NodeApi } from 'react-arborist'
import { useFileTree } from '../../hooks/useFileTree'
import { useFileContent } from '../../hooks/useFileContent'
import { useEditorStore } from '../../store/editorStore'

export function FileTree() {
  const { data: treeData, isLoading } = useFileTree()
  const { fetchFile } = useFileContent()
  const { openFile } = useEditorStore()

  const handleSelect = async (nodes: NodeApi[]) => {
    const node = nodes[0]
    if (!node || node.isInternal) return
    const filePath = node.data.path as string
    const content = await fetchFile(filePath)
    openFile(filePath, content)
  }

  if (isLoading) return <div className="p-2 text-sm text-muted-foreground">加载中...</div>

  return (
    <Tree
      data={treeData}
      onSelect={handleSelect}
      indent={16}
      rowHeight={28}
      className="h-full overflow-auto text-sm"
    >
      {FileTreeNode}
    </Tree>
  )
}
```

### 步骤 7：三栏布局容器

```typescript
// apps/web/src/components/layout/CursorLayout.tsx
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from 'react-resizable-panels'
import { FileTree } from '../file-tree/FileTree'
import { MonacoEditorPanel } from '../editor/MonacoEditor'
import { ChatView } from '../ChatView'
import { Sidebar } from '../Sidebar'
import { useLayoutStore } from '../../store/layoutStore'

interface CursorLayoutProps {
  threadId?: string
}

export function CursorLayout({ threadId }: CursorLayoutProps) {
  const { panelSizes, setPanelSizes } = useLayoutStore()

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="h-screen w-screen"
      onLayout={(sizes) => setPanelSizes(sizes as [number, number, number])}
    >
      {/* 左栏：文件树 + 会话列表 */}
      <ResizablePanel
        defaultSize={panelSizes[0]}
        minSize={14}
        maxSize={30}
        className="flex flex-col border-r border-border"
      >
        <LeftPanel />
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* 中栏：Monaco Editor */}
      <ResizablePanel
        defaultSize={panelSizes[1]}
        minSize={30}
        className="flex flex-col"
      >
        <MonacoEditorPanel />
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* 右栏：AI 对话 */}
      <ResizablePanel
        defaultSize={panelSizes[2]}
        minSize={20}
        maxSize={45}
        className="flex flex-col border-l border-border"
      >
        <ChatView threadId={threadId} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function LeftPanel() {
  // 左栏分为上方文件树和下方会话列表，用分隔符隔开
  return (
    <ResizablePanelGroup direction="vertical" className="h-full">
      <ResizablePanel defaultSize={60} minSize={30}>
        <div className="flex h-full flex-col">
          <div className="flex items-center px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            文件树
          </div>
          <div className="flex-1 overflow-hidden">
            <FileTree />
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={40} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="flex items-center px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            会话列表
          </div>
          <div className="flex-1 overflow-auto">
            <Sidebar compact />
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
```

---

## 7. 后端扩展（文件读写）

需在 `packages/contracts/src/ws.ts` 中新增文件操作 RPC 方法，并在 `apps/server/src/wsServer.ts` 中实现 handler。

### 7.1 新增合约类型

```typescript
// packages/contracts/src/ws.ts （追加到 WS_METHODS）
export const WS_METHODS = {
  // ... 现有方法 ...

  // 文件操作
  'file.readFile': {
    input: z.object({ filePath: z.string() }),
    output: z.object({ content: z.string(), encoding: z.string() }),
  },
  'file.writeFile': {
    input: z.object({ filePath: z.string(), content: z.string() }),
    output: z.object({ success: z.boolean() }),
  },
  'file.listDirectory': {
    input: z.object({ dirPath: z.string(), depth: z.number().default(5) }),
    output: z.object({ tree: FileTreeNodeSchema }),
  },
  'file.watchDirectory': {
    input: z.object({ dirPath: z.string() }),
    output: z.object({ watchId: z.string() }),
  },
} as const

// 文件树节点结构
const FileTreeNodeSchema: z.ZodType<FileTreeNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    isDirectory: z.boolean(),
    children: z.array(FileTreeNodeSchema).optional(),
  })
)
```

### 7.2 服务器实现

```typescript
// apps/server/src/services/fileService.ts
import fs from 'fs/promises'
import path from 'path'

export class FileService {
  constructor(private workspaceRoot: string) {}

  async readFile(filePath: string): Promise<string> {
    const abs = this.resolveSafe(filePath)
    return fs.readFile(abs, 'utf-8')
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const abs = this.resolveSafe(filePath)
    // 确保目录存在
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf-8')
  }

  async listDirectory(dirPath: string, depth = 5): Promise<FileTreeNode> {
    const abs = this.resolveSafe(dirPath)
    return this.buildTree(abs, depth)
  }

  private async buildTree(dirPath: string, depth: number): Promise<FileTreeNode> {
    const name = path.basename(dirPath)
    const stat = await fs.stat(dirPath)

    if (!stat.isDirectory() || depth === 0) {
      return { id: dirPath, name, path: dirPath, isDirectory: stat.isDirectory() }
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const filtered = entries
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => {
        // 目录排在前面
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    const children = await Promise.all(
      filtered.map(e => this.buildTree(path.join(dirPath, e.name), depth - 1))
    )

    return { id: dirPath, name, path: dirPath, isDirectory: true, children }
  }

  /** 防止路径穿越攻击，确保路径在工作区内 */
  private resolveSafe(filePath: string): string {
    const abs = path.resolve(this.workspaceRoot, filePath)
    if (!abs.startsWith(this.workspaceRoot)) {
      throw new Error('Path traversal detected')
    }
    return abs
  }
}
```

### 7.3 注册 RPC Handler

```typescript
// apps/server/src/wsServer.ts 中的 routeRequest 函数追加：
case 'file.readFile': {
  const { filePath } = body
  const content = await fileService.readFile(filePath)
  return { content, encoding: 'utf-8' }
}
case 'file.writeFile': {
  const { filePath, content } = body
  await fileService.writeFile(filePath, content)
  return { success: true }
}
case 'file.listDirectory': {
  const { dirPath, depth } = body
  const tree = await fileService.listDirectory(dirPath, depth)
  return { tree }
}
```

### 7.4 前端 Hooks

```typescript
// apps/web/src/hooks/useFileContent.ts
import { useWs } from '../wsNativeApi'

export function useFileContent() {
  const ws = useWs()

  const fetchFile = async (filePath: string): Promise<string> => {
    const result = await ws.request('file.readFile', { filePath })
    return result.content
  }

  return { fetchFile }
}

// apps/web/src/hooks/useFileSave.ts
export function useFileSave() {
  const ws = useWs()

  const saveFile = async (filePath: string, content: string): Promise<void> => {
    await ws.request('file.writeFile', { filePath, content })
  }

  return { saveFile }
}

// apps/web/src/hooks/useFileTree.ts
import { useQuery } from '@tanstack/react-query'
import { useWs } from '../wsNativeApi'
import { useWorkspaceStore } from '../store/store'

export function useFileTree() {
  const ws = useWs()
  const workspacePath = useWorkspaceStore(s => s.workspacePath)

  return useQuery({
    queryKey: ['file-tree', workspacePath],
    queryFn: async () => {
      const result = await ws.request('file.listDirectory', {
        dirPath: workspacePath,
        depth: 6
      })
      return result.tree
    },
    enabled: !!workspacePath,
    staleTime: 30_000,
  })
}
```

---

## 8. 用户偏好设置集成

### 8.1 在设置页面新增布局选择

```typescript
// apps/web/src/components/settings/LayoutSettings.tsx
import { useLayoutStore } from '../../store/layoutStore'

export function LayoutSettings() {
  const { mode, setMode } = useLayoutStore()

  return (
    <section className="space-y-4">
      <h3 className="text-base font-semibold">界面布局</h3>
      <p className="text-sm text-muted-foreground">
        选择您偏好的界面布局模式。切换后立即生效，下次启动时保持您的选择。
      </p>

      <div className="grid grid-cols-2 gap-4">
        {/* Codex 模式卡片 */}
        <LayoutCard
          id="codex"
          title="Codex 模式（默认）"
          description="两栏布局，专注 AI 对话与 Diff 预览，简洁高效"
          preview={<CodexPreviewSVG />}
          selected={mode === 'codex'}
          onSelect={() => setMode('codex')}
        />

        {/* Cursor 模式卡片 */}
        <LayoutCard
          id="cursor"
          title="Cursor 模式"
          description="三栏布局，带完整代码编辑器，适合深度代码工作"
          preview={<CursorPreviewSVG />}
          selected={mode === 'cursor'}
          onSelect={() => setMode('cursor')}
        />
      </div>
    </section>
  )
}

function LayoutCard({ id, title, description, preview, selected, onSelect }) {
  return (
    <button
      onClick={onSelect}
      className={`
        flex flex-col gap-3 rounded-lg border-2 p-4 text-left transition-colors
        ${selected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50'
        }
      `}
    >
      <div className="h-24 w-full overflow-hidden rounded bg-muted">
        {preview}
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {selected && (
        <span className="text-xs font-medium text-primary">✓ 当前使用</span>
      )}
    </button>
  )
}
```

### 8.2 将设置挂载到现有设置面板

在 `apps/web/src/components/settings/` 下的现有设置组件（Settings.tsx 或类似文件）中：

```typescript
// 在设置面板的合适位置引入
import { LayoutSettings } from './LayoutSettings'

// 在 JSX 中添加新的设置分区：
<LayoutSettings />
```

---

## 9. 布局切换与路由

### 9.1 根路由动态渲染布局

```typescript
// apps/web/src/routes/_chat.tsx（修改）
import { Outlet } from '@tanstack/react-router'
import { useLayoutStore } from '../store/layoutStore'
import { CursorLayout } from '../components/layout/CursorLayout'

export function ChatLayout() {
  const mode = useLayoutStore(s => s.mode)

  if (mode === 'cursor') {
    // Cursor 模式：三栏布局包裹子路由内容
    return <CursorLayoutWrapper />
  }

  // Codex 模式：原有两栏布局
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}

function CursorLayoutWrapper() {
  const params = useParams({ strict: false })
  return <CursorLayout threadId={params.threadId} />
}
```

### 9.2 顶部栏快速切换按钮（可选）

在 `ChatView.tsx` 顶部工具栏中新增一个布局切换图标按钮：

```typescript
import { PanelLeft, LayoutPanelLeft } from 'lucide-react'
import { useLayoutStore } from '../store/layoutStore'

export function LayoutToggleButton() {
  const { mode, setMode } = useLayoutStore()
  const isCursor = mode === 'cursor'

  return (
    <button
      onClick={() => setMode(isCursor ? 'codex' : 'cursor')}
      title={isCursor ? '切换到 Codex 模式' : '切换到 Cursor 模式'}
      className="rounded p-1.5 hover:bg-accent"
    >
      {isCursor ? <PanelLeft size={16} /> : <LayoutPanelLeft size={16} />}
    </button>
  )
}
```

---

## 10. Monaco Editor 深度集成

### 10.1 多标签页管理

```typescript
// apps/web/src/components/editor/EditorTabs.tsx
import { X } from 'lucide-react'
import { useEditorStore } from '../../store/editorStore'

export function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditorStore()

  return (
    <div className="flex h-9 items-center overflow-x-auto border-b border-border bg-background">
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`
            group flex h-full min-w-0 max-w-[180px] cursor-pointer items-center
            gap-1.5 border-r border-border px-3 text-sm
            ${activeTabId === tab.id
              ? 'bg-background text-foreground'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }
          `}
        >
          <span className="truncate">{tab.fileName}</span>
          {tab.isDirty && <span className="h-2 w-2 rounded-full bg-orange-400" />}
          <button
            onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
            className="ml-auto opacity-0 group-hover:opacity-100 hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
```

### 10.2 AI 修改内容后的差异展示

当 AI 完成代码修改，需要在编辑器中展示差异：

```typescript
// apps/web/src/components/editor/EditorDiffOverlay.tsx
import { DiffEditor } from '@monaco-editor/react'
import { useEditorStore } from '../../store/editorStore'

interface EditorDiffOverlayProps {
  original: string
  modified: string
  language: string
  onAccept: () => void
  onReject: () => void
}

export function EditorDiffOverlay({
  original, modified, language, onAccept, onReject
}: EditorDiffOverlayProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">AI 建议的修改</span>
        <div className="flex gap-2">
          <button
            onClick={onReject}
            className="rounded px-3 py-1 text-sm hover:bg-muted"
          >
            拒绝
          </button>
          <button
            onClick={onAccept}
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
          >
            接受
          </button>
        </div>
      </div>
      <div className="flex-1">
        <DiffEditor
          height="100%"
          language={language}
          original={original}
          modified={modified}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: true,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  )
}
```

### 10.3 状态栏

```typescript
// apps/web/src/components/editor/EditorStatusBar.tsx
import type { EditorTab } from '../../store/editorStore'

export function EditorStatusBar({ tab }: { tab: EditorTab }) {
  return (
    <div className="flex h-6 items-center justify-between border-t border-border bg-muted/50 px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        <span>{tab.language}</span>
        {tab.isDirty && <span className="text-orange-400">● 已修改</span>}
      </div>
      <div className="flex items-center gap-4">
        <span>UTF-8</span>
        <span>
          行 {tab.cursorPosition?.line ?? 1}, 列 {tab.cursorPosition?.column ?? 1}
        </span>
      </div>
    </div>
  )
}
```

---

## 11. AI 与编辑器联动

### 11.1 AI 修改触发编辑器更新

当 AI 完成文件修改（通过现有的 Diff/Checkpoint 系统），需要把新内容同步到 Monaco 编辑器：

```typescript
// apps/web/src/hooks/useAiEditorSync.ts
import { useEffect } from 'react'
import { useWsStore } from '../store/store'
import { useEditorStore } from '../store/editorStore'

/**
 * 监听 AI 完成代码修改的 WS 推送事件，
 * 同步更新编辑器中对应文件的内容
 */
export function useAiEditorSync() {
  const { applyAiDiff } = useEditorStore()
  const wsChannel = useWsStore(s => s.channels['file.changed'])

  useEffect(() => {
    if (!wsChannel) return
    // 当服务器推送 file.changed 事件时，更新编辑器内容
    const handler = (event: { filePath: string; newContent: string }) => {
      applyAiDiff(event.filePath, event.newContent)
    }
    wsChannel.subscribe(handler)
    return () => wsChannel.unsubscribe(handler)
  }, [wsChannel, applyAiDiff])
}
```

### 11.2 编辑器中右键菜单"用 AI 解释/重写"

```typescript
// 在 MonacoEditor.tsx 的 onMount 回调中注册上下文菜单
editor.addAction({
  id: 'ai-explain-selection',
  label: '🤖 用 AI 解释选中代码',
  contextMenuGroupId: 'ai',
  contextMenuOrder: 1,
  run: (ed) => {
    const selection = ed.getSelection()
    const selectedText = ed.getModel()?.getValueInRange(selection)
    if (selectedText) {
      // 将选中文本发送到右侧 AI 对话面板
      useChatStore.getState().sendMessage(
        `请解释以下代码：\n\`\`\`\n${selectedText}\n\`\`\``
      )
    }
  }
})

editor.addAction({
  id: 'ai-rewrite-selection',
  label: '🤖 用 AI 重写选中代码',
  contextMenuGroupId: 'ai',
  contextMenuOrder: 2,
  run: (ed) => {
    const selection = ed.getSelection()
    const selectedText = ed.getModel()?.getValueInRange(selection)
    if (selectedText) {
      useChatStore.getState().sendMessage(
        `请重写以下代码，使其更清晰、高效：\n\`\`\`\n${selectedText}\n\`\`\``
      )
    }
  }
})
```

---

## 12. 开发计划与里程碑

### 阶段 1：基础框架（1~2 周）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| 安装并配置 Monaco Editor + Vite 插件 | P0 | 验证 Monaco 在项目中可用 |
| 实现 `editorStore` 和 `layoutStore` | P0 | 状态管理基础 |
| 实现三栏 `CursorLayout` 骨架 | P0 | 布局容器，各栏先用占位内容 |
| 在设置页新增布局切换 UI | P0 | 用户可以切换模式 |
| 路由层根据 `layoutMode` 渲染不同布局 | P0 | 切换生效 |

### 阶段 2：编辑器功能（1~2 周）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| 实现 `MonacoEditorPanel` | P0 | 核心编辑器面板 |
| 实现多标签页 `EditorTabs` | P0 | 多文件同时打开 |
| 后端 `fileService` + WS RPC | P0 | 文件读写 |
| 前端 `useFileContent` / `useFileSave` hooks | P0 | 读写 hooks |
| Ctrl+S 保存快捷键 | P1 | 用户习惯 |
| 编辑器状态栏 | P2 | 行列号、语言显示 |

### 阶段 3：文件树（1 周）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| `file.listDirectory` 后端实现 | P0 | 目录树数据 |
| `FileTree` 组件 | P0 | 可视化目录树 |
| 点击文件在编辑器中打开 | P0 | 核心交互 |
| 文件树图标（根据文件类型） | P2 | 视觉优化 |

### 阶段 4：AI 联动（1 周）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| AI 修改后同步到编辑器 | P0 | `useAiEditorSync` |
| Diff 视图（接受/拒绝 AI 修改） | P1 | `EditorDiffOverlay` |
| 右键菜单"用 AI 解释/重写" | P2 | 增强体验 |

### 阶段 5：打磨与测试（1 周）

| 任务 | 说明 |
|------|------|
| 面板宽度记忆持久化 | 用户调整面板宽度后下次保持 |
| Electron 桌面端适配测试 | 确保 Monaco 在 Electron 渲染进程中正常工作 |
| 性能测试（大文件） | Monaco 处理 10k+ 行文件的性能验证 |
| 主题适配 | 跟随 t3code 现有的亮/暗主题 |
| 单元测试 | `editorStore`、`layoutStore` 的状态逻辑 |

---

## 13. 风险与注意事项

### 13.1 Monaco 包体积

Monaco Editor 核心 + 所有 worker 约 5~8MB。建议：
- 使用 `vite-plugin-monaco-editor` 实现按需加载
- 语言 worker 仅加载常用语言（ts/js/json/css/html）
- 利用 CDN 加载 Monaco（`loader.config({ paths: { vs: '...' } })`）

### 13.2 Electron 渲染进程中的 Monaco

Monaco 在 Electron 渲染进程中运行需要注意：
- `contextIsolation: true` 环境下 Monaco 需要通过 `preload.ts` 暴露 `desktopBridge`
- Worker 路径需要用 `file://` 协议
- 建议在 `apps/desktop/src/main.ts` 中设置 `webSecurity: false`（开发环境）或使用 CSP 白名单

### 13.3 文件路径安全

后端 `fileService` 必须严格校验路径，防止路径穿越（path traversal）攻击。示例代码中已包含 `resolveSafe()` 方法，实际部署前需要完整的安全审计。

### 13.4 大文件性能

Monaco 默认对超过 5MB 的文件禁用 IntelliSense。对于大型代码仓库，建议：
- 文件树采用懒加载（按需展开目录）
- 读取文件时添加大小限制（如 > 2MB 警告用户）

### 13.5 与现有 Diff 系统的兼容

t3code 现有 `DiffPanel.tsx` 是 AI 修改的主要展示入口。在 Cursor 模式下，需要决策：
- 方案 A：保留 DiffPanel，显示在右侧 AI 面板下方（堆叠）
- 方案 B：AI 修改直接反映到编辑器内联 Diff（推荐，体验更自然）

推荐方案 B，即拦截 AI 修改的 WS 推送事件，使用 Monaco 的内置 Diff 视图展示，用户接受后写入磁盘。

---

## 附录：关键依赖版本参考

| 包名 | 推荐版本 | 用途 |
|------|---------|------|
| `@monaco-editor/react` | `^4.6.0` | Monaco React 封装 |
| `monaco-editor` | `^0.47.0` | Monaco 核心 |
| `vite-plugin-monaco-editor` | `^1.1.0` | Vite 构建配置 |
| `react-resizable-panels` | `^2.0.0` | 可拖拽分割面板 |
| `react-arborist` | `^3.4.0` | 文件树组件 |

---

*文档版本：v1.0 · 2026-05-10*
