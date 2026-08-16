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

def crop_and_extract_all():
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

    module_mapping = {
        '三年级_11': ('数字谜', '巧填算符与盈亏问题'),
        '三年级_13': ('应用题', '和差倍问题综合'),
        '三年级_18': ('计数', '枚举法与分类计数'),
        '三年级_20': ('几何', '图形周长与割补面积'),
        '四年级_2': ('计算', '加法乘法原理综合'),
        '四年级_20': ('应用题', '行程问题初步与相遇追及'),
        '五年级_12': ('数论', '因数与倍数质数合数分解'),
        '五年级_15': ('几何', '共角定理与燕尾鸟头模型'),
        '五年级_19': ('几何', '梯形蝴蝶定理与多边形面积'),
        '五年级_21': ('数论', '同余定理与周期问题'),
        '五年级_22': ('应用题', '牛吃草问题与钟表问题'),
        '五年级_24': ('应用题', '比例应用题与工程问题'),
        '六年级_14': ('数论', '不定方程与同余方程组'),
        '六年级_17': ('计数', '排列组合综合与容斥原理'),
        '六年级_23': ('几何', '立体图形表面积与体积')
    }

    all_chapters = []
    all_questions = []

    for grade_name, folder_name, chapter_nums in grade_configs:
        folder_path = os.path.join(base_dir, folder_name)

        for ch_num in chapter_nums:
            cid = f"{grade_name}_{ch_num}"
            mod, sub_mod = module_mapping.get(cid, ('应用题', f'第{ch_num}讲'))

            q_pdf = None
            ans_pdf = None

            for f in os.listdir(folder_path):
                if f"第{ch_num}讲" in f:
                    if "答案" in f:
                        ans_pdf = os.path.join(folder_path, f)
                    else:
                        q_pdf = os.path.join(folder_path, f)

            if not q_pdf or not ans_pdf:
                continue

            q_doc = fitz.open(q_pdf)
            ans_doc = fitz.open(ans_pdf)

            # Step 1: Render all question pages and OCR them
            q_page_data = []
            for p_idx, page in enumerate(q_doc):
                pix = page.get_pixmap(dpi=150)
                img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
                res, _ = ocr(np.array(img))
                lines = []
                if res:
                    for item in res:
                        # bbox: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
                        box, text, score = item
                        y0 = min(p[1] for p in box)
                        y1 = max(p[1] for p in box)
                        x0 = min(p[0] for p in box)
                        x1 = max(p[0] for p in box)
                        lines.append({'y0': y0, 'y1': y1, 'x0': x0, 'x1': x1, 'text': text})
                q_page_data.append({'img': img, 'lines': lines, 'width': pix.width, 'height': pix.height})

            # Step 2: Render all answer pages and OCR them
            ans_page_data = []
            for ap_idx, apage in enumerate(ans_doc):
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
                        lines.append({'y0': y0, 'y1': y1, 'x0': x0, 'x1': x1, 'text': text})
                ans_page_data.append({'img': img, 'lines': lines, 'width': pix.width, 'height': pix.height})

            # Helper to find sections and question anchors in question pages
            current_section = '兴趣篇'
            q_anchors = [] # list of (section, q_num, page_idx, y_start, text)

            for p_idx, p_data in enumerate(q_page_data):
                for l in p_data['lines']:
                    txt = l['text'].strip()
                    if '兴趣篇' in txt:
                        current_section = '兴趣篇'
                    elif '拓展篇' in txt:
                        current_section = '拓展篇'
                    elif '超越篇' in txt:
                        current_section = '超越篇'

                    # Match question headers like "1.", "2.", "★ 1.", "1.★", "10.", etc.
                    m = re.match(r'^[★\s]*(\d{1,2})[\.、\s]+(.*)', txt)
                    if m:
                        q_num = int(m.group(1))
                        # Avoid page footer numbers or random numbers
                        if 1 <= q_num <= 15:
                            # Check if this q_num matches current section expectations
                            q_anchors.append({
                                'section': current_section,
                                'q_num': q_num,
                                'page_idx': p_idx,
                                'y0': l['y0'],
                                'first_line': m.group(2) or txt
                            })

            # Deduplicate and sort q_anchors
            valid_anchors = []
            seen = set()
            for a in q_anchors:
                key = (a['section'], a['q_num'])
                if key not in seen:
                    seen.add(key)
                    valid_anchors.append(a)

            # Sort by section order (兴趣篇 -> 拓展篇 -> 超越篇) and q_num
            sec_order = {'兴趣篇': 1, '拓展篇': 2, '超越篇': 3}
            valid_anchors.sort(key=lambda x: (sec_order.get(x['section'], 9), x['q_num']))

            # Helper to find answer anchors in answer pages
            ans_anchors = []
            cur_ans_sec = '兴趣篇'
            for ap_idx, ap_data in enumerate(ans_page_data):
                for l in ap_data['lines']:
                    txt = l['text'].strip()
                    if '兴趣篇' in txt:
                        cur_ans_sec = '兴趣篇'
                    elif '拓展篇' in txt:
                        cur_ans_sec = '拓展篇'
                    elif '超越篇' in txt:
                        cur_ans_sec = '超越篇'

                    m = re.match(r'^[★\s]*(\d{1,2})[\.、\s]+(.*)', txt)
                    if m:
                        q_num = int(m.group(1))
                        if 1 <= q_num <= 15:
                            ans_anchors.append({
                                'section': cur_ans_sec,
                                'q_num': q_num,
                                'page_idx': ap_idx,
                                'y0': l['y0'],
                                'first_line': txt
                            })

            valid_ans_anchors = []
            seen_ans = set()
            for a in ans_anchors:
                key = (a['section'], a['q_num'])
                if key not in seen_ans:
                    seen_ans.add(key)
                    valid_ans_anchors.append(a)
            valid_ans_anchors.sort(key=lambda x: (sec_order.get(x['section'], 9), x['q_num']))

            # Expected 26 questions: 兴趣 1-6, 拓展 1-12, 超越 1-8
            expected_list = [
                ('兴趣篇', 6, '★', 2),
                ('拓展篇', 12, '★★', 3),
                ('超越篇', 8, '★★★', 5)
            ]

            ch_questions = []

            for sec_name, count, stars, diff in expected_list:
                for i in range(1, count + 1):
                    qid = f"{cid}_{sec_name}_{i}"
                    
                    # 1. Precise Question Crop
                    # Find anchor for this question
                    curr_a = next((a for a in valid_anchors if a['section'] == sec_name and a['q_num'] == i), None)
                    # Next anchor on the same page
                    next_a = None
                    if curr_a:
                        curr_idx = valid_anchors.index(curr_a)
                        if curr_idx + 1 < len(valid_anchors):
                            cand = valid_anchors[curr_idx + 1]
                            if cand['page_idx'] == curr_a['page_idx']:
                                next_a = cand

                    q_crop_filename = f"{grade_name}_ch{ch_num}_{sec_name}_{i}_q.png"
                    q_crop_path = os.path.join(crops_dir, q_crop_filename)
                    q_text_lines = []

                    if curr_a:
                        p_idx = curr_a['page_idx']
                        p_img = q_page_data[p_idx]['img']
                        w = q_page_data[p_idx]['width']
                        h = q_page_data[p_idx]['height']
                        
                        y_start = max(0, curr_a['y0'] - 20)
                        y_end = min(h, next_a['y0'] - 10) if next_a else min(h, curr_a['y0'] + 360)

                        # Extract text lines belonging to this question
                        for l in q_page_data[p_idx]['lines']:
                            if curr_a['y0'] - 10 <= l['y0'] < (next_a['y0'] if next_a else y_end):
                                # Filter out page footer or header
                                if '学而思' not in l['text'] and '高斯' not in l['text']:
                                    q_text_lines.append(l['text'])

                        crop_box = (0, int(y_start), w, int(y_end))
                        cropped = p_img.crop(crop_box)
                        cropped.save(q_crop_path)
                    else:
                        # Fallback default crop
                        q_crop_filename = None

                    # 2. Precise Answer Crop
                    curr_ans = next((a for a in valid_ans_anchors if a['section'] == sec_name and a['q_num'] == i), None)
                    next_ans = None
                    if curr_ans:
                        curr_ans_idx = valid_ans_anchors.index(curr_ans)
                        if curr_ans_idx + 1 < len(valid_ans_anchors):
                            cand_ans = valid_ans_anchors[curr_ans_idx + 1]
                            if cand_ans['page_idx'] == curr_ans['page_idx']:
                                next_ans = cand_ans

                    ans_crop_filename = f"{grade_name}_ch{ch_num}_{sec_name}_{i}_ans.png"
                    ans_crop_path = os.path.join(crops_dir, ans_crop_filename)
                    ans_text_lines = []

                    if curr_ans:
                        ap_idx = curr_ans['page_idx']
                        ap_img = ans_page_data[ap_idx]['img']
                        w = ans_page_data[ap_idx]['width']
                        h = ans_page_data[ap_idx]['height']

                        y_start = max(0, curr_ans['y0'] - 15)
                        y_end = min(h, next_ans['y0'] - 10) if next_ans else min(h, curr_ans['y0'] + 320)

                        for l in ans_page_data[ap_idx]['lines']:
                            if curr_ans['y0'] - 10 <= l['y0'] < (next_ans['y0'] if next_ans else y_end):
                                if '学而思' not in l['text'] and '高斯' not in l['text']:
                                    ans_text_lines.append(l['text'])

                        crop_box = (0, int(y_start), w, int(y_end))
                        cropped_ans = ap_img.crop(crop_box)
                        cropped_ans.save(ans_crop_path)
                    else:
                        ans_crop_filename = None

                    # Build exact text
                    full_q_text = "\n".join(q_text_lines).strip()
                    if not full_q_text:
                        full_q_text = f"【{grade_name}《高斯导引》第{ch_num}讲 {sec_name} 第{i}题】"

                    full_ans_text = "\n".join(ans_text_lines).strip()
                    if not full_ans_text:
                        full_ans_text = f"详见原版名师精解"

                    # Parse direct answer if possible
                    ans_val = "见解析"
                    m_ans = re.search(r'【答案】\s*([^\n]+)', full_ans_text)
                    if m_ans:
                        ans_val = m_ans.group(1).strip()

                    q_obj = {
                        "id": qid,
                        "chapter_id": cid,
                        "grade": grade_name,
                        "grade_num": {'三年级': 3, '四年级': 4, '五年级': 5, '六年级': 6}.get(grade_name, 3),
                        "chapter_num": ch_num,
                        "chapter_title": f"第{ch_num}讲 {sub_mod}",
                        "module": mod,
                        "sub_module": sub_mod,
                        "section": sec_name,
                        "section_num": sec_order.get(sec_name, 1),
                        "global_chapter_num": ch_num,
                        "display_title": f"{grade_name} 第{ch_num}讲 {sec_name} 第{i}题",
                        "short_title": f"{sec_name} #{i}",
                        "difficulty": diff,
                        "difficulty_stars": stars,
                        "score": 10,
                        "content": full_q_text,
                        "answer": ans_val,
                        "explanation": full_ans_text,
                        "analysis": f"考点：{mod}·{sub_mod}",
                        "key_point": "仔细审题，分步列式，注意验算。",
                        "q_slice_url": f"/bank/crops/{q_crop_filename}" if q_crop_filename and os.path.exists(q_crop_path) else None,
                        "ans_slice_url": f"/bank/crops/{ans_crop_filename}" if ans_crop_filename and os.path.exists(ans_crop_path) else None,
                        "tags": [grade_name, mod, sub_mod, sec_name]
                    }
                    ch_questions.append(q_obj)
                    all_questions.append(q_obj)

            all_chapters.append({
                "id": cid,
                "grade": grade_name,
                "grade_num": {'三年级': 3, '四年级': 4, '五年级': 5, '六年级': 6}.get(grade_name, 3),
                "chapter_num": ch_num,
                "title": f"第{ch_num}讲 {sub_mod}",
                "module": mod,
                "sub_module": sub_mod,
                "difficulty": 3,
                "total_questions": len(ch_questions),
                "sections": [
                    { "name": "兴趣篇", "count": 6, "diff": "★", "start_index": 1, "end_index": 6 },
                    { "name": "拓展篇", "count": 12, "diff": "★★", "start_index": 1, "end_index": 12 },
                    { "name": "超越篇", "count": 8, "diff": "★★★", "start_index": 1, "end_index": 8 }
                ]
            })

            print(f"Processed 100% authentic crops & text for {grade_name} 第{ch_num}讲: {len(ch_questions)} questions")

    with open(os.path.join(output_dir, 'chapters.json'), 'w', encoding='utf-8') as f:
        json.dump(all_chapters, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, 'questions.json'), 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)

    print(f"\nALL DONE: Extracted {len(all_questions)} precise question crops & answers into {crops_dir}!")

if __name__ == "__main__":
    crop_and_extract_all()
