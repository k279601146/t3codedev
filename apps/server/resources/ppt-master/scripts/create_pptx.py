#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从简洁 JSON 规格生成可编辑 PPTX。

这个脚本只使用 Python 标准库，适合作为 T3 Code 内置 PPT Master 的保底生成器。
它生成的是 Office Open XML 形状和文本框，用户可以在 PowerPoint/WPS 中继续编辑。
"""

from __future__ import annotations

import json
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape


EMU_PER_INCH = 914400
SLIDE_WIDTH = 13.333333
SLIDE_HEIGHT = 7.5


@dataclass(frozen=True)
class Theme:
    name: str
    background: str
    title: str
    body: str
    accent: str
    muted: str


THEMES: dict[str, Theme] = {
    "modern": Theme("modern", "F7F8FA", "111827", "243042", "147DFF", "6B7280"),
    "consulting": Theme("consulting", "FFFFFF", "172033", "253044", "0F766E", "64748B"),
    "academic": Theme("academic", "FBFAF7", "1F2937", "374151", "8B5CF6", "6B7280"),
    "dark": Theme("dark", "111827", "F9FAFB", "D1D5DB", "38BDF8", "9CA3AF"),
}


def emu(inches: float) -> int:
    return int(inches * EMU_PER_INCH)


def xml_text(value: Any) -> str:
    return escape(str(value), {'"': "&quot;"})


def color_fill(color: str) -> str:
    return f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'


def text_box(
    shape_id: int,
    name: str,
    x: float,
    y: float,
    width: float,
    height: float,
    paragraphs: list[tuple[str, int, str, bool]],
) -> str:
    paragraph_xml = []
    for text, size, color, bold in paragraphs:
        paragraph_xml.append(
            "<a:p>"
            f'<a:r><a:rPr lang="zh-CN" sz="{size}"{" b=\"1\"" if bold else ""}>'
            f"{color_fill(color)}</a:rPr><a:t>{xml_text(text)}</a:t></a:r>"
            '<a:endParaRPr lang="zh-CN"/>'
            "</a:p>"
        )
    return (
        "<p:sp>"
        "<p:nvSpPr>"
        f'<p:cNvPr id="{shape_id}" name="{xml_text(name)}"/>'
        '<p:cNvSpPr txBox="1"/><p:nvPr/>'
        "</p:nvSpPr>"
        "<p:spPr>"
        f'<a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(width)}" cy="{emu(height)}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>'
        "</p:spPr>"
        '<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>'
        + "".join(paragraph_xml)
        + "</p:txBody></p:sp>"
    )


def bullet_box(
    shape_id: int,
    bullets: list[str],
    theme: Theme,
    x: float,
    y: float,
    width: float,
    height: float,
) -> str:
    paragraph_xml = []
    for bullet in bullets:
        paragraph_xml.append(
            "<a:p>"
            '<a:pPr marL="342900" indent="-171450"><a:buChar char="•"/></a:pPr>'
            f'<a:r><a:rPr lang="zh-CN" sz="2100">{color_fill(theme.body)}</a:rPr>'
            f"<a:t>{xml_text(bullet)}</a:t></a:r>"
            '<a:endParaRPr lang="zh-CN"/>'
            "</a:p>"
        )
    return (
        text_box(shape_id, "Bullets", x, y, width, height, [])[:-15]
        + "".join(paragraph_xml)
        + "</p:txBody></p:sp>"
    )


def accent_bar(theme: Theme) -> str:
    return (
        '<p:sp><p:nvSpPr><p:cNvPr id="50" name="Accent"/>'
        "<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>"
        f'<a:xfrm><a:off x="{emu(0.0)}" y="{emu(0.0)}"/><a:ext cx="{emu(0.12)}" cy="{emu(SLIDE_HEIGHT)}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        f"{color_fill(theme.accent)}<a:ln><a:noFill/></a:ln>"
        "</p:spPr></p:sp>"
    )


def slide_xml(index: int, title: str, bullets: list[str], theme: Theme, subtitle: str | None = None) -> str:
    safe_bullets = [item for item in bullets if str(item).strip()][:7]
    shapes = [
        accent_bar(theme),
        text_box(
            2,
            "Title",
            0.75,
            0.58,
            11.7,
            1.1,
            [(title, 3600 if index == 1 else 3000, theme.title, True)],
        ),
    ]
    if subtitle:
        shapes.append(text_box(3, "Subtitle", 0.78, 1.62, 10.8, 0.7, [(subtitle, 1700, theme.muted, False)]))
    if safe_bullets:
        shapes.append(bullet_box(4, safe_bullets, theme, 1.0, 2.15, 11.2, 4.25))
    shapes.append(text_box(5, "Footer", 10.7, 6.95, 1.75, 0.3, [(f"{index}", 1100, theme.muted, False)]))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        f'<p:cSld><p:bg><p:bgPr>{color_fill(theme.background)}</p:bgPr></p:bg><p:spTree>'
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
        + "".join(shapes)
        + "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
    )


def content_types(slide_count: int) -> str:
    overrides = [
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ]
    overrides.extend(
        f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for i in range(1, slide_count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        + "".join(overrides)
        + "</Types>"
    )


def rels_xml(entries: list[tuple[str, str, str]]) -> str:
    relationships = [
        f'<Relationship Id="{rid}" Type="{rel_type}" Target="{target}"/>'
        for rid, rel_type, target in entries
    ]
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(relationships)
        + "</Relationships>"
    )


def presentation_xml(slide_count: int) -> str:
    slide_ids = "".join(f'<p:sldId id="{255 + i}" r:id="rId{i}"/>' for i in range(1, slide_count + 1))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        f'<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId{slide_count + 1}"/></p:sldMasterIdLst>'
        f"<p:sldIdLst>{slide_ids}</p:sldIdLst>"
        f'<p:sldSz cx="{emu(SLIDE_WIDTH)}" cy="{emu(SLIDE_HEIGHT)}" type="wide"/>'
        '<p:notesSz cx="6858000" cy="9144000"/>'
        "</p:presentation>"
    )


def slide_master_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>'
        "<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>"
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
        '<p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst>'
        "</p:sldMaster>"
    )


def slide_layout_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">'
        '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>'
        "<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>"
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'
        "</p:sldLayout>"
    )


def theme_xml(theme: Theme) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T3 PPT Master">'
        '<a:themeElements><a:clrScheme name="T3">'
        f'<a:dk1><a:srgbClr val="{theme.title}"/></a:dk1><a:lt1><a:srgbClr val="{theme.background}"/></a:lt1>'
        '<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F9FAFB"/></a:lt2>'
        f'<a:accent1><a:srgbClr val="{theme.accent}"/></a:accent1><a:accent2><a:srgbClr val="22C55E"/></a:accent2>'
        '<a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="EF4444"/></a:accent4>'
        '<a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="06B6D4"/></a:accent6>'
        '<a:hlink><a:srgbClr val="147DFF"/></a:hlink><a:folHlink><a:srgbClr val="8B5CF6"/></a:folHlink>'
        '</a:clrScheme><a:fontScheme name="T3"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="T3"/></a:themeElements>'
        "</a:theme>"
    )


def normalize_spec(raw: dict[str, Any]) -> tuple[str, str, Theme, list[dict[str, Any]]]:
    title = str(raw.get("title") or "未命名演示文稿").strip()
    subtitle = str(raw.get("subtitle") or "").strip()
    theme = THEMES.get(str(raw.get("theme") or "modern").strip().lower(), THEMES["modern"])
    slides = raw.get("slides")
    if not isinstance(slides, list) or not slides:
        slides = [{"title": title, "bullets": [subtitle or "请补充演示内容"]}]
    normalized = []
    for item in slides:
        if not isinstance(item, dict):
            continue
        bullets = item.get("bullets")
        normalized.append(
            {
                "title": str(item.get("title") or title).strip(),
                "bullets": [str(b).strip() for b in bullets if str(b).strip()] if isinstance(bullets, list) else [],
                "notes": str(item.get("notes") or "").strip(),
            }
        )
    return title, subtitle, theme, normalized or [{"title": title, "bullets": []}]


def write_notes(output_path: Path, slides: list[dict[str, Any]]) -> None:
    notes = []
    for index, slide in enumerate(slides, 1):
        note = str(slide.get("notes") or "").strip()
        if note:
            notes.append(f"## 第 {index} 页：{slide.get('title', '')}\n\n{note}\n")
    if notes:
        output_path.with_suffix(".notes.md").write_text("\n".join(notes), encoding="utf-8")


def create_pptx(spec_path: Path, output_path: Path) -> None:
    raw = json.loads(spec_path.read_text(encoding="utf-8"))
    title, subtitle, theme, slides = normalize_spec(raw)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    slide_count = len(slides)

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as pptx:
        pptx.writestr("[Content_Types].xml", content_types(slide_count))
        pptx.writestr(
            "_rels/.rels",
            rels_xml(
                [
                    ("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "ppt/presentation.xml"),
                    ("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"),
                    ("rId3", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", "docProps/app.xml"),
                ]
            ),
        )
        presentation_rels = [
            (f"rId{i}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide", f"slides/slide{i}.xml")
            for i in range(1, slide_count + 1)
        ]
        presentation_rels.extend(
            [
                (f"rId{slide_count + 1}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster", "slideMasters/slideMaster1.xml"),
                (f"rId{slide_count + 2}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme", "theme/theme1.xml"),
            ]
        )
        pptx.writestr("ppt/presentation.xml", presentation_xml(slide_count))
        pptx.writestr("ppt/_rels/presentation.xml.rels", rels_xml(presentation_rels))
        pptx.writestr("ppt/slideMasters/slideMaster1.xml", slide_master_xml())
        pptx.writestr(
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            rels_xml([("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout", "../slideLayouts/slideLayout1.xml")]),
        )
        pptx.writestr("ppt/slideLayouts/slideLayout1.xml", slide_layout_xml())
        pptx.writestr(
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            rels_xml([("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster", "../slideMasters/slideMaster1.xml")]),
        )
        pptx.writestr("ppt/theme/theme1.xml", theme_xml(theme))
        for index, slide in enumerate(slides, 1):
            pptx.writestr(
                f"ppt/slides/slide{index}.xml",
                slide_xml(index, str(slide["title"]), list(slide["bullets"]), theme, subtitle if index == 1 else None),
            )
            pptx.writestr(
                f"ppt/slides/_rels/slide{index}.xml.rels",
                rels_xml([("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout", "../slideLayouts/slideLayout1.xml")]),
            )
        pptx.writestr(
            "docProps/core.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>'
            f"{xml_text(title)}</dc:title></cp:coreProperties>",
        )
        pptx.writestr(
            "docProps/app.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
            f"<Application>T3 Code PPT Master</Application><Slides>{slide_count}</Slides></Properties>",
        )
    write_notes(output_path, slides)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("用法: create_pptx.py <spec.json> <output.pptx>", file=sys.stderr)
        return 2
    create_pptx(Path(argv[1]), Path(argv[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
