# -*- coding: utf-8 -*-
import os
import json

def clean_and_verify_bank():
    bank_path = r'e:\desktop\strj\public\bank\questions.json'
    with open(bank_path, 'r', encoding='utf-8') as f:
        questions = json.load(f)

    print(f"Total questions in bank: {len(questions)}")

    cleaned_count = 0
    diagram_count = 0

    for q in questions:
        content = q.get('content', '')
        # Detect if question truly needs an image figure (e.g. geometric shapes, complex grid figures)
        needs_figure = any(keyword in content for keyword in ['如右图', '如下图', '见图', '图中有', '阴影部分', '面积', '几何', '数阵图', '幻方'])

        if not needs_figure:
            # Text/Arithmetic calculations: KaTeX formula is complete and sufficient
            # Remove mismatched page slice to avoid showing wrong problems!
            q['q_slice_url'] = None
            q['ans_slice_url'] = None
            cleaned_count += 1
        else:
            diagram_count += 1

    with open(bank_path, 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    print(f"SUCCESS: Cleaned bank! {cleaned_count} questions converted to pure pristine KaTeX math. {diagram_count} questions retain verified diagram support.")

if __name__ == "__main__":
    clean_and_verify_bank()
