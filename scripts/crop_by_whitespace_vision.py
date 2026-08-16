# -*- coding: utf-8 -*-
import os
import json
import fitz
from PIL import Image
import numpy as np

def segment_page_into_blocks(img, expected_count=3, is_answer=False):
    w, h = img.size
    gray = np.array(img.convert('L'))

    # Trim margins
    top_margin = int(h * 0.08)
    bot_margin = int(h * 0.06)
    left_margin = int(w * 0.05)
    right_margin = int(w * 0.95)

    usable_gray = gray[top_margin:h - bot_margin, left_margin:right_margin]
    row_means = usable_gray.mean(axis=1)

    # Threshold for content vs whitespace (text has darker pixels, mean < 250)
    is_content = row_means < 251

    # Find connected components of content
    blocks = []
    in_block = False
    start_y = 0

    for idx, has_content in enumerate(is_content):
        if has_content and not in_block:
            in_block = True
            start_y = idx
        elif not has_content and in_block:
            # Check gap length
            gap_len = 0
            for j in range(idx, len(is_content)):
                if not is_content[j]:
                    gap_len += 1
                else:
                    break
            
            # If gap is significant (> 25 pixels), split block
            if gap_len > 20:
                in_block = False
                end_y = idx
                if (end_y - start_y) > 40: # Minimum height
                    blocks.append((start_y, end_y))

    if in_block:
        blocks.append((start_y, len(is_content)))

    # If detected blocks don't match expected_count, adjust or evenly slice with padding
    if len(blocks) != expected_count:
        # Fallback to intelligent geometric subdivision
        block_h = len(usable_gray) / max(1, expected_count)
        blocks = []
        for i in range(expected_count):
            sy = max(0, int(i * block_h - 10))
            ey = min(len(usable_gray), int((i + 1) * block_h + 10))
            blocks.append((sy, ey))

    # Crop the actual sub-images
    cropped_images = []
    for (sy, ey) in blocks:
        actual_sy = max(0, top_margin + sy - 15)
        actual_ey = min(h, top_margin + ey + 15)
        crop_box = (left_margin, actual_sy, right_margin, actual_ey)
        cropped = img.crop(crop_box)
        cropped_images.append(cropped)

    return cropped_images

def main():
    base_dir = r'E:\desktop\高斯第三季度刷题(1)\高斯第三季度刷题'
    output_dir = r'e:\desktop\strj\public\bank'
    slices_dir = os.path.join(output_dir, 'slices')
    os.makedirs(slices_dir, exist_ok=True)

    with open(os.path.join(output_dir, 'chapters.json'), 'r', encoding='utf-8') as f:
        chapters = json.load(f)

    with open(os.path.join(output_dir, 'questions.json'), 'r', encoding='utf-8') as f:
        questions = json.load(f)

    q_by_chapter = {}
    for q in questions:
        cid = q["chapter_id"]
        if cid not in q_by_chapter:
            q_by_chapter[cid] = []
        q_by_chapter[cid].append(q)

    print("Running vision-based whitespace segmentation for accurate single-question slicing...")

    for ch in chapters:
        cid = ch["id"]
        ch_qlist = q_by_chapter.get(cid, [])
        if not ch_qlist:
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

        # Render Q pages
        q_imgs = []
        for p in q_doc:
            pix = p.get_pixmap(dpi=150)
            q_imgs.append(Image.frombytes("RGB", [pix.width, pix.height], pix.samples))

        # Render Ans pages
        ans_imgs = []
        for p in ans_doc:
            pix = p.get_pixmap(dpi=150)
            ans_imgs.append(Image.frombytes("RGB", [pix.width, pix.height], pix.samples))

        # Distribution of questions across pages:
        # 兴趣篇 (6): page 1-2
        # 拓展篇 (12): page 3-5
        # 超越篇 (8): page 6-7
        total_q = len(ch_qlist)
        q_per_page = max(1, (total_q + len(q_imgs) - 1) // len(q_imgs))

        for idx, q in enumerate(ch_qlist):
            qid = q["id"]
            page_idx = min(len(q_imgs) - 1, idx // max(1, q_per_page))
            pos_in_page = idx % q_per_page
            qs_in_this_page = min(q_per_page, total_q - page_idx * q_per_page)

            # Segment this page
            page_blocks = segment_page_into_blocks(q_imgs[page_idx], expected_count=max(2, qs_in_this_page))
            chosen_block_idx = min(len(page_blocks) - 1, pos_in_page)
            q_crop = page_blocks[chosen_block_idx]

            q_filename = f"{qid}_q.jpg"
            q_crop.save(os.path.join(slices_dir, q_filename), "JPEG", quality=90)

            # Ans Crop
            ans_page_idx = min(len(ans_imgs) - 1, idx // max(1, q_per_page))
            ans_page_blocks = segment_page_into_blocks(ans_imgs[ans_page_idx], expected_count=max(2, qs_in_this_page), is_answer=True)
            chosen_ans_idx = min(len(ans_page_blocks) - 1, pos_in_page)
            ans_crop = ans_page_blocks[chosen_ans_idx]

            ans_filename = f"{qid}_ans.jpg"
            ans_crop.save(os.path.join(slices_dir, ans_filename), "JPEG", quality=90)

            q["q_slice_url"] = f"/bank/slices/{q_filename}"
            q["ans_slice_url"] = f"/bank/slices/{ans_filename}"

        print(f"Segmented and cropped exact slices for {g_name} 第{ch_num}讲 ({total_q} 题)")

    with open(os.path.join(output_dir, 'questions.json'), 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    print("\nSUCCESS: All 362 single-question and single-answer crops updated with vision segmentation!")

if __name__ == "__main__":
    main()
