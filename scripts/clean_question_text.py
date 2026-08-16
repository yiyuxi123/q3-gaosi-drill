# -*- coding: utf-8 -*-
"""Remove scanner-only headers and footers from digitized question text."""

import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
QUESTIONS_PATH = PROJECT_ROOT / 'public' / 'bank' / 'questions.json'

SECTION_HEADERS = {'兴趣篇', '拓展篇', '超越篇', '参考答案'}
BOOK_FOOTER_MARKERS = ('高思学校竞赛数学导引', '高斯学校竞赛数学导引')
CHAPTER_FOOTER = re.compile(r'^第\s*\d+\s*讲\s+\S+')


def clean_scanner_lines(value):
    if not isinstance(value, str):
        return value

    kept = []
    for raw_line in value.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        line = raw_line.strip()
        if not line:
            continue
        if line in SECTION_HEADERS:
            continue
        if any(marker in line for marker in BOOK_FOOTER_MARKERS):
            continue
        if CHAPTER_FOOTER.match(line):
            continue
        kept.append(line)
    return '\n'.join(kept).strip()


def main():
    questions = json.loads(QUESTIONS_PATH.read_text(encoding='utf-8'))
    changed_questions = 0
    changed_fields = 0
    for question in questions:
        question_changed = False
        for field in ('content', 'answer', 'explanation'):
            before = question.get(field)
            after = clean_scanner_lines(before)
            if after != before:
                question[field] = after
                question_changed = True
                changed_fields += 1
        if question_changed:
            changed_questions += 1

    QUESTIONS_PATH.write_text(
        json.dumps(questions, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(f'Cleaned scanner text: questions={changed_questions} fields={changed_fields}')


if __name__ == '__main__':
    main()
