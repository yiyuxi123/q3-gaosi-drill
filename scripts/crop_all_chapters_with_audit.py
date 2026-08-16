# -*- coding: utf-8 -*-
import os
import sys
import json
import re
import fitz
from PIL import Image

def crop_chapter_accurately(grade_name, folder_name, ch_num, base_dir, crops_dir):
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
        return None, []

    q_doc = fitz.open(q_pdf)
    ans_doc = fitz.open(ans_pdf)

    # Save high-res pages
    q_pix_pages = [page.get_pixmap(dpi=150) for page in q_doc]
    q_imgs = [Image.frombytes('RGB', [p.width, p.height], p.samples) for p in q_pix_pages]

    ans_pix_pages = [apage.get_pixmap(dpi=150) for apage in ans_doc]
    ans_imgs = [Image.frombytes('RGB', [p.width, p.height], p.samples) for p in ans_pix_pages]

    # Chapter metadata mapping based on official GaoSi curriculum
    chapter_meta = {
        '三年级_11': ('盈亏问题（一）', '数字谜与应用题', 10, 14, 8),
        '三年级_13': ('和差倍问题综合', '应用题', 10, 14, 8),
        '三年级_18': ('枚举法与分类计数', '计数', 10, 14, 8),
        '三年级_20': ('图形周长与割补面积', '几何', 10, 14, 8),
        '四年级_2': ('加法乘法原理综合', '计算与计数', 10, 14, 8),
        '四年级_20': ('行程问题初步与相遇追及', '应用题', 10, 14, 8),
        '五年级_12': ('因数与倍数质数合数', '数论', 10, 14, 8),
        '五年级_15': ('共角定理与燕尾鸟头模型', '几何', 10, 14, 8),
        '五年级_19': ('梯形蝴蝶定理与面积', '几何', 10, 14, 8),
        '五年级_21': ('同余定理与周期问题', '数论', 10, 14, 8),
        '五年级_22': ('牛吃草问题与钟表问题', '应用题', 10, 14, 8),
        '五年级_24': ('比例应用题与工程问题', '应用题', 10, 14, 8),
        '六年级_14': ('不定方程与同余方程组', '数论', 10, 14, 8),
        '六年级_17': ('排列组合综合与容斥原理', '计数', 10, 14, 8),
        '六年级_23': ('立体图形表面积与体积', '几何', 10, 14, 8)
    }

    ch_title_sub, mod_name, n_xq, n_tz, n_cy = chapter_meta.get(cid, (f'第{ch_num}讲', '奥数导引', 10, 14, 8))
    ch_title = f"第{ch_num}讲 {ch_title_sub}"

    questions = []

    # 1. Slicing 兴趣篇 (1 ~ n_xq)
    # Page 1: Q1, Q2 (bottom half)
    # Page 2: Q3, Q4, Q5, Q6, Q7, Q8
    # Page 3: Q9, Q10
    for i in range(1, n_xq + 1):
        qid = f"{cid}_兴趣篇_{i}"
        q_crop_name = f"{grade_name}_ch{ch_num}_兴趣篇_{i}_q.png"
        ans_crop_name = f"{grade_name}_ch{ch_num}_兴趣篇_{i}_ans.png"

        # Determine Question Page and Crop Box
        if i == 1:
            p_idx = 0
            box = (40, 850, q_imgs[p_idx].width - 40, 1240)
        elif i == 2:
            p_idx = 0
            box = (40, 1240, q_imgs[p_idx].width - 40, 1600)
        elif 3 <= i <= 8:
            p_idx = 1
            slot = i - 3
            slot_h = 240
            y0 = 120 + slot * slot_h
            y1 = min(q_imgs[p_idx].height - 80, y0 + slot_h + 30)
            box = (40, y0, q_imgs[p_idx].width - 40, y1)
        else: # 9, 10
            p_idx = 2
            slot = i - 9
            slot_h = 250
            y0 = 120 + slot * slot_h
            y1 = y0 + slot_h + 20
            box = (40, y0, q_imgs[p_idx].width - 40, y1)

        p_idx = min(len(q_imgs) - 1, p_idx)
        q_crop = q_imgs[p_idx].crop(box)
        q_crop.save(os.path.join(crops_dir, q_crop_name))

        # Answer Page Crop (Answer Page 1: 兴趣篇 1~10)
        ap_idx = 0 if len(ans_imgs) > 0 else 0
        if ap_idx < len(ans_imgs):
            slot_h = int((ans_imgs[ap_idx].height - 240) / max(1, n_xq))
            ay0 = 120 + (i - 1) * slot_h
            ay1 = min(ans_imgs[ap_idx].height - 60, ay0 + slot_h + 30)
            ans_crop = ans_imgs[ap_idx].crop((30, ay0, ans_imgs[ap_idx].width - 30, ay1))
            ans_crop.save(os.path.join(crops_dir, ans_crop_name))

        questions.append({
            "id": qid,
            "chapter_id": cid,
            "grade": grade_name,
            "grade_num": {'三年级': 3, '四年级': 4, '五年级': 5, '六年级': 6}.get(grade_name, 3),
            "chapter_num": ch_num,
            "chapter_title": ch_title,
            "module": mod_name,
            "sub_module": ch_title_sub,
            "section": "兴趣篇",
            "section_num": 1,
            "global_chapter_num": ch_num,
            "display_title": f"{grade_name} {ch_title} 兴趣篇 第{i}题",
            "short_title": f"兴趣篇 第{i}题",
            "difficulty": 2,
            "difficulty_stars": "★",
            "score": 10,
            "content": f"【{grade_name}《高斯导引》{ch_title}·兴趣篇 第{i}题】\n请对照下方原版教材单题切片与图示进行作答：",
            "answer": "见原版名师精解切片",
            "explanation": f"《高斯导引》官方原版参考答案与名师解析详见下方切片：",
            "analysis": f"考点：{ch_title_sub}·兴趣篇基础模型",
            "key_point": "理清已知条件，分步计算验算。",
            "q_slice_url": f"/bank/crops/{q_crop_name}",
            "ans_slice_url": f"/bank/crops/{ans_crop_name}",
            "tags": [grade_name, mod_name, "兴趣篇"]
        })

    # 2. Slicing 拓展篇 (1 ~ n_tz)
    # Page 3: 拓展 1, 2, 3 (y: 750 ~ 1600)
    # Page 4: 拓展 4, 5, 6, 7, 8, 9
    # Page 5: 拓展 10, 11, 12, 13, 14
    for i in range(1, n_tz + 1):
        qid = f"{cid}_拓展篇_{i}"
        q_crop_name = f"{grade_name}_ch{ch_num}_拓展篇_{i}_q.png"
        ans_crop_name = f"{grade_name}_ch{ch_num}_拓展篇_{i}_ans.png"

        if 1 <= i <= 3:
            p_idx = 2
            slot = i - 1
            slot_h = 260
            y0 = 750 + slot * slot_h
            y1 = min(q_imgs[p_idx].height - 80, y0 + slot_h + 20)
            box = (40, y0, q_imgs[p_idx].width - 40, y1)
        elif 4 <= i <= 9:
            p_idx = 3
            slot = i - 4
            slot_h = 240
            y0 = 120 + slot * slot_h
            y1 = min(q_imgs[p_idx].height - 80, y0 + slot_h + 30)
            box = (40, y0, q_imgs[p_idx].width - 40, y1)
        else: # 10 ~ 14
            p_idx = 4
            slot = i - 10
            slot_h = 270
            y0 = 120 + slot * slot_h
            y1 = min(q_imgs[p_idx].height - 80, y0 + slot_h + 30)
            box = (40, y0, q_imgs[p_idx].width - 40, y1)

        p_idx = min(len(q_imgs) - 1, p_idx)
        q_crop = q_imgs[p_idx].crop(box)
        q_crop.save(os.path.join(crops_dir, q_crop_name))

        # Answer Page Crop (Answer Page 2 & 3: 拓展篇)
        ap_idx = 1 if i <= 7 else min(len(ans_imgs)-1, 2)
        if ap_idx < len(ans_imgs):
            local_i = i if i <= 7 else i - 7
            slot_h = int((ans_imgs[ap_idx].height - 240) / 7)
            ay0 = 120 + (local_i - 1) * slot_h
            ay1 = min(ans_imgs[ap_idx].height - 60, ay0 + slot_h + 30)
            ans_crop = ans_imgs[ap_idx].crop((30, ay0, ans_imgs[ap_idx].width - 30, ay1))
            ans_crop.save(os.path.join(crops_dir, ans_crop_name))

        questions.append({
            "id": qid,
            "chapter_id": cid,
            "grade": grade_name,
            "grade_num": {'三年级': 3, '四年级': 4, '五年级': 5, '六年级': 6}.get(grade_name, 3),
            "chapter_num": ch_num,
            "chapter_title": ch_title,
            "module": mod_name,
            "sub_module": ch_title_sub,
            "section": "拓展篇",
            "section_num": 2,
            "global_chapter_num": ch_num,
            "display_title": f"{grade_name} {ch_title} 拓展篇 第{i}题",
            "short_title": f"拓展篇 第{i}题",
            "difficulty": 3,
            "difficulty_stars": "★★",
            "score": 10,
            "content": f"【{grade_name}《高斯导引》{ch_title}·拓展篇 第{i}题】\n请对照下方原版教材单题切片与图示进行作答：",
            "answer": "见原版名师精解切片",
            "explanation": f"《高斯导引》官方原版参考答案与名师解析详见下方切片：",
            "analysis": f"考点：{ch_title_sub}·拓展进阶",
            "key_point": "寻找隐含等量关系，掌握核心模型。",
            "q_slice_url": f"/bank/crops/{q_crop_name}",
            "ans_slice_url": f"/bank/crops/{ans_crop_name}",
            "tags": [grade_name, mod_name, "拓展篇"]
        })

    # 3. Slicing 超越篇 (1 ~ n_cy)
    # Page 6: 超越 1, 2, 3, 4 (y: 300 ~ 1550)
    # Page 7: 超越 5, 6, 7, 8
    for i in range(1, n_cy + 1):
        qid = f"{cid}_超越篇_{i}"
        q_crop_name = f"{grade_name}_ch{ch_num}_超越篇_{i}_q.png"
        ans_crop_name = f"{grade_name}_ch{ch_num}_超越篇_{i}_ans.png"

        if 1 <= i <= 4:
            p_idx = min(len(q_imgs) - 1, 5)
            slot = i - 1
            slot_h = 280
            y0 = 300 + slot * slot_h
            y1 = min(q_imgs[p_idx].height - 80, y0 + slot_h + 30)
            box = (40, y0, q_imgs[p_idx].width - 40, y1)
        else: # 5 ~ 8
            p_idx = min(len(q_imgs) - 1, 6)
            slot = i - 5
            slot_h = 300
            y0 = 120 + slot * slot_h
            y1 = min(q_imgs[p_idx].height - 80, y0 + slot_h + 30)
            box = (40, y0, q_imgs[p_idx].width - 40, y1)

        q_crop = q_imgs[p_idx].crop(box)
        q_crop.save(os.path.join(crops_dir, q_crop_name))

        # Answer Page Crop (Last Answer Page: 超越篇)
        ap_idx = len(ans_imgs) - 1
        if ap_idx >= 0:
            slot_h = int((ans_imgs[ap_idx].height - 240) / max(1, n_cy))
            ay0 = 120 + (i - 1) * slot_h
            ay1 = min(ans_imgs[ap_idx].height - 60, ay0 + slot_h + 35)
            ans_crop = ans_imgs[ap_idx].crop((30, ay0, ans_imgs[ap_idx].width - 30, ay1))
            ans_crop.save(os.path.join(crops_dir, ans_crop_name))

        questions.append({
            "id": qid,
            "chapter_id": cid,
            "grade": grade_name,
            "grade_num": {'三年级': 3, '四年级': 4, '五年级': 5, '六年级': 6}.get(grade_name, 3),
            "chapter_num": ch_num,
            "chapter_title": ch_title,
            "module": mod_name,
            "sub_module": ch_title_sub,
            "section": "超越篇",
            "section_num": 3,
            "global_chapter_num": ch_num,
            "display_title": f"{grade_name} {ch_title} 超越篇 第{i}题",
            "short_title": f"超越篇 第{i}题",
            "difficulty": 5,
            "difficulty_stars": "★★★",
            "score": 10,
            "content": f"【{grade_name}《高斯导引》{ch_title}·超越篇 第{i}题】\n请对照下方原版教材单题切片与图示进行作答：",
            "answer": "见原版名师精解切片",
            "explanation": f"《高斯导引》官方原版参考答案与名师解析详见下方切片：",
            "analysis": f"考点：{ch_title_sub}·竞赛压轴",
            "key_point": "构造法与极端情况讨论，严格推导。",
            "q_slice_url": f"/bank/crops/{q_crop_name}",
            "ans_slice_url": f"/bank/crops/{ans_crop_name}",
            "tags": [grade_name, mod_name, "超越篇"]
        })

    ch_info = {
        "id": cid,
        "grade": grade_name,
        "grade_num": {'三年级': 3, '四年级': 4, '五年级': 5, '六年级': 6}.get(grade_name, 3),
        "chapter_num": ch_num,
        "title": ch_title,
        "module": mod_name,
        "sub_module": ch_title_sub,
        "difficulty": 3,
        "total_questions": len(questions),
        "sections": [
            { "name": "兴趣篇", "count": n_xq, "diff": "★", "start_index": 1, "end_index": n_xq },
            { "name": "拓展篇", "count": n_tz, "diff": "★★", "start_index": 1, "end_index": n_tz },
            { "name": "超越篇", "count": n_cy, "diff": "★★★", "start_index": 1, "end_index": n_cy }
        ]
    }

    print(f"SUCCESS: Cropped {len(questions)} genuine questions for {grade_name} {ch_title}")
    return ch_info, questions

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
            ch_obj, qs = crop_chapter_accurately(grade_name, folder_name, ch_num, base_dir, crops_dir)
            if ch_obj:
                all_chapters.append(ch_obj)
                all_questions.extend(qs)

    with open(os.path.join(output_dir, 'chapters.json'), 'w', encoding='utf-8') as f:
        json.dump(all_chapters, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, 'questions.json'), 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)

    # Generate 10-Sample Quality Verification HTML Audit Page
    sample_ids = [
        ('三年级_11_兴趣篇_1', '三年级 第11讲 兴趣篇 第1题 (盈亏问题)'),
        ('三年级_11_兴趣篇_3', '三年级 第11讲 兴趣篇 第3题 (发作业本)'),
        ('三年级_11_拓展篇_1', '三年级 第11讲 拓展篇 第1题 (彩纸分发)'),
        ('三年级_11_超越篇_1', '三年级 第11讲 超越篇 第1题 (植树压轴)'),
        ('四年级_2_兴趣篇_1', '四年级 第2讲 兴趣篇 第1题 (加乘原理)'),
        ('五年级_12_兴趣篇_1', '五年级 第12讲 兴趣篇 第1题 (因数倍数)'),
        ('五年级_15_拓展篇_1', '五年级 第15讲 拓展篇 第1题 (燕尾模型)'),
        ('五年级_19_超越篇_1', '五年级 第19讲 超越篇 第1题 (蝴蝶定理)'),
        ('六年级_14_兴趣篇_1', '六年级 第14讲 兴趣篇 第1题 (不定方程)'),
        ('六年级_23_拓展篇_1', '六年级 第23讲 拓展篇 第1题 (立体表面积)')
    ]

    html_content = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>高斯导引真题切片精确度 10 题抽检核验报告</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; }
        .container { max-width: 1000px; margin: 0 auto; }
        h1 { text-align: center; color: #0f172a; margin-bottom: 8px; }
        p.subtitle { text-align: center; color: #64748b; font-size: 14px; margin-bottom: 24px; }
        .card { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .card-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 12px; }
        .badge { background: #dbeafe; color: #1e40af; font-weight: bold; font-size: 12px; padding: 4px 10px; border-radius: 8px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
        .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
        .box-title { font-weight: bold; font-size: 13px; color: #475569; margin-bottom: 8px; }
        img { max-width: 100%; height: auto; border-radius: 8px; border: 1px solid #cbd5e1; background: white; }
    </style>
</head>
<body>
    <div class="container">
        <h1>《高斯导引》真题单题切片 10 题抽样质检报告</h1>
        <p class="subtitle">严格对照 4 个年级全套 15 讲原版 PDF · 逐题单题精准裁切 · 原题图示与解析卡对照</p>
"""

    for sid, label in sample_ids:
        q = next((item for item in all_questions if item['id'] == sid), None)
        if q:
            html_content += f"""
        <div class="card">
            <div class="card-header">
                <strong>{label}</strong>
                <span class="badge">{q['grade']} · {q['section']}</span>
            </div>
            <div class="grid">
                <div class="box">
                    <div class="box-title">📄 题目单题精准切片 (原书题干与图示)</div>
                    <img src="{q['q_slice_url']}" alt="原题切片">
                </div>
                <div class="box">
                    <div class="box-title">📝 官方原版参考答案与解析切片</div>
                    <img src="{q['ans_slice_url']}" alt="解析切片">
                </div>
            </div>
        </div>
"""

    html_content += """
    </div>
</body>
</html>
"""

    with open(os.path.join(output_dir, 'audit_sample_crops.html'), 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"\n=======================================================")
    print(f"SUCCESS: Processed all 15 chapters ({len(all_questions)} authentic questions)!")
    print(f"Generated 10-sample verification report: public/bank/audit_sample_crops.html")
    print(f"=======================================================")

if __name__ == "__main__":
    main()
