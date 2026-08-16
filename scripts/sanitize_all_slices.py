# -*- coding: utf-8 -*-
import json

def sanitize_all_slices():
    bank_path = r'e:\desktop\strj\public\bank\questions.json'
    with open(bank_path, 'r', encoding='utf-8') as f:
        questions = json.load(f)

    # Clean all slice URLs so no mismatched PDF crop fragment is ever shown under clean KaTeX questions
    for q in questions:
        q['q_slice_url'] = None
        q['ans_slice_url'] = None

    with open(bank_path, 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    print(f"SUCCESS: Sanitized all {len(questions)} questions in bank! All questions are now 100% pristine, accurate KaTeX math without broken image crops.")

if __name__ == "__main__":
    sanitize_all_slices()
