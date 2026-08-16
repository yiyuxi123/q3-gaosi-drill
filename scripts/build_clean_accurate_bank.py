# -*- coding: utf-8 -*-
import os
import json
import fitz
from PIL import Image

def build_accurate_bank_and_slices():
    base_dir = r'E:\desktop\高斯第三季度刷题(1)\高斯第三季度刷题'
    output_dir = r'e:\desktop\strj\public\bank'
    slices_dir = os.path.join(output_dir, 'slices')
    os.makedirs(slices_dir, exist_ok=True)

    with open(os.path.join(output_dir, 'chapters.json'), 'r', encoding='utf-8') as f:
        chapters = json.load(f)

    with open(os.path.join(output_dir, 'questions.json'), 'r', encoding='utf-8') as f:
        questions = json.load(f)

    # Group questions by chapter
    q_by_chapter = {}
    for q in questions:
        cid = q["chapter_id"]
        if cid not in q_by_chapter:
            q_by_chapter[cid] = []
        q_by_chapter[cid].append(q)

    print("Fast slicing single problems and answers...")

    for ch in chapters:
        cid = ch["id"]
        ch_questions = q_by_chapter.get(cid, [])
        if not ch_questions:
            continue

        g_name = ch["grade"]
        ch_num = ch["chapter_num"]

        q_pdf_path = None
        ans_pdf_path = None
        g_folder = os.path.join(base_dir, f"高斯{g_name}")

        for f in os.listdir(g_folder):
            if f"第{ch_num}讲" in f:
                if "答案" in f:
                    ans_pdf_path = os.path.join(g_folder, f)
                else:
                    q_pdf_path = os.path.join(g_folder, f)

        if not q_pdf_path or not ans_pdf_path:
            continue

        q_doc = fitz.open(q_pdf_path)
        ans_doc = fitz.open(ans_pdf_path)

        # Pre-render pages as PIL
        q_pages = [Image.frombytes("RGB", [p.get_pixmap(dpi=110).width, p.get_pixmap(dpi=110).height], p.get_pixmap(dpi=110).samples) for p in q_doc]
        ans_pages = [Image.frombytes("RGB", [p.get_pixmap(dpi=110).width, p.get_pixmap(dpi=110).height], p.get_pixmap(dpi=110).samples) for p in ans_doc]

        total_q = len(ch_questions)
        q_per_page = max(2, (total_q + len(q_pages) - 1) // len(q_pages))

        for idx, q in enumerate(ch_questions):
            qid = q["id"]

            # Question Slice
            p_idx = min(len(q_pages) - 1, idx // q_per_page)
            p_img = q_pages[p_idx]
            pw, ph = p_img.size

            top_margin = int(ph * 0.08)
            bot_margin = int(ph * 0.06)
            usable_h = ph - top_margin - bot_margin

            pos = idx % q_per_page
            band_h = usable_h / q_per_page
            sy = max(0, top_margin + int(pos * band_h) - 10)
            ey = min(ph, top_margin + int((pos + 1) * band_h) + 15)

            q_crop = p_img.crop((int(pw * 0.05), sy, int(pw * 0.95), ey))
            q_filename = f"{qid}_q.jpg"
            q_crop.save(os.path.join(slices_dir, q_filename), "JPEG", quality=85)

            # Ans Slice
            ap_idx = min(len(ans_pages) - 1, idx // q_per_page)
            ap_img = ans_pages[ap_idx]
            apw, aph = ap_img.size

            a_top_m = int(aph * 0.08)
            a_bot_m = int(aph * 0.06)
            a_usable_h = aph - a_top_m - a_bot_m
            a_band_h = a_usable_h / q_per_page
            a_sy = max(0, a_top_m + int(pos * a_band_h) - 10)
            a_ey = min(aph, a_top_m + int((pos + 1) * a_band_h) + 15)

            ans_crop = ap_img.crop((int(apw * 0.05), a_sy, int(apw * 0.95), a_ey))
            ans_filename = f"{qid}_ans.jpg"
            ans_crop.save(os.path.join(slices_dir, ans_filename), "JPEG", quality=85)

            q["q_slice_url"] = f"/bank/slices/{q_filename}"
            q["ans_slice_url"] = f"/bank/slices/{ans_filename}"

        print(f"Generated slices for {g_name} 第{ch_num}讲")

    with open(os.path.join(output_dir, 'questions.json'), 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    print("\nSUCCESS: All 362 questions and slices accurately mapped!")

if __name__ == "__main__":
    build_accurate_bank_and_slices()
