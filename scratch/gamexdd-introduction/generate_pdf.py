from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


OUTPUT = Path(__file__).with_name("gamexdd-introduction.pdf")
FONT_REGULAR = r"C:\Windows\Fonts\Noto Sans SC (TrueType).otf"
FONT_BOLD = r"C:\Windows\Fonts\Noto Sans SC Bold (TrueType).otf"


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("NotoSansSC", FONT_REGULAR))
    pdfmetrics.registerFont(TTFont("NotoSansSC-Bold", FONT_BOLD))


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            parent=base["Title"],
            fontName="NotoSansSC-Bold",
            fontSize=28,
            leading=36,
            textColor=colors.HexColor("#16324a"),
            alignment=TA_CENTER,
            spaceAfter=18,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["BodyText"],
            fontName="NotoSansSC",
            fontSize=12,
            leading=20,
            textColor=colors.HexColor("#40515f"),
            alignment=TA_CENTER,
            spaceAfter=18,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="NotoSansSC-Bold",
            fontSize=18,
            leading=24,
            textColor=colors.HexColor("#16324a"),
            spaceBefore=8,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="NotoSansSC-Bold",
            fontSize=13,
            leading=18,
            textColor=colors.HexColor("#1d4d69"),
            spaceBefore=8,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="NotoSansSC",
            fontSize=10.5,
            leading=17,
            textColor=colors.HexColor("#202124"),
            spaceAfter=6,
        ),
        "lead": ParagraphStyle(
            "lead",
            parent=base["BodyText"],
            fontName="NotoSansSC",
            fontSize=11,
            leading=18,
            textColor=colors.HexColor("#263945"),
            backColor=colors.HexColor("#eef7fb"),
            borderColor=colors.HexColor("#1f6f8b"),
            borderWidth=1,
            borderPadding=8,
            spaceAfter=10,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["BodyText"],
            fontName="NotoSansSC",
            fontSize=8.5,
            leading=13,
            textColor=colors.HexColor("#6b7680"),
        ),
        "cell": ParagraphStyle(
            "cell",
            parent=base["BodyText"],
            fontName="NotoSansSC",
            fontSize=9,
            leading=14,
        ),
        "cell_bold": ParagraphStyle(
            "cell_bold",
            parent=base["BodyText"],
            fontName="NotoSansSC-Bold",
            fontSize=9,
            leading=14,
            textColor=colors.HexColor("#19344b"),
        ),
    }


def p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text, style)


def bullets(items: list[str], style: ParagraphStyle) -> ListFlowable:
    return ListFlowable(
        [ListItem(p(item, style), leftIndent=8) for item in items],
        bulletType="bullet",
        leftIndent=14,
        bulletFontName="NotoSansSC",
        bulletFontSize=8,
    )


def numbered(items: list[str], style: ParagraphStyle) -> ListFlowable:
    return ListFlowable(
        [ListItem(p(item, style), leftIndent=12) for item in items],
        bulletType="1",
        leftIndent=16,
        bulletFontName="NotoSansSC",
        bulletFontSize=9,
    )


def table(rows: list[list[str]], col_widths: list[float], s: dict[str, ParagraphStyle]) -> Table:
    data = []
    for row_index, row in enumerate(rows):
        row_style = s["cell_bold"] if row_index == 0 else s["cell"]
        data.append([p(cell, row_style) for cell in row])
    result = Table(data, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    result.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), "NotoSansSC"),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef5f9")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#19344b")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d6e0e8")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ],
        ),
    )
    return result


def footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("NotoSansSC", 8)
    canvas.setFillColor(colors.HexColor("#7a858f"))
    text = f"GameXDD 遊戲平台介紹文檔 | 第 {doc.page} 頁"
    canvas.drawRightString(A4[0] - 16 * mm, 10 * mm, text)
    canvas.restoreState()


def build() -> None:
    register_fonts()
    s = styles()
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=17 * mm,
        bottomMargin=16 * mm,
        title="GameXDD 遊戲平台介紹文檔",
        author="T3 Code",
    )

    story = [
        Spacer(1, 34 * mm),
        p("GameXDD 遊戲平台介紹文檔", s["title"]),
        p(
            "基於 GameXDD 官方公開頁面整理，面向合作方、營運團隊與新用戶，快速說明平台定位、功能入口、內容矩陣、會員福利與服務保障。",
            s["subtitle"],
        ),
        Spacer(1, 18 * mm),
        table(
            [
                ["項目", "內容"],
                ["網站", "https://www.gamexdd.com/"],
                ["整理日期", "2026 年 5 月 22 日"],
                ["文檔類型", "平台介紹 / 商務簡報版"],
            ],
            [38 * mm, 118 * mm],
            s,
        ),
        Spacer(1, 18 * mm),
        p("本文檔為公開資料整理，不代表 GameXDD 官方背書或授權。", s["small"]),
        PageBreak(),
    ]

    story += [
        p("目錄", s["h1"]),
        bullets(
            [
                "1. 平台概覽",
                "2. 核心功能與入口",
                "3. 遊戲內容矩陣",
                "4. 會員與福利體系",
                "5. 客服、條款與隱私",
                "6. 使用者旅程與營運價值",
                "7. 建議使用場景",
                "8. 資料來源與聲明",
            ],
            s["body"],
        ),
        Spacer(1, 6 * mm),
        p("1. 平台概覽", s["h1"]),
        p(
            "GameXDD 是一個面向繁體中文用戶的線上遊戲平台。從公開頁面可見，網站以「遊戲內容展示、帳號會員、遊戲儲值、禮包福利、客服支援與活動公告」為主要能力，聚焦於玩家進入遊戲、獲取福利、完成儲值與獲得售後服務的完整流程。",
            s["lead"],
        ),
        p(
            "官網首頁呈現多款遊戲內容與「HOT」推薦標識，並提供「遊戲儲值」「我的遊戲」「禮包」「會員中心」「遊戲庫」「客服中心」「新聞公告」等導航入口。整體設計更接近遊戲發行或聯運平台，用戶可透過同一網站完成發現遊戲、進入遊戲、查找公告、領取福利及處理帳務問題。",
            s["body"],
        ),
        p("平台關鍵詞：繁體中文遊戲平台、線上遊戲入口、會員中心、儲值服務、禮包福利、客服中心。", s["body"]),
        p("2. 核心功能與入口", s["h1"]),
        table(
            [
                ["功能模組", "公開頁面呈現", "對用戶的價值"],
                ["首頁與遊戲推薦", "展示熱門遊戲、遊戲名稱、類型標識與進入遊戲入口。", "降低新用戶找遊戲成本，讓玩家快速進入熱門內容。"],
                ["遊戲庫", "提供更完整的遊戲列表瀏覽入口。", "便於按興趣探索平台已上架內容。"],
                ["遊戲儲值", "首頁導航中提供明確的儲值入口。", "支撐付費轉化與玩家遊戲內消費。"],
                ["禮包與活動", "網站提供禮包入口，首頁同時呈現新聞與公告列表。", "提高玩家留存，讓回訪用戶持續獲得福利與活動資訊。"],
                ["會員中心", "公開入口包含登入、註冊與會員相關頁面。", "承載帳號、身份、玩家資料與跨遊戲服務體系。"],
                ["客服中心", "提供客服與常見問題入口，支援用戶尋求協助。", "處理帳號、支付、遊戲問題，提升平台可信度。"],
            ],
            [34 * mm, 78 * mm, 48 * mm],
            s,
        ),
        PageBreak(),
    ]

    story += [
        p("3. 遊戲內容矩陣", s["h1"]),
        p(
            "從官網首頁與遊戲展示區可見，GameXDD 上架或推薦的遊戲包括《混沌戰域》《逍遙情緣》《熱血大明》《熱血封神》《龍將》《暮影戰神》《烈焰飛雪》《熱血三國 3》《七魄》《七絕》《劍俠情緣 2》《神魔遮天》《寒刀》《三國之志 2》《醉武俠》等。這些名稱呈現出平台以角色扮演、武俠、仙俠、傳奇風格、三國策略與頁遊式長線營運產品為主。",
            s["body"],
        ),
        p("內容特徵", s["h2"]),
        bullets(
            [
                "題材集中在武俠、仙俠、戰國、三國、封神與熱血戰鬥等中文玩家熟悉的世界觀。",
                "多款遊戲具備長線營運屬性，適合搭配活動、公告、禮包與儲值服務。",
                "首頁以熱門標識突出部分產品，便於平台根據營運重點調整曝光。",
            ],
            s["body"],
        ),
        p("玩家吸引點", s["h2"]),
        bullets(
            [
                "玩家可在同一平台發現多款同類型遊戲，減少重複註冊與查找成本。",
                "禮包、公告與客服入口集中，讓回流玩家更容易接續既有遊戲進度。",
                "平台型入口有利於跨遊戲導流與老用戶再啟動。",
            ],
            s["body"],
        ),
        p("4. 會員與福利體系", s["h1"]),
        p(
            "GameXDD 將會員中心、我的遊戲、禮包與遊戲儲值放在導航層級，說明平台並非單純資訊展示站，而是圍繞玩家帳號與遊戲服務建立的營運型站點。對玩家而言，會員體系的價值在於集中管理身份、遊戲記錄、充值與福利；對平台而言，會員體系則支撐用戶留存、付費轉化和精細化活動推送。",
            s["body"],
        ),
        table(
            [
                ["體系", "可能承載內容", "營運價值"],
                ["會員帳號", "登入、註冊、身份識別、玩家資料管理。", "建立跨遊戲的統一用戶身份，便於長期服務。"],
                ["我的遊戲", "已玩遊戲、快捷返回、帳號關聯內容。", "縮短老玩家回訪路徑，提高活躍度。"],
                ["禮包福利", "新手禮包、活動福利、回歸獎勵等。", "用低成本權益促進註冊、回訪與活動參與。"],
                ["儲值服務", "遊戲充值、支付指引、帳務相關服務。", "承接商業化流程，是平台收入轉化的重要入口。"],
            ],
            [33 * mm, 70 * mm, 57 * mm],
            s,
        ),
        PageBreak(),
    ]

    story += [
        p("5. 客服、條款與隱私", s["h1"]),
        p(
            "官方頁面包含「客服中心」「服務條款」「隱私政策」以及「認識 GameXDD」等內容，這對遊戲平台尤為重要。玩家在註冊、遊玩、儲值或尋求售後支援時，需要明確知道平台如何處理帳號、服務規則、個人資料與問題回報。",
            s["body"],
        ),
        p("客服支援", s["h2"]),
        p(
            "客服中心承擔問題分流和服務承接作用，通常覆蓋帳號登入、儲值異常、遊戲問題、活動獎勵、資料修改等場景。對付費遊戲平台而言，客服入口是否清晰會直接影響玩家信任與問題處理效率。",
            s["body"],
        ),
        p("條款與政策", s["h2"]),
        p(
            "服務條款與隱私政策構成平台規則說明，包含用戶權利義務、資料處理、服務使用限制、爭議處理等內容。介紹材料中應提示讀者以官方最新頁面為準。",
            s["body"],
        ),
        p("6. 使用者旅程與營運價值", s["h1"]),
        numbered(
            [
                "<b>發現：</b>用戶透過首頁熱門推薦、遊戲庫或活動公告了解平台遊戲。",
                "<b>註冊：</b>用戶進入會員中心完成登入或註冊，形成平台統一身份。",
                "<b>進入遊戲：</b>用戶從首頁、遊戲庫或我的遊戲進入具體產品。",
                "<b>領取福利：</b>用戶透過禮包或活動頁獲取新手、活動或回歸福利。",
                "<b>儲值付費：</b>用戶在需要提升遊戲體驗時使用遊戲儲值入口完成付費。",
                "<b>客服與留存：</b>遇到帳號、支付或遊戲問題時，透過客服中心處理並回到遊戲。",
            ],
            s["body"],
        ),
        p(
            "這一路徑說明 GameXDD 的核心不是單點遊戲展示，而是把內容、帳號、福利、支付與服務連成閉環。對營運團隊而言，這種結構便於圍繞不同遊戲做分發、活動、禮包、公告與用戶回流。",
            s["body"],
        ),
        p("7. 建議使用場景", s["h1"]),
        table(
            [
                ["讀者 / 場景", "可關注重點"],
                ["新玩家", "查看熱門遊戲、遊戲庫、禮包入口與客服中心，快速完成註冊並進入遊戲。"],
                ["合作方", "關注平台的遊戲矩陣、會員承接能力、活動公告能力與付費服務入口。"],
                ["營運團隊", "關注首頁曝光位、HOT 推薦、公告更新、禮包配置和客服問題閉環。"],
                ["客服與風控", "關注服務條款、隱私政策、帳務問題處理與用戶申訴路徑。"],
            ],
            [42 * mm, 118 * mm],
            s,
        ),
        PageBreak(),
    ]

    story += [
        p("8. 資料來源與聲明", s["h1"]),
        p(
            "本文檔依據 GameXDD 官方網站可公開訪問頁面整理，並對頁面資訊做了結構化歸納。由於遊戲上架、活動、會員規則、客服政策與法律條款可能更新，正式使用時應再次核對官方最新頁面。",
            s["body"],
        ),
        bullets(
            [
                "GameXDD 首頁：https://www.gamexdd.com/",
                "認識 GameXDD：https://www.gamexdd.com/Service/about/gamexdd",
                "客服中心：https://www.gamexdd.com/Service",
                "隱私政策：https://www.gamexdd.com/Service/about/private",
                "會員 / VIP 相關頁：https://www.gamexdd.com/User/vipinfo",
            ],
            s["body"],
        ),
        p("附錄：一句話介紹", s["h1"]),
        p(
            "GameXDD 是一個面向繁體中文玩家的線上遊戲平台，透過遊戲庫、會員中心、禮包福利、遊戲儲值、公告與客服中心，為玩家提供從發現遊戲到持續遊玩的完整服務入口。",
            s["lead"],
        ),
        p("附錄：對外簡介模板", s["h1"]),
        p(
            "GameXDD 聚合多款武俠、仙俠、策略與熱血題材線上遊戲，提供會員登入、遊戲入口、禮包福利、遊戲儲值、新聞公告與客服支援等服務。平台適合希望快速探索中文遊戲內容的玩家，也可作為遊戲產品營運、活動發布與玩家服務的集中入口。",
            s["body"],
        ),
        p(
            "建議在正式對外發布前，由網站方確認品牌稱謂、公司資訊、版權歸屬、支付政策、客服時間與最新遊戲清單。",
            s["lead"],
        ),
    ]

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    build()
    print(OUTPUT)
