from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "Q3考高斯刷题_各平台使用指南_A4.pdf"
REGULAR_FONT = Path(r"C:\Windows\Fonts\msyh.ttc")
BOLD_FONT = Path(r"C:\Windows\Fonts\msyhbd.ttc")
FALLBACK_FONT = Path(r"C:\Windows\Fonts\simhei.ttf")


def register_fonts():
    try:
        pdfmetrics.registerFont(TTFont("GuideCN", str(REGULAR_FONT)))
        pdfmetrics.registerFont(TTFont("GuideCN-Bold", str(BOLD_FONT)))
    except Exception:
        pdfmetrics.registerFont(TTFont("GuideCN", str(FALLBACK_FONT)))
        pdfmetrics.registerFont(TTFont("GuideCN-Bold", str(FALLBACK_FONT)))


def rounded_box(c, x, y, width, height, fill, stroke=None, radius=12, line_width=1):
    c.setFillColor(HexColor(fill))
    c.setStrokeColor(HexColor(stroke or fill))
    c.setLineWidth(line_width)
    c.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def text(c, x, y, value, size=9, color="#1E293B", bold=False):
    c.setFillColor(HexColor(color))
    c.setFont("GuideCN-Bold" if bold else "GuideCN", size)
    c.drawString(x, y, value)


def draw_platform_icon(c, kind, x, y, color):
    c.setFillColor(HexColor(color))
    c.setStrokeColor(HexColor(color))
    c.setLineWidth(1.8)
    if kind == "windows":
        for dx, dy in ((0, 18), (15, 18), (0, 3), (15, 3)):
            c.rect(x + dx, y + dy, 12, 12, fill=1, stroke=0)
    elif kind == "mac":
        c.roundRect(x, y + 8, 30, 22, 3, fill=0, stroke=1)
        c.line(x - 2, y + 5, x + 32, y + 5)
        c.line(x + 6, y + 1, x + 24, y + 1)
        text(c, x + 5, y + 15, "M/Intel", 6.5, color, True)
    elif kind == "android":
        c.roundRect(x + 3, y + 7, 27, 24, 6, fill=1, stroke=0)
        c.line(x + 8, y + 31, x + 4, y + 37)
        c.line(x + 25, y + 31, x + 29, y + 37)
        c.circle(x + 11, y + 24, 1.3, fill=1, stroke=0)
        c.circle(x + 22, y + 24, 1.3, fill=1, stroke=0)
    else:
        c.circle(x + 16, y + 19, 16, fill=0, stroke=1)
        c.ellipse(x + 8, y + 3, x + 24, y + 35, fill=0, stroke=1)
        c.line(x, y + 19, x + 32, y + 19)
        c.line(x + 3, y + 10, x + 29, y + 10)
        c.line(x + 3, y + 28, x + 29, y + 28)


def draw_platform_row(c, y, title, badge, kind, color, columns):
    x = 28
    width = A4[0] - 56
    height = 105
    rounded_box(c, x, y, width, height, "#FFFFFF", "#D8E2F1", 14, 0.8)
    rounded_box(c, x, y, 7, height, color, color, 4, 0)
    c.setFillColor(HexColor("#EEF4FF"))
    c.circle(x + 36, y + height - 32, 22, fill=1, stroke=0)
    draw_platform_icon(c, kind, x + 20, y + height - 52, color)
    text(c, x + 68, y + height - 27, title, 16, "#0F274A", True)
    rounded_box(c, x + 68, y + height - 49, 88, 18, "#EDF4FF", "#EDF4FF", 9, 0)
    text(c, x + 78, y + height - 44, badge, 7.5, color, True)

    start_x = x + 178
    col_width = (width - 196) / 3
    for index, (heading, lines) in enumerate(columns):
        col_x = start_x + index * col_width
        if index:
            c.setStrokeColor(HexColor("#E6ECF5"))
            c.setLineWidth(0.7)
            c.line(col_x - 9, y + 15, col_x - 9, y + height - 15)
        text(c, col_x, y + height - 23, heading, 8.2, color, True)
        line_y = y + height - 41
        for line in lines:
            text(c, col_x, line_y, line, 7.3, "#334155", False)
            line_y -= 13


def build_pdf():
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=A4)
    width, height = A4
    c.setTitle("Q3考高斯刷题 - 各平台使用指南")
    c.setAuthor("卓越教育")

    c.setFillColor(HexColor("#F4F7FB"))
    c.rect(0, 0, width, height, fill=1, stroke=0)
    c.setFillColor(HexColor("#0F274A"))
    c.rect(0, height - 106, width, 106, fill=1, stroke=0)
    text(c, 30, height - 45, "Q3考高斯刷题", 23, "#FFFFFF", True)
    text(c, 30, height - 72, "各平台一页使用指南 · 公开分享版 v1.0.0", 11, "#BFD5FF", False)
    rounded_box(c, width - 172, height - 75, 142, 38, "#173D72", "#315A91", 12, 0.8)
    text(c, width - 158, height - 53, "479 道题 · 多端同步", 9.5, "#FFFFFF", True)
    text(c, width - 158, height - 68, "公开材料不含账号、密码和 Key", 7.5, "#CFE0FF", False)

    rounded_box(c, 28, height - 156, width - 56, 36, "#EAF2FF", "#D6E5FF", 10, 0.8)
    text(c, 43, height - 142, "快速选择", 8.5, "#1D4ED8", True)
    choices = [
        "Windows: 安装版优先",
        "Mac M1-M5: arm64",
        "Intel Mac: x64",
        "手机: Android APK",
    ]
    positions = [105, 220, 344, 455]
    for x, choice in zip(positions, choices):
        text(c, x, height - 142, choice, 7.2, "#1E3A5F", False)

    rows = [
        (
            "Windows", "普通用户推荐", "windows", "#2563EB",
            [
                ("选择文件", ["Windows安装版_x64.exe", "或Windows免安装版_x64.exe"]),
                ("启动步骤", ["安装版按提示完成安装", "免安装版直接双击", "无需安装 Node.js"]),
                ("首次拦截", ["SmartScreen 选择", "‘更多信息’", "再点‘仍要运行’"]),
            ],
        ),
        (
            "macOS", "无需 Node / Homebrew", "mac", "#7C3AED",
            [
                ("选择文件", ["M1-M5: arm64.zip", "Intel: x64.zip"]),
                ("启动步骤", ["完整解压文件夹", "双击‘启动Q3刷题.command’", "浏览器会自动打开"]),
                ("首次拦截", ["右键启动文件 -> 打开", "或‘隐私与安全性’", "选择‘仍要打开’"]),
            ],
        ),
        (
            "Android", "手机 / 平板", "android", "#059669",
            [
                ("选择文件", ["Android版.apk", "最低 Android 7.0"]),
                ("安装步骤", ["传到手机后点击 APK", "临时允许‘安装未知应用’", "完成后关闭该权限"]),
                ("使用提醒", ["属于侧载测试版本", "不是应用商店正式包", "更新时可直接覆盖安装"]),
            ],
        ),
        (
            "网页包", "Windows 一键启动", "web", "#EA580C",
            [
                ("本机启动", ["完整解压网页包", "双击‘启动网页服务.cmd’", "自动打开浏览器和快捷方式"]),
                ("没有 Node.js", ["首次自动下载官方运行时", "自动核对 SHA-256", "停止用‘停止网页服务.cmd’"]),
                ("Mac / 服务器", ["普通 Mac 请用 macOS 包", "服务器运行 node server.cjs", "公网必须配置 HTTPS"]),
            ],
        ),
    ]
    y_positions = [height - 271, height - 383, height - 495, height - 607]
    for row, y in zip(rows, y_positions):
        title, badge, kind, color, columns = row
        draw_platform_row(c, y, title, badge, kind, color, columns)

    bottom_y = 32
    bottom_h = 195
    rounded_box(c, 28, bottom_y, width - 56, bottom_h, "#FFFFFF", "#D8E2F1", 14, 0.8)
    text(c, 44, bottom_y + bottom_h - 26, "首次使用与安全须知", 13, "#0F274A", True)
    rounded_box(c, 404, bottom_y + bottom_h - 38, 134, 22, "#FFF2F2", "#FFD7D7", 11, 0.7)
    text(c, 417, bottom_y + bottom_h - 31, "公开可分享 · 不含私人密钥", 7.5, "#C62828", True)

    notes_left = [
        ("1", "首次登录", "使用管理员提供的账号；首次登录后立即修改自己的登录密码。"),
        ("2", "云端与 AI", "公开源码和公开材料不含坚果云账号、密码或 AI API Key。"),
        ("3", "同步异常", "出现 HTTP 502 时本地记录仍会保存；网络恢复后点‘立即同步’重试。"),
    ]
    notes_right = [
        ("4", "文件完整性", "传输后按 SHA256校验码.txt 核对文件，避免下载损坏。"),
        ("5", "密钥边界", "私人配置只保存在本机 .env.local；不得提交 Git 或出现在截图、日志中。"),
        ("6", "微信小程序", "本版暂未包含；正式接入需企业主体、HTTPS 域名和安全后端。"),
    ]
    for column_x, items in ((44, notes_left), (306, notes_right)):
        item_y = bottom_y + bottom_h - 58
        for number, heading, body in items:
            c.setFillColor(HexColor("#EAF2FF"))
            c.circle(column_x + 8, item_y + 2, 8, fill=1, stroke=0)
            text(c, column_x + 5.5, item_y - 1, number, 7, "#1D4ED8", True)
            text(c, column_x + 23, item_y + 4, heading, 8.5, "#0F274A", True)
            text(c, column_x + 23, item_y - 9, body, 6.7, "#475569", False)
            item_y -= 47

    c.setStrokeColor(HexColor("#E2E8F0"))
    c.line(44, bottom_y + 26, width - 44, bottom_y + 26)
    text(c, 44, bottom_y + 11, "建议：先安装一台管理员设备完成登录与同步，再分发给其他内部成员。", 7, "#64748B", False)
    text(c, width - 122, bottom_y + 11, "2026 Q3 公开分享版", 7, "#94A3B8", False)

    c.showPage()
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    build_pdf()
