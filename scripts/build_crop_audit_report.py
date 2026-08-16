# -*- coding: utf-8 -*-
"""Build a fast, local visual QA board for question/answer crops."""

import argparse
from collections import Counter
import html
import json
import os
import re
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def image_info(path: Path):
    if not path.exists():
        return None
    try:
        with Image.open(path) as image:
            return image.width, image.height
    except Exception:
        return None


def answer_number_markers(path: Path):
    """Find the dark square printed before each official answer number."""
    if not path.exists():
        return []
    try:
        with Image.open(path) as image:
            gray = np.array(image.convert('L'))
    except Exception:
        return []
    binary = cv2.threshold(gray, 210, 255, cv2.THRESH_BINARY_INV)[1]
    markers = []
    for contour in cv2.findContours(
        binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )[0]:
        x, y, width, height = cv2.boundingRect(contour)
        fill_ratio = cv2.contourArea(contour) / max(1, width * height)
        if (
            x <= 140
            and 23 <= width <= 29
            and 23 <= height <= 29
            and fill_ratio >= 0.80
        ):
            markers.append((y, x))
    return sorted(markers)


def url_to_path(bank_dir: Path, url):
    if not url:
        return None
    filename = str(url).replace('\\', '/').split('/')[-1]
    return bank_dir / 'crops' / filename


def relative_url(report_path: Path, image_path: Path):
    return os.path.relpath(image_path, report_path.parent).replace('\\', '/')


def build_report(bank_dir: Path, output_path: Path):
    questions_path = bank_dir / 'questions.json'
    questions = json.loads(questions_path.read_text(encoding='utf-8'))
    cards = []
    issue_count = 0
    image_issue_count = 0
    text_issue_count = 0
    missing_count = 0
    authored_answer_count = 0
    text_issue_reasons = Counter()

    for question in questions:
        question_path = url_to_path(bank_dir, question.get('q_slice_url'))
        answer_path = url_to_path(bank_dir, question.get('ans_slice_url'))
        question_size = image_info(question_path) if question_path else None
        answer_size = image_info(answer_path) if answer_path else None
        answer_markers = answer_number_markers(answer_path) if answer_path else []
        image_issues = []
        text_issues = []
        info_badges = []

        if not question_size:
            image_issues.append('缺少题目图')
            missing_count += 1
        elif question.get('question_crop_reviewed'):
            info_badges.append('题目图已人工复核')
        elif question_size[1] < 110:
            image_issues.append('题目图过短')
        elif question_size[1] > question_size[0] * 5:
            image_issues.append('题目图异常长/跨多页')

        if not answer_size:
            if question.get('needs_ai_explanation') and question.get('explanation'):
                info_badges.append('原书无答案图 · 已补写解析')
                authored_answer_count += 1
            else:
                image_issues.append('缺少答案图')
                missing_count += 1
        elif answer_size[0] > 700:
            image_issues.append('答案图异常宽/疑似跨栏串题')
        elif len(answer_markers) > 1:
            image_issues.append(f'答案图串入其他题（检测到{len(answer_markers)}个题号）')
        elif question.get('answer_crop_reviewed'):
            info_badges.append('特殊答案图已人工复核')
        elif not answer_markers:
            image_issues.append('答案图未识别到本题题号')
        elif len(answer_markers) == 1 and answer_markers[0][0] > 100:
            image_issues.append('答案图开头疑似夹带上一题')
        elif answer_size[1] < 90:
            image_issues.append('答案图过短')
        elif answer_size[1] > answer_size[0] * 7:
            image_issues.append('答案图异常长/跨多栏')

        content = str(question.get('content') or '').strip()
        answer = str(question.get('answer') or '').strip()
        explanation = str(question.get('explanation') or '').strip()
        placeholder_answers = {'', '见解析', '见解答', '详见解析', '详见原版名师精解'}
        placeholder_explanations = {'', '见解析', '详见解析', '详见原版名师精解'}

        if answer in placeholder_answers:
            text_issues.append('答案文本需补写')
        if explanation in placeholder_explanations:
            text_issues.append('解析文本需补写')
        if len(re.sub(r'\s+', '', content)) < 12:
            text_issues.append('题目文本过短/疑似漏识别')
        if content.endswith(('：', ':')):
            text_issues.append('题目文本疑似缺少跨页后半段')
        if any(marker in content for marker in ('参考答案', '兴趣篇', '拓展篇', '超越篇', '高思学校竞赛数学导引')):
            text_issues.append('题目文本疑似混入页眉页脚')
        if answer not in placeholder_answers and (len(answer) > 120 or '解答' in answer or '参考答案' in answer):
            text_issues.append('答案文本疑似混入解析')
        try:
            # section_num is the book section code in part of the imported bank,
            # not always the visible question number. The id suffix is canonical.
            expected_number = int(str(question.get('id', '')).rsplit('_', 1)[-1])
            next_number = expected_number + 1
        except (TypeError, ValueError):
            expected_number = 0
            next_number = 0
        visible_number = re.search(r'(?m)^\s*(\d{1,2})[.．、](?!\d)\s*', content)
        if expected_number and visible_number and int(visible_number.group(1)) != expected_number:
            text_issues.append('题目文本题号与题库ID不一致')
        if next_number and re.search(rf'(?m)^\s*{next_number}[.．、](?!\d)\s*', content):
            text_issues.append('题目文本疑似串入下一题')

        issues = image_issues + text_issues

        if issues:
            issue_count += 1
        if image_issues:
            image_issue_count += 1
        if text_issues:
            text_issue_count += 1
            text_issue_reasons.update(set(text_issues))

        grade = str(question.get('grade', '未知年级'))
        chapter = f"{grade} 第{question.get('chapter_num', '?')}讲"
        section = str(question.get('section', ''))
        issue_html = (
            ''.join(f'<span class="badge image-badge">{html.escape(issue)}</span>' for issue in image_issues)
            + ''.join(f'<span class="badge text-badge">{html.escape(issue)}</span>' for issue in text_issues)
            + ''.join(f'<span class="info">{html.escape(info)}</span>' for info in info_badges)
        ) or '<span class="ok">自动检查通过</span>'

        def panel(label, path, size):
            if not path or not size:
                return f'<div class="panel missing"><b>{label}</b><p>图片不存在</p></div>'
            url = html.escape(relative_url(output_path, path), quote=True)
            return (
                f'<a class="panel" href="{url}" target="_blank">'
                f'<b>{label} · {size[0]}×{size[1]}</b>'
                f'<img loading="lazy" src="{url}" alt="{label}">'
                '</a>'
            )

        cards.append(
            f'''<article class="card" data-grade="{html.escape(grade, quote=True)}"
                data-chapter="{html.escape(chapter, quote=True)}"
                data-issue="{'1' if issues else '0'}"
                data-image-issue="{'1' if image_issues else '0'}"
                data-text-issue="{'1' if text_issues else '0'}">
              <header><strong>{html.escape(str(question.get('id', '')))}</strong>
                <span>{html.escape(section)}</span></header>
              <div class="badges">{issue_html}</div>
              <details class="text-preview">
                <summary>查看识别文本</summary>
                <p><b>题目：</b>{html.escape(content[:600])}</p>
                <p><b>答案：</b>{html.escape(answer[:300])}</p>
                <p><b>解析：</b>{html.escape(explanation[:600])}</p>
              </details>
              <div class="pair">
                {panel('题目', question_path, question_size)}
                {panel('答案', answer_path, answer_size)}
              </div>
            </article>'''
        )

    grades = sorted({str(question.get('grade', '未知年级')) for question in questions})
    chapters = sorted(
        {
            f"{question.get('grade', '未知年级')} 第{question.get('chapter_num', '?')}讲"
            for question in questions
        }
    )
    grade_options = ''.join(
        f'<option value="{html.escape(value, quote=True)}">{html.escape(value)}</option>'
        for value in grades
    )
    chapter_options = ''.join(
        f'<option value="{html.escape(value, quote=True)}">{html.escape(value)}</option>'
        for value in chapters
    )

    document = f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>切片审查面板</title>
<style>
:root{{--bg:#f4f6fa;--card:#fff;--ink:#172033;--muted:#667085;--line:#dce1ea;--accent:#315efb;--warn:#c93b36}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif}}
.top{{position:sticky;top:0;z-index:3;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line);padding:14px 20px;box-shadow:0 3px 14px #17203312}}
h1{{font-size:20px;margin:0 0 8px}} .summary{{color:var(--muted);margin-bottom:10px}}
.filters{{display:flex;gap:10px;flex-wrap:wrap;align-items:center}} select,input{{padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:#fff}}
main{{padding:18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(540px,1fr));gap:14px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;box-shadow:0 3px 12px #1720330b}}
.card header{{display:flex;justify-content:space-between;gap:8px;margin-bottom:7px}} .card header span{{color:var(--muted)}}
.badges{{min-height:25px}} .badge,.info{{display:inline-block;border-radius:999px;padding:2px 7px;margin:0 5px 5px 0}} .image-badge{{color:var(--warn);background:#fff0ef;border:1px solid #ffd0cd}} .text-badge{{color:#8a5b00;background:#fff8e6;border:1px solid #f7d78b}} .info{{color:#315efb;background:#eef3ff;border:1px solid #cbd8ff}} .ok{{color:#087443}}
.text-preview{{margin:0 0 8px;color:var(--muted);font-size:12px}} .text-preview summary{{cursor:pointer;color:#315efb}} .text-preview p{{white-space:pre-wrap;max-height:160px;overflow:auto;background:#f8fafc;border:1px solid var(--line);padding:7px;border-radius:7px;margin:6px 0}}
.pair{{display:grid;grid-template-columns:1fr 1fr;gap:10px}} .panel{{color:inherit;text-decoration:none;border:1px solid var(--line);border-radius:9px;padding:7px;background:#fafbfc;overflow:hidden}}
.panel img{{display:block;width:100%;height:250px;object-fit:contain;background:#20252d;margin-top:6px}} .missing{{display:grid;place-content:center;min-height:290px;color:var(--warn)}}
@media(max-width:700px){{main{{grid-template-columns:1fr;padding:10px}}.pair{{grid-template-columns:1fr}}.panel img{{height:300px}}}}
</style></head><body>
<section class="top"><h1>切片审查面板</h1>
<div class="summary">共 {len(questions)} 道 · 图片疑似异常 {image_issue_count} 道 · 文本待确认 {text_issue_count} 道 · 真正缺图 {missing_count} 张 · 已补写解析 {authored_answer_count} 道。点击图片查看原图。</div>
<div class="summary">文本问题分类：{html.escape('；'.join(f'{reason} {count}道' for reason, count in text_issue_reasons.most_common())) or '无'}</div>
<div class="filters">
<select id="grade"><option value="">全部年级</option>{grade_options}</select>
<select id="chapter"><option value="">全部章节</option>{chapter_options}</select>
<select id="issueType"><option value="image">只看图片异常</option><option value="text">只看答案文本</option><option value="any">全部异常</option><option value="all">全部题目</option></select>
<input id="search" placeholder="搜索题号/文件名">
<span id="visible"></span>
</div></section>
<main>{''.join(cards)}</main>
<script>
const cards=[...document.querySelectorAll('.card')];
function apply(){{const g=grade.value,c=chapter.value,t=issueType.value,s=search.value.trim().toLowerCase();let n=0;
cards.forEach(x=>{{const typeMatch=t==='all'||(t==='any'&&x.dataset.issue==='1')||(t==='image'&&x.dataset.imageIssue==='1')||(t==='text'&&x.dataset.textIssue==='1');const show=(!g||x.dataset.grade===g)&&(!c||x.dataset.chapter===c)&&typeMatch&&(!s||x.textContent.toLowerCase().includes(s));x.hidden=!show;if(show)n++;}});visible.textContent=`当前显示 ${{n}} 道`;}}
[grade,chapter,issueType,search].forEach(x=>x.addEventListener('input',apply));apply();
</script></body></html>'''
    output_path.write_text(document, encoding='utf-8')
    print(f"Audit report: {output_path}")
    print(
        f"Questions={len(questions)} issues={issue_count} "
        f"image_issues={image_issue_count} text_issues={text_issue_count} "
        f"missing_images={missing_count} authored_answers={authored_answer_count}"
    )
    print('Text issue reasons:', dict(text_issue_reasons))


def main():
    project_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser()
    parser.add_argument('bank_dir', nargs='?', default=str(project_root / 'public' / 'bank'))
    parser.add_argument('--output')
    args = parser.parse_args()
    bank_dir = Path(args.bank_dir).resolve()
    output_path = Path(args.output).resolve() if args.output else bank_dir / 'crop_audit.html'
    build_report(bank_dir, output_path)


if __name__ == '__main__':
    main()
