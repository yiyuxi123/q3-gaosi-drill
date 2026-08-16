# -*- coding: utf-8 -*-
import os
import json
import fitz  # PyMuPDF
from PIL import Image

def main():
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

    print("Cropping individual single-problem and single-answer images...")

    for ch in chapters:
        cid = ch["id"]
        ch_questions = q_by_chapter.get(cid, [])
        if not ch_questions:
            continue

        # Find pdf files
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

        # Render all pages of Q and Ans as PIL Images
        q_page_imgs = []
        for p in q_doc:
            pix = p.get_pixmap(dpi=140)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            q_page_imgs.append(img)

        ans_page_imgs = []
        for p in ans_doc:
            pix = p.get_pixmap(dpi=140)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            ans_page_imgs.append(img)

        # Total questions in this chapter
        total_q = len(ch_questions)

        for idx, q in enumerate(ch_questions):
            qid = q["id"]

            # Calculate question slice crop
            # Estimate page and vertical fraction
            # GaoSi typically has ~3 questions per page, with margins at top and bottom
            q_page_idx = min(len(q_page_imgs) - 1, int(idx / max(1, total_q) * len(q_page_imgs)))
            src_img = q_page_imgs[q_page_idx]
            w, h = src_img.size

            # Header margin ~10%, footer margin ~8%
            header_m = int(h * 0.08)
            footer_m = int(h * 0.06)
            usable_h = h - header_m - footer_m

            # Questions on this page estimate
            qs_per_page = max(2, total_q // len(q_page_imgs))
            pos_in_page = (idx % qs_per_page) / qs_per_page
            next_pos_in_page = ((idx % qs_per_page) + 1) / qs_per_page

            top_y = header_m + int(pos_in_page * usable_h)
            bot_y = header_m + int(next_pos_in_page * usable_h)
            bot_y = min(h - footer_m, bot_y + int(usable_h * 0.08)) # generous padding

            left_x = int(w * 0.06)
            right_x = int(w * 0.94)

            # Crop Question
            cropped_q = src_img.crop((left_x, top_y, right_x, bot_y))
            q_slice_filename = f"{qid}_q.jpg"
            q_slice_path = os.path.join(slices_dir, q_slice_filename)
            cropped_q.save(q_slice_path, "JPEG", quality=88)

            # Crop Answer Slice
            ans_page_idx = min(len(ans_page_imgs) - 1, int(idx / max(1, total_q) * len(ans_page_imgs)))
            src_ans_img = ans_page_imgs[ans_page_idx]
            aw, ah = src_ans_img.size
            a_header_m = int(ah * 0.08)
            a_footer_m = int(ah * 0.06)
            a_usable_h = ah - a_header_m - a_footer_m

            ans_pos = (idx % qs_per_page) / qs_per_page
            ans_next_pos = ((idx % qs_per_page) + 1) / qs_per_page
            a_top_y = a_header_m + int(ans_pos * a_usable_h)
            a_bot_y = min(ah - a_footer_m, a_header_m + int(ans_next_pos * a_usable_h) + int(a_usable_h * 0.08))

            cropped_ans = src_ans_img.crop((int(aw * 0.06), a_top_y, int(aw * 0.94), a_bot_y))
            ans_slice_filename = f"{qid}_ans.jpg"
            ans_slice_path = os.path.join(slices_dir, ans_slice_filename)
            cropped_ans.save(ans_slice_path, "JPEG", quality=88)

            # Update question metadata
            q["q_slice_url"] = f"/bank/slices/{q_slice_filename}"
            q["ans_slice_url"] = f"/bank/slices/{ans_slice_filename}"

        print(f"Cropped {len(ch_questions)} single-problem slices for {g_name} 第{ch_num}讲")

    # Save updated questions.json
    with open(os.path.join(output_dir, 'questions.json'), 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    print("\nSUCCESS: All single-question and single-answer slices cropped and saved!")

if __name__ == "__main__":
    main()
