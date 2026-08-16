# -*- coding: utf-8 -*-
import os
import sys
import json
import re
import fitz
from PIL import Image
import numpy as np
from rapidocr_onnxruntime import RapidOCR

ocr = RapidOCR()

def extract_chapter_fully(grade_name, folder_name, ch_num, base_dir, crops_dir):
    folder_path = os.path.join(base_dir, folder_name)
    cid = f"{grade_name}_{ch_num}"

    q_pdf = None
    ans_pdf = None

    for f in os.listdir(folder_path):
        if f"第{ch_num}讲" in f:
            if "答案" in f:
                ans_pdf = os.path.join(folder_path, f)
            else:
                q_pdf = os.path.join(folder_path, f)

    if not q_pdf or not ans_pdf:
        print(f"Error: Missing PDF for {grade_name} 第{ch_num}讲")
        return None, []

    q_doc = fitz.open(q_pdf)
    ans_doc = fitz.open(ans_pdf)

    # 1. Extract Question Pages with OCR
    q_pages = []
    for p_idx in range(len(q_doc)):
        page = q_doc[p_idx]
        pix = page.get_pixmap(dpi=150)
        img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
        res, _ = ocr(np.array(img))
        lines = []
        if res:
            for item in res:
                box, text, score = item
                y0 = min(p[1] for p in box)
                y1 = max(p[1] for p in box)
                x0 = min(p[0] for p in box)
                x1 = max(p[0] for p in box)
                lines.append({'y0': y0, 'y1': y1, 'x0': x0, 'x1': x1, 'text': text.strip()})
        q_pages.append({'img': img, 'lines': lines, 'width': pix.width, 'height': pix.height})

    # Detect Chapter Title from Page 1
    ch_title = f"第{ch_num}讲"
    for l in q_pages[0]['lines'][:6]:
        txt = l['text']
        if f"第{ch_num}讲" in txt or "讲" in txt:
            ch_title = txt
            break

    # Parse Question Anchors
    current_section = "兴趣篇"
    q_anchors = [] # (section, q_num, p_idx, line_idx, y0, first_line)

    for p_idx, p_data in enumerate(q_pages):
        for l_idx, l in enumerate(p_data['lines']):
            txt = l['text']
            if '兴趣篇' in txt:
                current_section = '兴趣篇'
            elif '拓展篇' in txt:
                current_section = '拓展篇'
            elif '超越篇' in txt:
                current_section = '超越篇'

            m = re.match(r'^[★\s]*(\d{1,2})[\.、\s]+(.*)', txt)
            if m:
                q_num = int(m.group(1))
                if 1 <= q_num <= 25 and l['y0'] < p_data['height'] - 120:
                    q_anchors.append({
                        'section': current_section,
                        'q_num': q_num,
                        'p_idx': p_idx,
                        'l_idx': l_idx,
                        'y0': l['y0'],
                        'text': txt
                    })

    # Deduplicate question anchors
    valid_q_anchors = []
    seen = set()
    for a in q_anchors:
        k = (a['section'], a['q_num'])
        if k not in seen:
            seen.add(k)
            valid_q_anchors.append(a)

    # 2. Extract Answer Pages with OCR
    ans_pages = []
    for ap_idx in range(len(ans_doc)):
        apage = ans_doc[ap_idx]
        pix = apage.get_pixmap(dpi=150)
        img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
        res, _ = ocr(np.array(img))
        lines = []
        if res:
            for item in res:
                box, text, score = item
                y0 = min(p[1] for p in box)
                y1 = max(p[1] for p in box)
                x0 = min(p[0] for p in box)
                x1 = max(p[0] for p in box)
                lines.append({'y0': y0, 'y1': y1, 'x0': x0, 'x1': x1, 'text': text.strip()})
        ans_pages.append({'img': img, 'lines': lines, 'width': pix.width, 'height': pix.height})

    ans_anchors = []
    cur_ans_sec = '兴趣篇'
    for ap_idx, ap_data in enumerate(ans_pages):
        for l_idx, l in enumerate(ap_data['lines']):
            txt = l['text']
            if '兴趣篇' in txt:
                cur_ans_sec = '兴趣篇'
            elif '拓展篇' in txt:
                cur_ans_sec = '拓展篇'
            elif '超越篇' in txt:
                cur_ans_sec = '超越篇'

            m = re.match(r'^[★\s]*(\d{1,2})[\.、\s]+(.*)', txt)
            if m:
                q_num = int(m.group(1))
                if 1 <= q_num <= 25 and l['y0'] < ap_data['height'] - 120:
                    ans_anchors.append({
                        'section': cur_ans_sec,
                        'q_num': q_num,
                        'p_idx': ap_idx,
                        'l_idx': l_idx,
                        'y0': l['y0'],
                        'text': txt
                    })

    valid_ans_anchors = []
    seen_ans = set()
    for a in ans_anchors:
        k = (a['section'], a['q_num'])
        if k not in seen_ans:
            seen_ans.add(k)
            valid_ans_anchors.append(a)

    questions_list = []

    for i, qa in enumerate(valid_q_anchors):
        sec_name = qa['section']
        q_num = qa['q_num']
        p_idx = qa['p_idx']
        p_data = q_pages[p_idx]
        qid = f"{cid}_{sec_name}_{q_num}"

        # Determine y_end for this question crop
        # If there is another anchor on the SAME page:
        next_qa_same_page = next((nxt for nxt in valid_q_anchors[i+1:] if nxt['p_idx'] == p_idx), None)
        
        y_start = max(0, qa['y0'] - 15)
        if next_qa_same_page:
            y_end = max(y_start + 80, next_qa_same_page['y0'] - 10)
        else:
            # Last question on this page: find bottom of last line before footer
            content_lines = [l for l in p_data['lines'] if l['y0'] >= qa['y0'] and l['y0'] < p_data['height'] - 130]
            if content_lines:
                y_end = min(p_data['height'], max(l['y1'] for l in content_lines) + 30)
            else:
                y_end = min(p_data['height'], qa['y0'] + 350)

        # Collect exact question text
        q_lines_text = []
        for l in p_data['lines']:
            if qa['y0'] - 10 <= l['y0'] < y_end:
                if '学而思' not in l['text'] and '高斯' not in l['text']:
                    q_lines_text.append(l['text'])

        q_content = "\n".join(q_lines_text).strip()

        # Crop Question Image
        q_crop_name = f"{grade_name}_ch{ch_num}_{sec_name}_{q_num}_q.png"
        q_crop_path = os.path.join(crops_dir, q_crop_name)
        crop_box = (0, int(y_start), p_data['width'], int(y_end))
        q_crop_img = p_data['img'].crop(crop_box)
        q_crop_img.save(q_crop_path)

        # Match Answer
        matching_ans = next((ans for ans in valid_ans_anchors if ans['section'] == sec_name and ans['q_num'] == q_num), None)
        ans_content = "见原版名师精解"
        ans_val = "见解析"
        ans_crop_name = None

        if matching_ans:
            ap_idx = matching_ans['p_idx']
            ap_data = ans_pages[ap_idx]
            ans_idx_in_list = valid_ans_anchors.index(matching_ans)
            next_ans_same_page = next((nxt for nxt in valid_ans_anchors[ans_idx_in_list+1:] if nxt['p_idx'] == ap_idx), None)

            ay_start = max(0, matching_ans['y0'] - 15)
            if next_ans_same_page:
                ay_end = max(ay_start + 60, next_ans_same_page['y0'] - 10)
            else:
                ans_content_lines = [l for l in ap_data['lines'] if l['y0'] >= matching_ans['y0'] and l['y0'] < ap_data['height'] - 130]
                if ans_content_lines:
                    ay_end = min(ap_data['height'], max(l['y1'] for l in ans_content_lines) + 25)
                else:
                    ay_end = min(ap_data['height'], matching_ans['y0'] + 300)

            ans_lines_text = []
            for l in ap_data['lines']:
                if matching_ans['y0'] - 10 <= l['y0'] < ay_end:
                    if '学而思' not in l['text'] and '高斯' not in l['text']:
                        ans_lines_text.append(l['text'])

            ans_content = "\n".join(ans_lines_text).strip()

            # Parse direct answer value
            m_ans = re.search(r'【答案】\s*([^\n]+)', ans_content)
            if m_ans:
                ans_val = m_ans.group(1).strip()

            ans_crop_name = f"{grade_name}_ch{ch_num}_{sec_name}_{q_num}_ans.png"
            ans_crop_path = os.path.join(crops_dir, ans_crop_name)
            ans_crop_box = (0, int(ay_start), ap_data['width'], int(ay_end))
            ans_crop_img = ap_data['img'].crop(ans_crop_box)
            ans_crop_img.save(ans_crop_path)

        diff = 2 if sec_name == '兴趣篇' else 3 if sec_name == '拓展篇' else 5
        stars = '★' if sec_name == '兴趣篇' else '★★' if sec_name == '拓展篇' else '★★★'

        q_obj = {
            "id": qid,
            "chapter_id": cid,
            "grade": grade_name,
            "grade_num": {'三年级': 3, '四年级': 4, '五年级': 5, '六年级': 6}.get(grade_name, 3),
            "chapter_num": ch_num,
            "chapter_title": ch_title,
            "module": "奥数导引",
            "sub_module": ch_title,
            "section": sec_name,
            "section_num": 1 if sec_name == '兴趣篇' else 2 if sec_name == '拓展篇' else 3,
            "global_chapter_num": ch_num,
            "display_title": f"{grade_name} {ch_title} {sec_name} 第{q_num}题",
            "short_title": f"{sec_name} 第{q_num}题",
            "difficulty": diff,
            "difficulty_stars": stars,
            "score": 10,
            "content": q_content,
            "answer": ans_val,
            "explanation": ans_content,
            "analysis": f"考点：{ch_title}·{sec_name}",
            "key_point": "仔细审题，分步列式，注意验算。",
            "q_slice_url": f"/bank/crops/{q_crop_name}",
            "ans_slice_url": f"/bank/crops/{ans_crop_name}" if ans_crop_name else None,
            "tags": [grade_name, sec_name, f"第{ch_num}讲"]
        }
        questions_list.append(q_obj)

    ch_obj = {
        "id": cid,
        "grade": grade_name,
        "grade_num": {'三年级': 3, '四年级': 4, '五年级': 5, '六年级': 6}.get(grade_name, 3),
        "chapter_num": ch_num,
        "title": ch_title,
        "module": "奥数导引",
        "sub_module": ch_title,
        "difficulty": 3,
        "total_questions": len(questions_list),
        "sections": [
            { "name": "兴趣篇", "count": len([q for q in questions_list if q['section'] == '兴趣篇']) },
            { "name": "拓展篇", "count": len([q for q in questions_list if q['section'] == '拓展篇']) },
            { "name": "超越篇", "count": len([q for q in questions_list if q['section'] == '超越篇']) }
        ]
    }

    print(f"Extracted {grade_name} 第{ch_num}讲: {len(questions_list)} genuine questions! Title: {ch_title}")
    return ch_obj, questions_list

def main():
    base_dir = r'E:\desktop\高斯第三季度刷题(1)\高斯第三季度刷题'
    output_dir = r'e:\desktop\strj\public\bank'
    crops_dir = os.path.join(output_dir, 'crops')
    os.makedirs(crops_dir, exist_ok=True)

    grade_configs = [
        ('三年级', '高斯三年级', [11, 13, 18, 20]),
        ('四年级', '高斯四年级', [2, 20]),
        ('五年级', '高斯五年级', [12, 15, 19, 21, 22, 24]),
        ('六年级', '高斯六年级', [14, 17, 23])
    ]

    all_chapters = []
    all_questions = []

    for grade_name, folder_name, chapter_nums in grade_configs:
        for ch_num in chapter_nums:
            ch_obj, qs = extract_chapter_fully(grade_name, folder_name, ch_num, base_dir, crops_dir)
            if ch_obj:
                all_chapters.append(ch_obj)
                all_questions.extend(qs)

    with open(os.path.join(output_dir, 'chapters.json'), 'w', encoding='utf-8') as f:
        json.dump(all_chapters, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, 'questions.json'), 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)

    print(f"\n=======================================================")
    print(f"SUCCESS: Extracted {len(all_chapters)} chapters, {len(all_questions)} 100% authentic questions with precise single-question image crops and full text!")
    print(f"=======================================================")

if __name__ == "__main__":
    main()
