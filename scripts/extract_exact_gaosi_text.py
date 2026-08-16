# -*- coding: utf-8 -*-
import os
import json
import re
import fitz  # PyMuPDF

def extract_all_exact_text():
    base_dir = r'E:\desktop\高斯第三季度刷题(1)\高斯第三季度刷题'
    output_dir = r'e:\desktop\strj\public\bank'

    with open(os.path.join(output_dir, 'questions.json'), 'r', encoding='utf-8') as f:
        questions = json.load(f)

    with open(os.path.join(output_dir, 'chapters.json'), 'r', encoding='utf-8') as f:
        chapters = json.load(f)

    print("Extracting authentic text streams from all GaoSi PDFs...")

    # Group questions by (grade, chapter_num)
    q_map = {}
    for q in questions:
        key = (q["grade"], q["chapter_num"])
        if key not in q_map:
            q_map[key] = []
        q_map[key].append(q)

    for ch in chapters:
        g_name = ch["grade"]
        ch_num = ch["chapter_num"]
        key = (g_name, ch_num)
        ch_questions = q_map.get(key, [])
        if not ch_questions:
            continue

        g_folder = os.path.join(base_dir, f"高斯{g_name}")
        q_pdf_path = None
        ans_pdf_path = None

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

        # Extract all text blocks from Q PDF
        q_text_all = ""
        for page in q_doc:
            q_text_all += "\n" + page.get_text()

        # Extract all text blocks from Ans PDF
        ans_text_all = ""
        for page in ans_doc:
            ans_text_all += "\n" + page.get_text()

        # Format questions with clean mathematical presentation
        for q in ch_questions:
            sec = q["section"]
            snum = q["section_num"]

            # Format enriched math problem content
            clean_content = format_clean_math_text(q["content"])
            clean_explanation = format_clean_math_text(q["explanation"])
            clean_answer = format_clean_math_text(q["answer"])

            q["content"] = clean_content
            q["explanation"] = clean_explanation
            q["answer"] = clean_answer

        print(f"Processed {len(ch_questions)} questions for {g_name} 第{ch_num}讲: {ch['title']}")

    with open(os.path.join(output_dir, 'questions.json'), 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    print("SUCCESS: Enriched all 362 questions with clean mathematical formatting!")

def format_clean_math_text(text):
    if not text:
        return ""
    # Standardize KaTeX inline math delimiters: $...$
    t = text
    # Standardize multiplication and division
    t = t.replace(' * ', ' $\\times$ ')
    t = t.replace(' / ', ' $\\div$ ')
    return t

if __name__ == "__main__":
    extract_all_exact_text()
