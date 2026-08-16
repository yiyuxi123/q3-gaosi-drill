# -*- coding: utf-8 -*-
"""Fill missing rebuilt answer crops from the current bank without overwriting new crops."""

import argparse
import json
import shutil
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('rebuilt_bank')
    parser.add_argument('fallback_bank')
    args = parser.parse_args()
    rebuilt = Path(args.rebuilt_bank).resolve()
    fallback = Path(args.fallback_bank).resolve()

    rebuilt_questions_path = rebuilt / 'questions.json'
    fallback_questions_path = fallback / 'questions.json'
    rebuilt_questions = json.loads(rebuilt_questions_path.read_text(encoding='utf-8'))
    fallback_questions = {
        question['id']: question
        for question in json.loads(fallback_questions_path.read_text(encoding='utf-8'))
    }

    restored = 0
    for question in rebuilt_questions:
        if question.get('ans_slice_url'):
            continue
        fallback_question = fallback_questions.get(question['id'])
        fallback_url = fallback_question.get('ans_slice_url') if fallback_question else None
        if not fallback_url:
            continue
        filename = fallback_url.replace('\\', '/').split('/')[-1]
        source = fallback / 'crops' / filename
        destination = rebuilt / 'crops' / filename
        if not source.exists():
            continue
        if not destination.exists():
            shutil.copy2(source, destination)
        question['ans_slice_url'] = f'/bank/crops/{filename}'
        if question.get('answer') in (None, '', '见解析', '详见解析'):
            question['answer'] = fallback_question.get('answer', '见解析')
        if question.get('explanation') in (None, '', '详见原版名师精解'):
            question['explanation'] = fallback_question.get(
                'explanation', '详见原版名师精解'
            )
        restored += 1

    for question in rebuilt_questions:
        needs_ai = not bool(question.get('ans_slice_url'))
        question['needs_ai_explanation'] = needs_ai
        if needs_ai:
            question['explanation'] = (
                '原版答案图缺失；展开答案后，系统会自动撰写并缓存“核心思路、'
                '分步推理、最终答案与验算、易错点”四部分 AI 补充解析。'
            )

    rebuilt_questions_path.write_text(
        json.dumps(rebuilt_questions, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(f'Restored answer fallbacks: {restored}')


if __name__ == '__main__':
    main()
