# -*- coding: utf-8 -*-
"""Recover answer crops whose printed number marker touches complex artwork."""

import json
from pathlib import Path

import pymupdf as fitz
from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parent.parent
BANK_DIR = PROJECT_ROOT / 'public' / 'bank'
SOURCE_ROOT = Path(r'E:\desktop\高斯第三季度刷题(1)\高斯第三季度刷题')


def render_page(document, page_index):
    pixmap = document[page_index].get_pixmap(dpi=150)
    return Image.frombytes('RGB', [pixmap.width, pixmap.height], pixmap.samples)


def stitch_vertical(segments, centered=False):
    gap = 18
    canvas = Image.new(
        'RGB',
        (max(segment.width for segment in segments), sum(s.height for s in segments) + gap * (len(segments) - 1)),
        'white',
    )
    y = 0
    for segment in segments:
        x = (canvas.width - segment.width) // 2 if centered else 0
        canvas.paste(segment, (x, y))
        y += segment.height + gap
    return canvas


def crop_if_overlong(path, top, bottom):
    """Trim a known over-captured answer while keeping repeated runs safe."""
    with Image.open(path) as image:
        if image.height <= bottom:
            return False
        cropped = image.crop((0, top, image.width, bottom)).copy()
    cropped.save(path)
    return True


def save_crop(page, box, path):
    page.crop(box).save(path)


def save_stitched(segments, path, centered=False):
    stitch_vertical(segments, centered=centered).save(path)


def main():
    grade4_root = SOURCE_ROOT / '高斯四年级'
    question_pdf = next(grade4_root.glob('*第20讲.pdf'))
    answer_pdf = next(grade4_root.glob('*第20讲*答案*'))
    question_document = fitz.open(question_pdf)
    document = fitz.open(answer_pdf)
    page1 = render_page(document, 1)
    page3 = render_page(document, 3)
    page4 = render_page(document, 4)
    page5 = render_page(document, 5)
    page6 = render_page(document, 6)
    page7 = render_page(document, 7)
    page8 = render_page(document, 8)
    page9 = render_page(document, 9)
    page10 = render_page(document, 10)
    crops_dir = BANK_DIR / 'crops'

    # 兴趣篇第4题：旧图只截到了上一题末尾。第5题则从左栏跨到右栏。
    save_crop(page1, (30, 470, 615, 1135), crops_dir / '四年级_ch20_兴趣篇_4_ans.png')
    save_stitched([
        page1.crop((30, 1135, 615, 1635)),
        page1.crop((625, 105, 1210, 385)),
    ], crops_dir / '四年级_ch20_兴趣篇_5_ans.png')
    save_crop(
        page1,
        (625, 385, 1210, 1270),
        crops_dir / '四年级_ch20_兴趣篇_6_ans.png',
    )

    # 拓展篇第2、4、7、8、9、12题：题号靠近复杂图形时，通用裁切会命中图中文字。
    save_stitched([
        page3.crop((30, 675, 615, 1635)),
        page3.crop((625, 105, 1210, 525)),
    ], crops_dir / '四年级_ch20_拓展篇_2_ans.png')
    save_crop(page4, (30, 280, 615, 935), crops_dir / '四年级_ch20_拓展篇_4_ans.png')
    save_crop(page4, (625, 280, 1210, 975), crops_dir / '四年级_ch20_拓展篇_6_ans.png')
    save_stitched([
        page4.crop((625, 975, 1210, 1635)),
        page5.crop((30, 105, 615, 640)),
    ], crops_dir / '四年级_ch20_拓展篇_7_ans.png')
    save_crop(page5, (30, 625, 615, 1635), crops_dir / '四年级_ch20_拓展篇_8_ans.png')
    save_crop(page5, (625, 105, 1210, 590), crops_dir / '四年级_ch20_拓展篇_9_ans.png')
    save_stitched([
        page6.crop((625, 300, 1210, 1635)),
        page7.crop((30, 105, 615, 235)),
    ], crops_dir / '四年级_ch20_拓展篇_12_ans.png')
    save_stitched([
        page6.crop((30, 1080, 615, 1635)),
        page6.crop((625, 105, 1210, 305)),
    ], crops_dir / '四年级_ch20_拓展篇_11_ans.png')
    save_stitched([
        page7.crop((625, 1170, 1210, 1635)),
        page8.crop((30, 105, 615, 410)),
    ], crops_dir / '四年级_ch20_超越篇_1_ans.png')
    save_crop(page8, (625, 120, 1210, 1270), crops_dir / '四年级_ch20_超越篇_3_ans.png')

    # 拓展篇第3、5、13题曾被图中的数字误识别为题号，答案实际跨栏。
    save_stitched([
        page3.crop((625, 520, 1210, 1635)),
        page4.crop((30, 105, 615, 280)),
    ], crops_dir / '四年级_ch20_拓展篇_3_ans.png')
    save_stitched([
        page4.crop((30, 910, 615, 1635)),
        page4.crop((625, 105, 1210, 280)),
    ], crops_dir / '四年级_ch20_拓展篇_5_ans.png')
    save_stitched([
        page7.crop((30, 455, 615, 1635)),
        page7.crop((625, 105, 1210, 320)),
    ], crops_dir / '四年级_ch20_拓展篇_13_ans.png')

    # 拓展篇第7/8/9/12题的图形在题号之前或跨页，必须显式拼接题干与对应图形。
    question_page3 = render_page(question_document, 3)
    question_page4 = render_page(question_document, 4)
    save_stitched([
        question_page3.crop((120, 1390, 1110, 1535)),
        question_page3.crop((550, 1080, 1115, 1385)),
    ], crops_dir / '四年级_ch20_拓展篇_7_q.png', centered=True)
    save_stitched([
        question_page3.crop((150, 1550, 1110, 1685)),
        question_page4.crop((265, 165, 555, 475)),
    ], crops_dir / '四年级_ch20_拓展篇_8_q.png', centered=True)
    save_stitched([
        question_page4.crop((170, 455, 1080, 565)),
        question_page4.crop((690, 150, 970, 455)),
    ], crops_dir / '四年级_ch20_拓展篇_9_q.png', centered=True)
    save_stitched([
        question_page4.crop((170, 1230, 1080, 1345)),
        question_page4.crop((285, 1330, 625, 1650)),
    ], crops_dir / '四年级_ch20_拓展篇_12_q.png', centered=True)
    save_stitched([
        question_page4.crop((120, 1070, 1080, 1165)),
        question_page4.crop((700, 800, 1015, 1045)),
    ], crops_dir / '四年级_ch20_拓展篇_11_q.png', centered=True)
    question_page5 = render_page(question_document, 5)
    save_crop(
        question_page5,
        (125, 115, 1120, 350),
        crops_dir / '四年级_ch20_拓展篇_13_q.png',
    )

    # 超越篇第6题：原图20-32印在题干上方，通用“从题号向下裁切”会漏图。
    question_page7 = render_page(question_document, 6)
    question6_prompt = stitch_vertical([
        question_page7.crop((145, 705, 1130, 860)),
        question_page7.crop((840, 265, 1130, 590)),
    ], centered=True)
    question6_prompt.save(crops_dir / '四年级_ch20_超越篇_6_q.png')

    # 超越篇第6题：答案位于第9页右栏，直到页尾。
    question6 = page9.crop((625, 280, 1210, 1635))
    question6.save(crops_dir / '四年级_ch20_超越篇_6_ans.png')

    # 超越篇第7题：解析从第10页左栏延续到右栏、下一讲标题之前。
    question7 = stitch_vertical([
        page10.crop((30, 130, 615, 1635)),
        page10.crop((625, 105, 1210, 1425)),
    ])
    question7.save(crops_dir / '四年级_ch20_超越篇_7_ans.png')

    # 两个通用裁切曾一直延伸到后续题目，造成单题答案包含数页内容。
    # 坐标基于当前恢复图；高度保护使脚本可重复运行而不会二次裁切。
    crop_if_overlong(crops_dir / '四年级_ch20_兴趣篇_10_ans.png', 0, 760)
    crop_if_overlong(crops_dir / '四年级_ch20_超越篇_4_ans.png', 620, 1533)

    # 第2讲同样有图中数字被误识别为题号的情况。
    chapter2_question_pdf = next(grade4_root.glob('*第2讲.pdf'))
    chapter2_answer_pdf = next(grade4_root.glob('*第2讲*答案*'))
    chapter2_question_document = fitz.open(chapter2_question_pdf)
    chapter2_answer_document = fitz.open(chapter2_answer_pdf)
    chapter2_answer_page0 = render_page(chapter2_answer_document, 0)
    chapter2_answer_page1 = render_page(chapter2_answer_document, 1)
    chapter2_answer_page2 = render_page(chapter2_answer_document, 2)
    chapter2_answer_page5 = render_page(chapter2_answer_document, 5)
    chapter2_question_page4 = render_page(chapter2_question_document, 4)
    save_crop(
        chapter2_answer_page0,
        (625, 1110, 1210, 1635),
        crops_dir / '四年级_ch2_兴趣篇_2_ans.png',
    )
    save_stitched([
        chapter2_answer_page1.crop((30, 1350, 615, 1635)),
        chapter2_answer_page1.crop((625, 105, 1210, 1455)),
    ], crops_dir / '四年级_ch2_兴趣篇_5_ans.png')
    # 兴趣篇第4题旧图完全落到了后面的第12、13题。它实际位于
    # 答案第2页左栏、第3题之后和第5题之前。
    save_crop(
        chapter2_answer_page1,
        (30, 770, 615, 1365),
        crops_dir / '四年级_ch2_兴趣篇_4_ans.png',
    )
    save_stitched([
        chapter2_answer_page1.crop((625, 1470, 1210, 1635)),
        chapter2_answer_page2.crop((30, 105, 615, 875)),
    ], crops_dir / '四年级_ch2_兴趣篇_6_ans.png')
    save_crop(
        chapter2_question_page4,
        (125, 680, 675, 1105),
        crops_dir / '四年级_ch2_拓展篇_9_q.png',
    )
    save_stitched([
        chapter2_question_page4.crop((125, 555, 1120, 660)),
        chapter2_question_page4.crop((660, 245, 1055, 535)),
    ], crops_dir / '四年级_ch2_拓展篇_8_q.png', centered=True)
    save_stitched([
        chapter2_answer_page5.crop((30, 785, 615, 1635)),
        chapter2_answer_page5.crop((625, 105, 1210, 635)),
    ], crops_dir / '四年级_ch2_拓展篇_9_ans.png')

    # 三年级两道超越题原切片落到了上一题或下一讲。
    grade3_root = SOURCE_ROOT / '高斯三年级'
    chapter13_answer_document = fitz.open(next(grade3_root.glob('*第13讲*答案*')))
    chapter13_answer_page2 = render_page(chapter13_answer_document, 2)
    save_crop(
        chapter13_answer_page2,
        (625, 790, 1210, 1135),
        crops_dir / '三年级_ch13_超越篇_1_ans.png',
    )
    chapter20_answer_document = fitz.open(next(grade3_root.glob('*第20讲*答案*')))
    chapter20_answer_page4 = render_page(chapter20_answer_document, 4)
    chapter20_answer_page5 = render_page(chapter20_answer_document, 5)
    save_stitched([
        chapter20_answer_page4.crop((30, 1030, 615, 1635)),
        chapter20_answer_page5.crop((30, 105, 615, 300)),
    ], crops_dir / '三年级_ch20_超越篇_4_ans.png')

    # 五年级第15、19讲：短题干换行和分数线会干扰通用题号定位。
    grade5_root = SOURCE_ROOT / '高斯五年级'
    chapter15_question_document = fitz.open(next(grade5_root.glob('*第15讲.pdf')))
    chapter15_question_page0 = render_page(chapter15_question_document, 0)
    save_crop(
        chapter15_question_page0,
        (125, 985, 1120, 1110),
        crops_dir / '五年级_ch15_兴趣篇_1_q.png',
    )
    save_crop(
        chapter15_question_page0,
        (125, 1190, 1120, 1320),
        crops_dir / '五年级_ch15_兴趣篇_2_q.png',
    )
    save_crop(
        chapter15_question_page0,
        (125, 1390, 1120, 1530),
        crops_dir / '五年级_ch15_兴趣篇_3_q.png',
    )
    chapter15_answer_document = fitz.open(next(grade5_root.glob('*第15讲*答案*')))
    chapter15_answer_page7 = render_page(chapter15_answer_document, 7)
    save_stitched([
        chapter15_answer_page7.crop((30, 1550, 615, 1635)),
        chapter15_answer_page7.crop((625, 105, 1210, 890)),
    ], crops_dir / '五年级_ch15_超越篇_7_ans.png')

    chapter19_answer_document = fitz.open(next(grade5_root.glob('*第19讲*答案*')))
    chapter19_answer_page1 = render_page(chapter19_answer_document, 1)
    save_crop(
        chapter19_answer_page1,
        (30, 995, 615, 1225),
        crops_dir / '五年级_ch19_拓展篇_2_ans.png',
    )
    save_stitched([
        chapter19_answer_page1.crop((30, 1215, 615, 1635)),
        chapter19_answer_page1.crop((625, 105, 1210, 370)),
    ], crops_dir / '五年级_ch19_拓展篇_3_ans.png')

    # 六年级第17讲超越4，以及第23讲概率题的旧图命中了相邻题。
    grade6_root = SOURCE_ROOT / '高斯六年级'
    chapter17_answer_document = fitz.open(next(grade6_root.glob('*第17讲*答案*')))
    chapter17_answer_page4 = render_page(chapter17_answer_document, 4)
    save_stitched([
        chapter17_answer_page4.crop((30, 1540, 615, 1635)),
        chapter17_answer_page4.crop((625, 105, 1210, 1140)),
    ], crops_dir / '六年级_ch17_超越篇_4_ans.png')

    chapter23_answer_document = fitz.open(next(grade6_root.glob('*第23讲*答案*')))
    chapter23_answer_page2 = render_page(chapter23_answer_document, 2)
    chapter23_answer_page4 = render_page(chapter23_answer_document, 4)
    save_crop(
        chapter23_answer_page2,
        (30, 930, 615, 1050),
        crops_dir / '六年级_ch23_拓展篇_9_ans.png',
    )
    save_crop(
        chapter23_answer_page4,
        (30, 660, 615, 1140),
        crops_dir / '六年级_ch23_超越篇_6_ans.png',
    )
    save_stitched([
        chapter23_answer_page4.crop((30, 1130, 615, 1635)),
        chapter23_answer_page4.crop((625, 105, 1210, 430)),
    ], crops_dir / '六年级_ch23_超越篇_7_ans.png')
    save_crop(
        chapter23_answer_page4,
        (625, 300, 1210, 1635),
        crops_dir / '六年级_ch23_超越篇_8_ans.png',
    )

    questions_path = BANK_DIR / 'questions.json'
    questions = json.loads(questions_path.read_text(encoding='utf-8'))
    updates = {
        '三年级_13_超越篇_1': {
            'content': (
                '1. 计算：（1）5÷(7÷11)÷(11÷15)÷(15÷21)；'
                '（2）(26÷25)×(27÷17)×(25÷9)×(17÷39)。'
            ),
            'answer': '（1）15；（2）2',
            'explanation': (
                '（1）改写后为5÷7×11÷11×15÷15×21，中间的11和15分别约去，'
                '得到5×21÷7=15。'
                '（2）改写并约去25和17，得到26×27÷9÷39=26×3÷39=2。'
            ),
        },
        '三年级_20_超越篇_4': {
            'content': (
                '4. 在下面算式中合适的地方填入“+、-、×、÷或（ ）”，使等式成立。'
                '（1）用12个8组成2008；（2）按顺序使用1～9组成2008。'
            ),
            'answer': (
                '（1）[(8+8+8+8-8÷8)×8+(8+8+8)÷8]×8=2008；'
                '（2）1+(2+3×4)×(5+6+7)×8-9=2008'
            ),
            'explanation': (
                '（1）先利用2008÷8=251，把11个8凑成251：31×8+3，其中'
                '31可由8+8+8+8-8÷8得到，3可由(8+8+8)÷8得到，最后再乘8。'
                '（2）先把2+3×4凑成14，把5+6+7凑成18，14×18×8=2016，'
                '再用1和9调整为1+2016-9=2008。'
            ),
        },
        '四年级_2_兴趣篇_1': {
            'answer': '左下4，右中3，右下6',
            'explanation': (
                '先看左边：左下空格=11-2-5=4。\n'
                '再看底边：右下空格=11-4-1=6。\n'
                '最后看右边：右中空格=11-2-6=3。\n'
                '验算：2+5+4=11，4+1+6=11，2+3+6=11，且4、3、6互不相同。'
            ),
            'needs_ai_explanation': True,
        },
        '四年级_2_兴趣篇_2': {
            'answer': '上方独占区域填2，中央填1，左下填6，右下填4',
            'explanation': (
                '上面的圆中，已知5和7，所以另外两个数之和为15-5-7=3，只能填1和2。'
                '再看左边圆，除5外三个位置的和为10，只能由1、3、6组成；'
                '因此中央公共区域填1，左下填6。剩下的4填在右下，三个圆的和都为15。'
            ),
        },
        '四年级_2_兴趣篇_5': {
            'answer': '答案不唯一，例如从上到下依次填3、4；1、6；2、5；7',
            'explanation': (
                '所有数的和为28，上下两个大圆的和相加时，中间公共部分被计算2次。'
                '按示例填入后，三个大圆的和分别为3+4+1+6=14、'
                '1+6+2+5=14、2+5+7=14，满足要求。'
            ),
        },
        '四年级_2_兴趣篇_6': {
            'content': (
                '6. 在图2-6所示的3×3方格表内填入1～3各3次，使每行、每列以及'
                '两条对角线上的3个数之和都相等。'
            ),
            'answer': '答案不唯一，例如1、3、2；3、2、1；2、1、3',
            'explanation': (
                '表中9个数的总和为(1+2+3)×3=18，所以每行、每列和每条对角线的和都应为6。'
                '满足和为6的三数组合只有1、2、3或2、2、2。先让每行、每列各含一个1、2、3，'
                '再调整排列使一条对角线为2、2、2，另一条为1、2、3，即可得到示例填法。'
            ),
        },
        '四年级_2_拓展篇_9': {
            'content': (
                '9. 在图2-19中的7个圆内填入7个连续自然数，使每两个相邻圆内所填数之和'
                '都等于它们连线上的已知数。标有“★”的圆内应填多少？'
            ),
            'answer': '5',
            'explanation': (
                '设★处为x，沿图从★右侧开始依次利用边上的和12、9、6、10、7、4，'
                '各圆依次为12-x、x-3、9-x、x+1、6-x、x-2。'
                '最后一条边的和是8，所以(x-2)+x=8，解得x=5。'
                '其余位置得到7、2、4、6、1、3，恰为连续自然数1～7。'
            ),
        },
        '四年级_2_拓展篇_8': {
            'content': (
                '8. 把1～8分别填入图2-18的8个圆内，使任意两个由线段直接相连的圆内数字之差都不等于1。'
            ),
            'answer': '答案不唯一，例如上排3、5；中排7、1、8、2；下排4、6',
            'explanation': (
                '连接线最多的两个中心位置应放与多数数字都不相邻的数，可取1和8。'
                '再利用图形对称性安排其余数字。示例上排3、5；中排7、1、8、2；'
                '下排4、6，逐条检查可知每一条连线两端的差都不为1。'
            ),
        },
        '四年级_20_兴趣篇_4': {
            'answer': '19、12、14；10、15、20；16、18、11',
            'explanation': (
                '幻和为45。由共享行、列或对角线的差依次确定空格，完整填法为：'
                '第一行19、12、14；第二行10、15、20；第三行16、18、11。'
                '各行、各列和两条对角线的和均为45。'
            ),
        },
        '四年级_20_兴趣篇_5': {
            'answer': '3、16、5、10；6、9、4、15；12、7、14、1；13、2、11、8',
            'explanation': (
                '1～16的总和为136，所以四阶幻方的幻和为136÷4=34。'
                '根据每行、每列和两条对角线均为34逐格补齐，得到官方填法：'
                '3、16、5、10；6、9、4、15；12、7、14、1；13、2、11、8。'
            ),
        },
        '四年级_20_兴趣篇_6': {
            'content': (
                '6. 请将图20-7所示的5×5方格表补充完整，使每行、每列和每条对角线中'
                '1、2、3、4、5恰好各出现一次。△、▽和○所在方格分别应填什么数？'
            ),
            'answer': '△填5，▽填5，○填4',
            'explanation': (
                '先利用每行、每列都恰含1～5：A所在行已有5、2，所在列已有1、3，所以A只能填4。'
                '第三列已有1、4、3，B只可能填2或5；又因B与5同处一条对角线，B只能填2，故△填5。'
                '再逐行逐列补齐可得D=3、C=1、E=4、F=5，因此▽填5、○填4。'
            ),
        },
        '四年级_20_拓展篇_2': {
            'answer': '24、171、105；181、100、19；95、29、176',
            'explanation': (
                '由已知的100、19、95先确定幻和为300，再利用每行、每列和两条对角线'
                '都等于300逐格求出。完整填法为：24、171、105；181、100、19；'
                '95、29、176。'
            ),
        },
        '四年级_20_拓展篇_3': {
            'answer': '（1）11.12；（2）27、17、31；29、25、21；19、33、23',
            'explanation': (
                '（1）三阶幻方的中心数等于幻和的三分之一，所以中心数为19.95÷3=6.65。'
                '第二列上格为19.95-6.65-8.80=4.50，因此★处为19.95-4.33-4.50=11.12。'
                '（2）利用任意一行与一列去掉公共格后余数之和相等，依次补出31、33、21；'
                '再由中心数是幻和的三分之一求得中心25，最终得到所列幻方。'
            ),
        },
        '四年级_20_拓展篇_4': {
            'content': (
                '4. 图20-16大正方形四角的4个数之和为264。把图倒过来看，四角之和仍为264。'
                '请在中间小正方形的4个圆内填数，使每条对角线以及小正方形四角的数，'
                '正看、倒看时和都为264。'
            ),
            'answer': '左上81，右上69，左下18，右下96',
            'explanation': (
                '图中使用1、6、8、9组成两位数。十位和个位上的数字都各出现一次，'
                '四个数之和为240+(1+6+8+9)=264。结合两条对角线的已知数，'
                '可填左上81、右上69、左下18、右下96；倒看后仍满足同样的和。'
            ),
        },
        '四年级_20_拓展篇_5': {
            'answer': '公共和为18；一种填法见官方解析图',
            'explanation': (
                '先比较左上与右上的两条直线，去掉公共圆后可知左右两端相差2，'
                '因此只能在给定数中配成1和3、3和5、5和7、7和9、9和11。'
                '再比较其余直线并排除重复数字，可得到图示填法；每条直线的和均为18。'
            ),
        },
        '四年级_20_拓展篇_6': {
            'content': '6. 将1～9分别填入图20-18的方框内，使所有不等号都成立。满足要求的填法共有多少种？',
            'answer': '2种',
            'explanation': (
                '按不等号关系，A必须最大、H必须最小，所以A=9、H=1。继续从两端向中间比较可得'
                'B=8、G=2、C=7、F=3。剩下4、5、6时，E只能填4，D和M分别填5、6，'
                '而D、M可以互换，因此共有2种填法。'
            ),
        },
        '四年级_20_拓展篇_7': {
            'content': (
                '7. 将1～10分别填入图20-19的圆内（9已填好），使除第一行外的每个数'
                '都等于与它相连的上方两个数之差。'
            ),
            'answer': '答案不唯一，例如各行依次为8、10、1、6；2、9、5；7、4；3',
            'explanation': (
                '示例中第二行为|8-10|=2、|10-1|=9、|1-6|=5；'
                '第三行为|2-9|=7、|9-5|=4；最下面为|7-4|=3。'
                '1～10恰好各使用一次，且满足所有相邻差关系。'
            ),
        },
        '四年级_20_拓展篇_8': {
            'content': (
                '8. 在图20-20的7个圆内各填一个数（13和17已填好），使每条直线上的3个数中，'
                '居中的数都是两端两个数的平均数。'
            ),
            'answer': '从上到下可填17；15、16、19；13、15、17',
            'explanation': (
                '底边中点为(13+17)÷2=15。再利用每条直线上的三个数成等差数列，'
                '依次可得中心16、左上15、右上19、顶端17。'
            ),
        },
        '四年级_20_拓展篇_9': {
            'content': (
                '9. 在图20-21的六块区域内分别填入1～6，使对每个圆来说，'
                '与它相邻区域内的数字之和都相等。'
            ),
            'answer': '公共和为14',
            'explanation': (
                '设每个圆相邻区域的和为S。把三个圆的相邻区域之和相加，每个区域恰被算2次，'
                '所以3S=2×(1+2+3+4+5+6)=42，S=14。'
                '例如把3、5、6填在三个圆共同围成的三角形区域，其余区域即可补齐。'
            ),
        },
        '四年级_20_拓展篇_12': {
            'content': (
                '12. 将1～9分别填入图20-24的9个圆内，使4个大圆周上的4个数之和都等于16。'
            ),
            'answer': '答案不唯一，例如从上到下填9；2、4；6、1、8；7、3；5',
            'explanation': (
                '四个圆周的和共为64。中心数被计算4次，两圆交点被计算2次，外侧四点各1次。'
                '结合1～9总和45可逐步确定。示例9；2、4；6、1、8；7、3；5'
                '使四个大圆周上的和都为16。'
            ),
        },
        '四年级_20_拓展篇_13': {
            'content': (
                '13. 图20-25中共有10个方格，把2～11分别填入其中，使3个2×2正方形内'
                '4个数的和都相等。这个公共和最小是多少？请给出一种填法。'
            ),
            'answer': '最小公共和为24',
            'explanation': (
                '三个2×2正方形的公共格各被重复计算一次。2～11的总和为65，若公共和为S，'
                '则3S=65+两个公共格之和。两个公共格最小可取2和3，但70不是3的倍数；'
                '下一个可行总量为72，因此S最小为24，此时两个公共格之和为7，可取3和4或2和5。'
                '按官方图补齐其余数字即可使三个2×2正方形的和都为24。'
            ),
        },
        '四年级_20_拓展篇_11': {
            'content': (
                '11. 将1～7分别填入图20-23的7个小圆内，使每个圆周上的3个数之和'
                '与每条直线上的3个数之和都相等。'
            ),
            'answer': '公共和为12；一种填法为外侧1、6、5，内侧7、2、3，中心4',
            'explanation': (
                '把2个圆周和3条直线的和相加，中心数计算3次，其余数计算2次。'
                '设公共和为S、中心数为A，则5S=3A+2(28-A)=A+56。'
                '在1～7中只有A=4时右边能被5整除，因此S=12。'
                '再让每条线另外两个数之和为8即可得到官方填法。'
            ),
        },
        '四年级_20_超越篇_1': {
            'answer': '20、17、11；7、16、25；21、15、12',
            'explanation': (
                '设每行、每列和两条对角线的公共和为S。比较含有共同部分的行、列和对角线，'
                '先得右上角=(7+15)÷2=11，再得上中=7+21-11=17、右中=21+15-11=25。'
                '这6个已知数的和等于2S，所以S=(7+21+15+11+17+25)÷2=48。'
                '逐行补齐其余三格为20、16、12，得到完整幻方。'
            ),
        },
        '四年级_20_超越篇_3': {
            'answer': '9、2、7；4、5、6；3、8、1',
            'explanation': (
                '把大正方形计3次、斜正方形计2次、四个小正方形各计1次，'
                '九个圆中的每个数都恰被计算4次，因此公共和为45×4÷9=20。'
                '官方填法为9、2、7；4、5、6；3、8、1，各正方形四角之和均为20。'
            ),
        },
        '五年级_15_兴趣篇_1': {
            'content': (
                '1. 已知一个扇形的圆心角为120°，半径为2，求这个扇形的面积和周长。'
                '（π取3.14）'
            ),
            'answer': '面积4又14/75，周长8又14/75',
            'explanation': (
                '面积=120°÷360°×3.14×2²=314/75=4又14/75。'
                '周长由两条半径和弧长组成：2×2+120°÷360°×2×3.14×2'
                '=614/75=8又14/75。'
            ),
        },
        '五年级_15_兴趣篇_2': {
            'content': '2. 已知一个圆的面积是28.26平方厘米，求这个圆的半径和周长。（π取3.14）',
            'answer': '半径3厘米，周长18.84厘米',
            'explanation': (
                '由πr²=28.26，得r²=28.26÷3.14=9，所以r=3厘米。'
                '周长为2πr=2×3.14×3=18.84厘米。'
            ),
        },
        '五年级_15_兴趣篇_3': {
            'content': '3. 已知一个圆的周长是25.12厘米，求这个圆的半径和面积。（π取3.14）',
            'answer': '半径4厘米，面积50.24平方厘米',
            'explanation': (
                '半径r=25.12÷(2×3.14)=4厘米。面积为3.14×4²=50.24平方厘米。'
            ),
        },
        '五年级_19_拓展篇_2': {
            'content': (
                '2. 如图19-12，已知AE=1/3 AC，CD=1/4 BC，BF=1/5 AB，'
                '求三角形DEF与三角形ABC的面积之比。'
            ),
            'answer': '5/12',
            'explanation': (
                '三角形AEF、BDF、CDE占三角形ABC的面积比分别为'
                '(1/3)×(4/5)=4/15、(1/5)×(3/4)=3/20、'
                '(1/4)×(2/3)=1/6。故DEF所占比例为'
                '1-4/15-3/20-1/6=5/12。'
            ),
        },
        '五年级_19_拓展篇_3': {
            'content': (
                '3. 如图19-13，深20厘米的长方形水箱装满水放在平台上。'
                '（1）倾斜水箱使水流出一部分，如图19-14，求AB长度；'
                '（2）继续倾斜到AB=8厘米后再把水箱放平，求水深。'
            ),
            'answer': '（1）12厘米；（2）14厘米',
            'explanation': (
                '（1）由图中的面积关系，空出部分占长方形的1/5，得到AC=8厘米，'
                '所以AB=20-8=12厘米。'
                '（2）此时AC=20-8=12厘米，空出部分占长方形的3/10。'
                '放平后空白高度为20×3/10=6厘米，所以水深为20-6=14厘米。'
            ),
        },
        '五年级_21_拓展篇_9': {
            'content': (
                '9. 有两个相邻的自然数，它们的各位数字之和均为7的倍数，'
                '这两个自然数中较小的数最小是多少？'
            ),
            'answer': '69999',
            'explanation': (
                '一个数加1时，若末尾有k个9，数字和改变1-9k。要使加1前后的数字和'
                '都为7的倍数，需1-9k为7的倍数，最小可取k=4。'
                '较小数形如a9999，其数字和a+36也要为7的倍数，最小a=6。'
                '所以较小数为69999，下一数70000的数字和为7。'
            ),
        },
        '五年级_24_兴趣篇_6': {
            'content': (
                '6. 从1至11这11个自然数中至少选出多少个不同的数，'
                '才能保证其中一定有两个数的和为12？'
            ),
            'answer': '7个',
            'explanation': (
                '把数分成(1,11)、(2,10)、(3,9)、(4,8)、(5,7)五对以及单独的6。'
                '为避免选到和为12的一对，每对至多取1个，再加上6，最多只能取6个。'
                '因此选7个时一定出现一对和为12。'
            ),
        },
        '五年级_24_拓展篇_8': {
            'content': (
                '8. 从1至50这50个自然数中至少选出多少个数，'
                '才能保证其中必有两个数互质？'
            ),
            'answer': '26个',
            'explanation': (
                '把1～50分成25对相邻数：(1,2)、(3,4)、…、(49,50)。'
                '每对相邻数都互质，选26个数时由抽屉原理必有一对被同时选中。'
                '而只选25个偶数时任意两个都不互质，所以26也是最小值。'
            ),
        },
        '五年级_24_拓展篇_13': {
            'content': (
                '13. 有9个人，每人至少与另外5个人互相认识。证明：'
                '可以从中找到3个人，他们彼此相互认识。'
            ),
            'answer': '一定可以找到',
            'explanation': (
                '任取一人A，他至少认识5人。若这5人中有两人互相认识，'
                '他们与A就组成彼此认识的三人组。若这5人彼此都不认识，'
                '其中任意一人除A外至多只能认识剩下的3人，总认识人数至多4，'
                '与每人至少认识5人矛盾。因此所求三人组一定存在。'
            ),
        },
        '三年级_13_兴趣篇_2': {
            'answer_crop_reviewed': True,
        },
        '三年级_18_兴趣篇_4': {
            'answer_crop_reviewed': True,
        },
        '六年级_23_拓展篇_1': {
            'answer_crop_reviewed': True,
        },
        '四年级_20_超越篇_6': {
            'answer': '最大14，最小13',
            'explanation': '利用所有数字总和45与三个阴影三角形的重复计数关系，完整推导见官方恢复切片。',
            'ans_slice_url': '/bank/crops/四年级_ch20_超越篇_6_ans.png',
            'needs_ai_explanation': False,
        },
        '四年级_20_超越篇_7': {
            'answer': '答案不唯一，填法示例见官方解析图',
            'explanation': '先把43拆成4个不超过13且互不相同的自然数，再按连线和的约束逐层确定其余数字。',
            'ans_slice_url': '/bank/crops/四年级_ch20_超越篇_7_ans.png',
            'needs_ai_explanation': False,
        },
        '四年级_20_兴趣篇_10': {
            'content': (
                '10.将0～9这10个数分别填入图20-11的10块区域中（阴影区域除外），'
                '使得每个圆内的3个数之和都相等。请问：这个和最小是多少？最大是多少？'
            ),
            'answer': '最小是11，最大是16',
            'explanation': (
                '把5个圆的和相加，A、C、E、G、M各计算1次，B、D、F、H、N各计算2次。\n'
                '要使公共和最小，把0、1、2、3、4填入被重复计算的5块区域，'
                '5个圆的总和为(5+6+7+8+9)+(0+1+2+3+4)×2=55，所以每个圆的和为11。\n'
                '要使公共和最大，把5、6、7、8、9填入被重复计算的5块区域，'
                '5个圆的总和为(0+1+2+3+4)+(5+6+7+8+9)×2=80，所以每个圆的和为16。'
            ),
        },
        '四年级_20_超越篇_4': {
            'answer': '答案不唯一，例如按圆环依次填14、15、13、10、6、1、7',
            'explanation': (
                '先在空白圆圈中依次标记A、B、C、D、E、F、G。'
                '从A=20出发，按相邻差1、2、3、4、5、6依次得到'
                'B=21、C=19、D=16、E=12、F=7、G=13，并满足|G-A|=7。\n'
                '这组数的最小值是7；所有数同时减去6不会改变相邻两数之差，'
                '于是得到最小值为1的一组答案：14、15、13、10、6、1、7。'
            ),
        },
        '三年级_13_超越篇_7': {
            'answer': '4',
            'explanation': (
                '把120分解为4张牌的乘积，可取10×4×3×1、10×3×2×2或5×4×3×2。'
                '若把80写成10×2×4×1，它与上述每种取法至少有2张相同，不合题意。'
                '把80写成5×2×4×2时，与120=10×4×3×1恰好只有点数4这一张相同，'
                '所以相同扑克牌的点数是4。'
            ),
        },
        '四年级_2_拓展篇_3': {
            'answer': '答案不唯一；可先配成(1,12)、(2,11)、(3,10)、(4,9)、(5,8)、(6,7)',
            'explanation': (
                '把1～12两两配对，使每对的和都为13：1+12=2+11=3+10='
                '4+9=5+8=6+7=13。再按图形的公共顶点关系把这6对数分配到3个小三角形的边上，'
                '让每个小三角形取得相同数量的“和为13”的数对，三条边上的6个数之和就相等。'
            ),
        },
        '四年级_20_兴趣篇_1': {
            'answer': '公共和为15；一种完整填法见答案图图3',
            'explanation': (
                '1～9的总和为45，先尝试让三个圆周和三条线段的公共和均为15。'
                '把15拆成互不重复的三数和，优先安排出现次数较少的1、3、7、9，'
                '再利用每条线都等于15逐格补齐。答案图图3给出一种完整填法，逐条相加均为15。'
            ),
        },
        '五年级_21_兴趣篇_7': {
            'answer': '2592',
            'explanation': (
                '设这个四位数为2M9N。按题意它等于2^M×9^N。因为结果只有四位，N只需检查0～3。'
                '当N=2时，9²=81；取M=5，有2⁵×81=32×81=2592，正好写成2M9N。'
                '其余N取值不能同时满足四位数各位上的条件，所以所求数为2592。'
            ),
        },
        '六年级_23_兴趣篇_2': {
            'content': (
                '2. 在一只口袋里装着2个红球、3个黄球和4个黑球。从口袋中任取一个球，请问：'
                '（1）这个球是红球的概率是多少？（2）这个球是黄球或者黑球的概率是多少？'
                '（3）这个球是绿球的概率是多少？不是绿球的概率又是多少？'
            ),
            'answer': '（1）2/9；（2）7/9；（3）0，1',
            'explanation': (
                '口袋中共有2+3+4=9个球。（1）红球有2个，概率为2/9。'
                '（2）黄球和黑球共有3+4=7个，概率为7/9，也可用1-2/9求得。'
                '（3）口袋中没有绿球，所以摸到绿球的概率为0，不是绿球的概率为1。'
            ),
        },
        '六年级_14_超越篇_8': {
            'content': (
                '8. 3月25日正午12点，甲、乙两艘轮船分别从A、B两港同时出发，相向而行。'
                '航行中的每天正午12点，两船各放出一只以相同速度飞向B港的信鸽。甲船3月31日放出的'
                '“阿呆”与乙船4月1日放出的“阿瓜”同时到达B港。4月7日正午12点乙船到达A港并放出'
                '最后一只信鸽，该信鸽恰好与甲船同时到达B港。除“阿呆”和“阿瓜”外，还有一对信鸽'
                '同时到达B港，求这对信鸽到达B港的准确时间。'
            ),
            'answer': '4月11日0:00',
            'explanation': (
                '以3月25日正午为第0天，设鸽速为1，甲、乙船速分别为r、s，A、B距离为d。'
                '乙船第13天到达A港，所以d=13s。甲船第6天与乙船第7天放出的鸽子同时到达，'
                '得到d+6(1-r)=7(1+s)，即s-r=1/6。乙船第13天放出的鸽子与甲船同时到B港，'
                '故13(1+s)=d/r=13s/r，得到r=s/(1+s)。联立可得s=1/2、r=1/3、d=13/2。'
                '甲船第t天、乙船第k天放出的鸽子到达时刻分别为13/2+2t/3与3k/2。令二者相等，'
                '得39+4t=9k。在航行日范围内有(t,k)=(6,7)和(15,11)。第二对在第16.5天到达，'
                '即4月11日0:00。'
            ),
        },
        '六年级_14_兴趣篇_5': {
            'answer': '50千米',
            'explanation': (
                '从出发到乙、丙相遇，乙走了30+15=45千米。甲、乙速度比为8:9，'
                '所以甲走了45×8/9=40千米。此后到甲、丙相遇，丙走了15+6=21千米，'
                '甲走了10+(20-6)=24千米，因此甲、乙、丙速度比为24:27:21=8:9:7。'
                '乙、丙相遇时丙走了40×7/8=35千米，此时乙、丙合走完BC全程，'
                '所以BC=45+35=80千米，OC=80-30=50千米。'
            ),
        },
        '六年级_14_超越篇_1': {
            'answer': '36秒',
            'explanation': (
                '把每次碰撞看成两个球互相穿过，只交换字母，不改变各速度轨迹。以A点为起点，'
                't秒后四条轨迹走过的路程分别为t、12+2t、24+3t、36+4t米。'
                '四球同时相遇时，任意两条轨迹的路程差都应为周长48米的整数倍。'
                '第一次满足条件取最小正数，令12+2t-t=48，得t=36。'
                '此时四条路程为36、84、132、180米，两两之差均为48的倍数，所以第一次同时相遇在36秒后。'
            ),
        },
        '六年级_17_兴趣篇_5': {
            'content': (
                '5. 一个容器装了3/4的水，现有大、中、小三种小球。第一次把1个中球沉入水中；'
                '第二次将中球取出，再把3个小球沉入水中；第三次取出所有小球，再把1个大球沉入水中。'
                '最后将大球从水中取出，此时容器内剩下的水是最开始的2/9。已知第一次溢水量是第三次的一半，'
                '第三次是第二次的一半，求大、中、小三球的体积比。'
            ),
            'answer': '大：中：小=15：6：4',
            'explanation': (
                '设容器容量为C，三次溢水量依次为x、4x、2x。设大、中、小球体积为L、M、S。'
                '第一次有M-C/4=x；第二次有3S-M=4x；第三次有L-3S=2x。'
                '取出大球后剩水为最初水量的2/9，即C-L=(3C/4)×2/9=C/6，所以L=5C/6。'
                '由三式依次得到M=C/4+x、3S=C/4+5x、L=C/4+7x。代入L=5C/6，'
                '求得x=C/12，进而M=C/3、S=2C/9。故L:M:S=5/6:1/3:2/9=15:6:4。'
            ),
        },
        '六年级_17_拓展篇_2': {
            'content': (
                '2. 2008年3月1日起，工资、薪金所得的费用扣除标准为2000元/月。税率分级为：'
                '不超过500元部分5%，超过500元至2000元部分10%，超过2000元至5000元部分15%，'
                '超过5000元至20000元部分20%，超过20000元至40000元部分25%。全月应纳税所得额为'
                '月工资减去2000元后的余额。（1）王先生某月工资4480元，应缴税款多少元？'
                '（2）张先生某月缴纳个人所得税1165元，该月工资是多少元？'
            ),
            'answer': '（1）247元；（2）9700元',
            'explanation': (
                '（1）应纳税所得额为4480-2000=2480元，应缴税款为'
                '500×5%+1500×10%+480×15%=247元。'
                '（2）前三级税款共25+150+450=625元，剩余1165-625=540元按20%计税，'
                '对应所得额为540÷20%=2700元。全月应纳税所得额为5000+2700=7700元，'
                '所以工资为7700+2000=9700元。'
            ),
        },
    }
    # These legacy fallbacks are full-width row captures rather than a single
    # answer. They mix neighbouring questions or even the next section into
    # the image. The bank already contains complete, authored text solutions,
    # so hiding the wrong picture is safer and clearer than displaying it.
    invalid_answer_crop_ids = {
        '三年级_13_兴趣篇_1',
        '三年级_13_拓展篇_3',
        '三年级_13_拓展篇_9',
        '三年级_13_超越篇_5',
        '三年级_18_兴趣篇_9',
        '三年级_18_兴趣篇_10',
        '三年级_18_拓展篇_7',
        '三年级_18_拓展篇_9',
        '三年级_20_兴趣篇_3',
        '三年级_20_拓展篇_3',
        '三年级_20_拓展篇_9',
        '四年级_20_拓展篇_10',
        '五年级_19_拓展篇_4',
        '五年级_19_拓展篇_5',
        '五年级_19_拓展篇_11',
        '五年级_19_超越篇_1',
        '五年级_21_兴趣篇_1',
        '六年级_23_兴趣篇_7',
        '六年级_23_拓展篇_8',
        '六年级_23_拓展篇_10',
        '三年级_13_超越篇_7',
        '四年级_2_拓展篇_3',
        '五年级_21_兴趣篇_7',
        '六年级_14_超越篇_8',
        '六年级_23_兴趣篇_2',
    }
    reviewed_answer_crop_ids = {
        '三年级_11_拓展篇_14',
        '三年级_11_超越篇_1',
        '三年级_11_超越篇_2',
        '三年级_11_超越篇_5',
        '三年级_20_拓展篇_5',
        '四年级_2_超越篇_1',
        '四年级_20_兴趣篇_1',
        '五年级_15_超越篇_7',
        '六年级_17_超越篇_4',
        '六年级_23_超越篇_6',
        '五年级_12_兴趣篇_1',
        '五年级_15_兴趣篇_3',
        '六年级_23_兴趣篇_1',
        '六年级_23_超越篇_5',
    }
    for question in questions:
        if question['id'] in updates:
            question.update(updates[question['id']])
        if question['id'] in invalid_answer_crop_ids:
            question.update({
                'ans_slice_url': None,
                'needs_ai_explanation': True,
            })
        if question['id'] in reviewed_answer_crop_ids:
            question['answer_crop_reviewed'] = True
    questions_path.write_text(
        json.dumps(questions, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(
        'Recovered official crops: 36 answers + 12 questions; '
        '25 invalid/partial fallbacks replaced by authored explanations'
    )


if __name__ == '__main__':
    main()
