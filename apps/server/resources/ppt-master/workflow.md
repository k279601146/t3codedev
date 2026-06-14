# T3 Code PPT Master

当用户要求制作、改写、优化或导出演示文稿时使用本工作流。目标是生成真实可编辑的 `.pptx` 文件，而不是把每页做成一张图片。

## 工作流

1. 先确认演示目标、受众、页数、语言、交付格式和素材来源；如果信息不足，先按合理假设继续，并在回复中列出假设。
2. 产出结构化大纲：封面、议程、正文分节、数据/证据页、结论和行动项。
3. 选择主题：`modern`、`consulting`、`academic` 或 `dark`。如果用户没有指定，默认使用 `modern`。
4. 在 workspace 中创建一个 JSON 规格文件，例如 `presentation.spec.json`。
5. 调用 T3 Code 内置生成器导出 PPTX。优先从 `T3CODE_SERVER_RESOURCES_PATH` 定位资源目录：

```powershell
python "$env:T3CODE_SERVER_RESOURCES_PATH/ppt-master/scripts/create_pptx.py" presentation.spec.json exports/presentation.pptx
```

如果没有该环境变量，开发环境路径通常是：

```bash
python apps/server/resources/ppt-master/scripts/create_pptx.py presentation.spec.json exports/presentation.pptx
```

桌面打包后该生成器会随 T3 Code server resources 分发，位于安装包内的 `apps/server/resources/ppt-master/scripts/create_pptx.py`。

6. 生成后检查文件是否存在，并告诉用户输出路径、页数和主要内容。

## JSON 规格

脚本接受如下结构：

```json
{
  "title": "演示标题",
  "subtitle": "副标题或场景说明",
  "theme": "modern",
  "slides": [
    {
      "title": "页面标题",
      "bullets": ["要点一", "要点二"],
      "notes": "讲稿或备注"
    }
  ]
}
```

## 质量要求

- 每页聚焦一个观点，标题要能表达结论。
- 文字保持短句，避免把长文档直接塞进页面。
- 数据页要说明指标、时间范围和数据口径。
- 产出的 PPTX 必须由可编辑文本框组成；只有用户明确要求时才使用整页图片。
- 如需要图片、图标、品牌模板或复杂图表，先生成 PPTX 主体，再说明还需要哪些素材或后续增强。
