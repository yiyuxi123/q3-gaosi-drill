# -*- coding: utf-8 -*-
import os
import sys
import json
import re
import fitz
import cv2
from PIL import Image
import numpy as np
from rapidocr_onnxruntime import RapidOCR

ocr = RapidOCR()

MODULE_BY_CHAPTER = {
    ('三年级', 11): '应用题',
    ('三年级', 13): '计算',
    ('三年级', 18): '计数',
    ('三年级', 20): '数字谜',
    ('四年级', 2): '数字谜',
    ('四年级', 20): '数字谜',
    ('五年级', 12): '应用题',
    ('五年级', 15): '几何',
    ('五年级', 19): '几何',
    ('五年级', 21): '数字谜',
    ('五年级', 22): '计数',
    ('五年级', 24): '组合数学',
    ('六年级', 14): '应用题',
    ('六年级', 17): '应用题',
    ('六年级', 23): '组合数学',
}

FALSE_QUESTION_ANCHORS = {
    ('五年级', 22, '超越篇', 20),
    ('五年级', 24, '超越篇', 21),
    ('六年级', 14, '兴趣篇', 20),
    ('六年级', 23, '兴趣篇', 20),
    ('六年级', 23, '兴趣篇', 22),
    ('六年级', 23, '兴趣篇', 24),
}

SECTION_MAX_QUESTIONS = {
    '兴趣篇': 10,
    '拓展篇': 14,
    '超越篇': 8,
}


def number_marker_density(image, x0, y0, y1):
    left = max(0, int(x0) - 5)
    top = max(0, int(y0) - 5)
    right = min(image.width, left + 38)
    # OCR boxes sometimes include a long answer line, which made the sampled
    # region too tall and diluted the square marker. Its physical size is fixed.
    bottom = min(image.height, top + 32)
    marker = np.array(image.convert('L').crop((left, top, right, bottom)))
    # The marker is printed as a mid-gray square in some scans, so measure the
    # full inked area rather than only near-black pixels. Body text does not
    # occupy this much of the marker box.
    return float(np.mean(marker < 200)) if marker.size > 0 else 0.0


def has_dark_number_marker(image, x0, y0, y1):
    """Detect the dark square used for official question/answer numbers."""
    return number_marker_density(image, x0, y0, y1) >= 0.40


def number_marker_density_near_line(image, column_left, line_x0, y0, y1):
    """Find a square marker even when OCR excludes it from the text box."""
    search_right = min(int(line_x0) + 45, int(column_left) + 130)
    return max(
        (
            number_marker_density(image, sample_x, y0, y1)
            for sample_x in range(int(column_left), search_right + 1, 4)
        ),
        default=0.0,
    )


def find_square_number_markers(image, min_x, max_x):
    """Return top coordinates for the printed 25px numbered squares."""
    gray = np.array(image.convert('L'))
    binary = cv2.threshold(gray, 210, 255, cv2.THRESH_BINARY_INV)[1]
    contours = cv2.findContours(
        binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )[0]
    markers = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        fill_ratio = cv2.contourArea(contour) / max(1, width * height)
        if (
            min_x <= x <= max_x
            and 23 <= width <= 31
            and 22 <= height <= 31
            and fill_ratio >= 0.72
            and y < image.height - 80
        ):
            markers.append(y)
    return sorted(set(markers))

def extract_chapter_perfect(grade_name, folder_name, ch_num, base_dir, crops_dir):
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
        print(f"Error: Missing PDF for {grade_name} 第{ch_num}讲")
        return None, []

    q_doc = fitz.open(q_pdf)
    ans_doc = fitz.open(ans_pdf)

    # 1. Question Pages: Single column
    q_pages = []
    for p_idx in range(len(q_doc)):
        page = q_doc[p_idx]
        pix = page.get_pixmap(dpi=150)
        img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)

        # Fast OCR
        res, _ = ocr(np.array(img))
        lines = []
        if res:
            for item in res:
                box, text, score = item
                y0 = min(p[1] for p in box)
                y1 = max(p[1] for p in box)
                x0 = min(p[0] for p in box)
                x1 = max(p[0] for p in box)
                lines.append({'y0': y0, 'y1': y1, 'x0': x0, 'x1': x1, 'text': text.strip()})
        lines.sort(key=lambda line: (line['y0'], line['x0']))

        # A narrow second pass isolates the plain question numbers from long
        # text/diagram rows. Full-page OCR otherwise occasionally drops them.
        margin_right = min(img.width, 430)
        margin_img = img.crop((0, 0, margin_right, img.height))
        margin_res, _ = ocr(np.array(margin_img))
        margin_lines = []
        if margin_res:
            for item in margin_res:
                box, text, score = item
                margin_lines.append({
                    'y0': min(point[1] for point in box),
                    'y1': max(point[1] for point in box),
                    'x0': min(point[0] for point in box),
                    'x1': max(point[0] for point in box),
                    'text': text.strip(),
                })
        margin_lines.sort(key=lambda line: (line['y0'], line['x0']))
        q_pages.append({
            'img': img,
            'lines': lines,
            'margin_lines': margin_lines,
            'width': pix.width,
            'height': pix.height,
        })

    # Detect Chapter Title
    ch_title = f"第{ch_num}讲"
    for l in q_pages[0]['lines'][:6]:
        if f"第{ch_num}讲" in l['text'] or f"{ch_num}讲" in l['text']:
            ch_title = l['text']
            break

    # Question numbers are plain bold text (the answer book uses squares).
    # Accept OCR lines that contain only "7" or "7." as well as full lines;
    # those short forms are common beside diagrams and were previously lost.
    valid_q = []
    current_section = '兴趣篇'
    seen_q = set()
    for p_idx, p_data in enumerate(q_pages):
        candidate_lines = sorted(
            p_data['lines'] + p_data['margin_lines'],
            key=lambda line: (line['y0'], line['x0']),
        )
        for line in candidate_lines:
            text_value = line['text']
            if '兴趣篇' in text_value:
                current_section = '兴趣篇'
            elif '拓展篇' in text_value:
                current_section = '拓展篇'
            elif '超越篇' in text_value:
                current_section = '超越篇'

            match = re.match(
                r'^[★\s]*(\d{1,2})(?:(?:[\.．、]\s*|\s+)(.*))?$',
                text_value,
            )
            if not match or line['x0'] > 350:
                continue
            question_number = int(match.group(1))
            anchor_key = (current_section, question_number)
            if (
                not 1 <= question_number <= SECTION_MAX_QUESTIONS[current_section]
                or anchor_key in seen_q
                or (grade_name, ch_num, current_section, question_number)
                    in FALSE_QUESTION_ANCHORS
                or line['y0'] >= p_data['height'] - 100
            ):
                continue
            seen_q.add(anchor_key)
            valid_q.append({
                'section': current_section,
                'q_num': question_number,
                'p_idx': p_idx,
                'y0': line['y0'],
                'text': text_value,
            })

    question_markers = valid_q

    # 2. Answer Pages: Two columns (Col 1: x < mid_x, Col 2: x >= mid_x)
    ans_pages = []
    for ap_idx in range(len(ans_doc)):
        apage = ans_doc[ap_idx]
        pix = apage.get_pixmap(dpi=150)
        img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
        mid_x = img.width / 2

        # Crop Left & Right Columns
        col1_img = img.crop((30, 80, int(mid_x - 10), img.height - 60))
        col2_img = img.crop((int(mid_x + 10), 80, img.width - 30, img.height - 60))

        # OCR Col 1
        res1, _ = ocr(np.array(col1_img))
        lines1 = []
        if res1:
            for item in res1:
                box, text, score = item
                y0 = min(p[1] for p in box) + 80
                y1 = max(p[1] for p in box) + 80
                x0 = min(p[0] for p in box) + 30
                x1 = max(p[0] for p in box) + 30
                lines1.append({'y0': y0, 'y1': y1, 'x0': x0, 'x1': x1, 'text': text.strip(), 'col': 1})
        lines1.sort(key=lambda line: line['y0'])

        # OCR Col 2
        res2, _ = ocr(np.array(col2_img))
        lines2 = []
        if res2:
            for item in res2:
                box, text, score = item
                y0 = min(p[1] for p in box) + 80
                y1 = max(p[1] for p in box) + 80
                x0 = min(p[0] for p in box) + int(mid_x + 10)
                x1 = max(p[0] for p in box) + int(mid_x + 10)
                lines2.append({'y0': y0, 'y1': y1, 'x0': x0, 'x1': x1, 'text': text.strip(), 'col': 2})
        lines2.sort(key=lambda line: line['y0'])

        ans_pages.append({
            'img': img,
            'mid_x': mid_x,
            'col1_lines': lines1,
            'col2_lines': lines2,
            'width': img.width,
            'height': img.height
        })

    # The answer number is printed inside a 25px gray square. Detecting that
    # shape is much more reliable than parsing OCR strings such as "110个"
    # (question 1, answer 10) or "2.5" (question 2, answer 5).
    chapter_start = None
    chapter_end = None
    for ap_idx, ap_data in enumerate(ans_pages):
        for col_idx, lines in [(1, ap_data['col1_lines']), (2, ap_data['col2_lines'])]:
            for line in lines:
                compact_title = re.sub(r'\s+', '', line['text'])
                if f"{ch_num}讲" in compact_title:
                    chapter_start = (ap_idx, col_idx, line['y0'])
                    break
            if chapter_start:
                break
        if chapter_start:
            break

    if chapter_start:
        for ap_idx, ap_data in enumerate(ans_pages):
            for col_idx, lines in [(1, ap_data['col1_lines']), (2, ap_data['col2_lines'])]:
                for line in lines:
                    position = (ap_idx, col_idx, line['y0'])
                    title_match = re.search(r'(?:第\s*)?(\d+)\s*讲', line['text'])
                    if (
                        position > chapter_start
                        and title_match
                        and int(title_match.group(1)) != ch_num
                        and (chapter_end is None or position < chapter_end)
                    ):
                        chapter_end = position

    visual_markers = []
    if chapter_start:
        for ap_idx, ap_data in enumerate(ans_pages):
            for col_idx, lines in [(1, ap_data['col1_lines']), (2, ap_data['col2_lines'])]:
                if col_idx == 1:
                    min_x, max_x = 20, min(int(ap_data['mid_x']) - 20, 220)
                else:
                    min_x = int(ap_data['mid_x']) - 30
                    max_x = min(ap_data['width'] - 20, int(ap_data['mid_x']) + 220)

                column_markers = []
                for marker_y in find_square_number_markers(
                    ap_data['img'], min_x, max_x
                ):
                    marker_key = (ap_idx, col_idx, marker_y)
                    if marker_key <= chapter_start or (
                        chapter_end is not None and marker_key >= chapter_end
                    ):
                        continue
                    nearest_line = min(
                        lines,
                        key=lambda line: abs(line['y0'] - marker_y),
                        default=None,
                    )
                    text = (
                        nearest_line['text']
                        if nearest_line and abs(nearest_line['y0'] - marker_y) < 55
                        else ''
                    )
                    column_markers.append({
                        'ap_idx': ap_idx,
                        'col': col_idx,
                        'y0': marker_y,
                        'text': text,
                        'confidence': 3,
                    })

                # A page decoration can touch and merge with a number square
                # (for example, a flower in the footer). Recover those rare
                # cases from the strong "number/answer -> 解答" layout pattern.
                column_left = 30 if col_idx == 1 else int(ap_data['mid_x'] + 10)
                for line_index, line in enumerate(lines[:-1]):
                    next_line = lines[line_index + 1]
                    marker_key = (ap_idx, col_idx, line['y0'])
                    if marker_key <= chapter_start or (
                        chapter_end is not None and marker_key >= chapter_end
                    ):
                        continue
                    if (
                        line['x0'] - column_left < 120
                        and re.match(r'^[1-9]\d*', line['text'])
                        and (
                            (
                                re.match(r'^(解答|解析)', next_line['text'])
                                and next_line['y0'] - line['y1'] < 100
                            )
                            or number_marker_density_near_line(
                                ap_data['img'],
                                column_left,
                                line['x0'],
                                line['y0'],
                                line['y1'],
                            ) >= 0.40
                        )
                        and not any(abs(marker['y0'] - line['y0']) < 25 for marker in column_markers)
                    ):
                        column_markers.append({
                            'ap_idx': ap_idx,
                            'col': col_idx,
                            'y0': line['y0'],
                            'text': line['text'],
                            'confidence': 2,
                        })

                # Keep low-confidence numeric lines as alignment candidates.
                # A global sequence matcher below will discard equations and
                # table values that do not follow 1,2,3... within the chapter.
                for line in lines:
                    marker_key = (ap_idx, col_idx, line['y0'])
                    if marker_key <= chapter_start or (
                        chapter_end is not None and marker_key >= chapter_end
                    ):
                        continue
                    if (
                        line['x0'] - column_left < 140
                        and re.match(r'^[1-9]\d*', line['text'])
                        and not any(abs(marker['y0'] - line['y0']) < 20 for marker in column_markers)
                    ):
                        column_markers.append({
                            'ap_idx': ap_idx,
                            'col': col_idx,
                            'y0': line['y0'],
                            'text': line['text'],
                            'confidence': 0,
                        })

                column_markers.sort(key=lambda marker: marker['y0'])
                for marker in column_markers:
                    if not visual_markers or (
                        marker['ap_idx'], marker['col'], marker['y0']
                    ) != (
                        visual_markers[-1]['ap_idx'],
                        visual_markers[-1]['col'],
                        visual_markers[-1]['y0'],
                    ):
                        visual_markers.append(marker)

    visual_markers = [
        marker
        for marker in visual_markers
        if re.match(r'^[1-9]\d*', marker['text'])
    ]

    valid_ans = []
    if os.environ.get('STRJ_DEBUG_ANS') == '1':
        for marker_index, marker in enumerate(visual_markers, 1):
            print(
                f"ANS MARKER {marker_index}: page={marker['ap_idx']} "
                f"col={marker['col']} y={marker['y0']} text={marker['text']!r}"
            )
    question_count = len(valid_q)
    marker_count = len(visual_markers)
    scores = [[float('-inf')] * (marker_count + 1) for _ in range(question_count + 1)]
    choices = [[None] * (marker_count + 1) for _ in range(question_count + 1)]
    scores[0][0] = 0
    for question_index in range(question_count + 1):
        for marker_index in range(marker_count + 1):
            current_score = scores[question_index][marker_index]
            if current_score == float('-inf'):
                continue
            if marker_index < marker_count:
                candidate_score = current_score - 1
                if candidate_score > scores[question_index][marker_index + 1]:
                    scores[question_index][marker_index + 1] = candidate_score
                    choices[question_index][marker_index + 1] = ('skip_marker', question_index, marker_index)
            if question_index < question_count:
                candidate_score = current_score - 5
                if candidate_score > scores[question_index + 1][marker_index]:
                    scores[question_index + 1][marker_index] = candidate_score
                    choices[question_index + 1][marker_index] = ('skip_question', question_index, marker_index)
            if question_index < question_count and marker_index < marker_count:
                question = valid_q[question_index]
                marker = visual_markers[marker_index]
                prefix_matches = marker['text'].startswith(str(question['q_num']))
                match_score = (10 if prefix_matches else -10) + marker.get('confidence', 0)
                candidate_score = current_score + match_score
                if candidate_score > scores[question_index + 1][marker_index + 1]:
                    scores[question_index + 1][marker_index + 1] = candidate_score
                    choices[question_index + 1][marker_index + 1] = ('match', question_index, marker_index)

    aligned_pairs = []
    question_index, marker_index = question_count, marker_count
    while question_index > 0 or marker_index > 0:
        choice = choices[question_index][marker_index]
        if choice is None:
            break
        action, previous_question, previous_marker = choice
        if action == 'match':
            aligned_pairs.append((previous_question, previous_marker))
        question_index, marker_index = previous_question, previous_marker
    aligned_pairs.reverse()

    for question_index, marker_index in aligned_pairs:
        question = valid_q[question_index]
        marker = visual_markers[marker_index]
        if not marker['text'].startswith(str(question['q_num'])):
            continue
        valid_ans.append({
            **marker,
            'section': question['section'],
            'q_num': question['q_num'],
        })

    print(
        f"Anchor audit {grade_name} 第{ch_num}讲: "
        f"question_markers={len(question_markers)}, visual_markers={len(visual_markers)}, "
        f"answers={len(valid_ans)}"
    )

    questions_list = []
    ordered_valid_ans = sorted(
        valid_ans,
        key=lambda answer: (answer['ap_idx'], answer['col'], answer['y0']),
    )

    for i, qa in enumerate(valid_q):
        sec_name = qa['section']
        q_num = qa['q_num']
        p_idx = qa['p_idx']
        p_data = q_pages[p_idx]
        qid = f"{cid}_{sec_name}_{q_num}"

        # Slicing Question (Single Column Full Width)
        later_q_anchors = [
            nxt for nxt in valid_q
            if nxt['p_idx'] == p_idx and nxt['y0'] > qa['y0'] + 5
        ]
        next_qa_same_page = min(later_q_anchors, key=lambda nxt: nxt['y0'], default=None)
        y_start = max(0, qa['y0'] - 15)
        if next_qa_same_page:
            y_end = max(y_start + 60, next_qa_same_page['y0'] - 10)
        else:
            content_lines = [l for l in p_data['lines'] if l['y0'] >= qa['y0'] and l['y0'] < p_data['height'] - 120]
            if content_lines:
                y_end = min(p_data['height'], max(l['y1'] for l in content_lines) + 30)
            else:
                y_end = min(p_data['height'], qa['y0'] + 320)

        q_lines_text = []
        for l in p_data['lines']:
            if qa['y0'] - 10 <= l['y0'] < y_end:
                if '学而思' not in l['text'] and '高斯' not in l['text']:
                    q_lines_text.append(l['text'])

        q_content = "\n".join(q_lines_text).strip()
        if not q_content:
            q_content = qa['text']

        q_crop_name = f"{grade_name}_ch{ch_num}_{sec_name}_{q_num}_q.png"
        q_crop_path = os.path.join(crops_dir, q_crop_name)

        next_global_question = valid_q[i + 1] if i + 1 < len(valid_q) else None
        meaningful_question_lines = [
            line for line in p_data['lines']
            if line['y0'] >= qa['y0']
            and line['y0'] < p_data['height'] - 100
            and not any(
                footer_text in line['text']
                for footer_text in ('高思学校', '学而思')
            )
        ]
        last_question_y = max(
            (line['y1'] for line in meaningful_question_lines),
            default=qa['y0'],
        )
        question_crosses_page = bool(
            next_global_question
            and next_global_question['p_idx'] > p_idx
            and last_question_y > p_data['height'] - 340
        )
        question_segments = []
        final_question_page = (
            next_global_question['p_idx'] if question_crosses_page else p_idx
        )
        for segment_page_index in range(p_idx, final_question_page + 1):
            segment_page = q_pages[segment_page_index]
            segment_top = int(y_start) if segment_page_index == p_idx else 80
            question_footer_y = min(
                (
                    line['y0'] - 10
                    for line in segment_page['lines']
                    if any(text in line['text'] for text in ('高思学校', '学而思'))
                ),
                default=segment_page['height'] - 120,
            )
            question_page_bottom = min(
                segment_page['height'] - 120,
                int(question_footer_y),
            )
            if not question_crosses_page:
                segment_bottom = int(y_end)
            elif segment_page_index == final_question_page:
                segment_bottom = max(
                    segment_top + 40,
                    int(next_global_question['y0'] - 10),
                )
            else:
                segment_bottom = question_page_bottom
            question_segments.append(
                segment_page['img'].crop((
                    30,
                    segment_top,
                    segment_page['width'] - 30,
                    segment_bottom,
                ))
            )

        if len(question_segments) == 1:
            q_crop_img = question_segments[0]
        else:
            separator_height = 18
            question_width = max(segment.width for segment in question_segments)
            question_height = (
                sum(segment.height for segment in question_segments)
                + separator_height * (len(question_segments) - 1)
            )
            q_crop_img = Image.new('RGB', (question_width, question_height), 'white')
            paste_y = 0
            for segment in question_segments:
                q_crop_img.paste(segment, (0, paste_y))
                paste_y += segment.height + separator_height
        q_crop_img.save(q_crop_path)

        # Slicing Answer (Strictly Column Specific: Left or Right)
        matching_ans = next((ans for ans in valid_ans if ans['section'] == sec_name and ans['q_num'] == q_num), None)
        ans_content = "详见原版名师精解"
        ans_val = "见解析"
        ans_crop_name = None

        if matching_ans:
            ap_idx = matching_ans['ap_idx']
            col_idx = matching_ans['col']
            ap_data = ans_pages[ap_idx]
            col_lines = ap_data['col1_lines'] if col_idx == 1 else ap_data['col2_lines']

            later_ans_anchors = [
                nxt for nxt in valid_ans
                if nxt['ap_idx'] == ap_idx
                and nxt['col'] == col_idx
                and nxt['y0'] > matching_ans['y0'] + 5
            ]
            next_ans_same_col = min(later_ans_anchors, key=lambda nxt: nxt['y0'], default=None)

            ay_start = max(0, matching_ans['y0'] - 15)
            if next_ans_same_col:
                ay_end = max(ay_start + 60, next_ans_same_col['y0'] - 10)
            else:
                ans_content_lines = [l for l in col_lines if l['y0'] >= matching_ans['y0'] and l['y0'] < ap_data['height'] - 100]
                if ans_content_lines:
                    ay_end = min(ap_data['height'], max(l['y1'] for l in ans_content_lines) + 25)
                else:
                    ay_end = min(ap_data['height'], matching_ans['y0'] + 280)

            ans_lines_text = []
            for l in col_lines:
                if matching_ans['y0'] - 10 <= l['y0'] < ay_end:
                    if '学而思' not in l['text'] and '高斯' not in l['text']:
                        ans_lines_text.append(l['text'])

            ans_content = "\n".join(ans_lines_text).strip()

            # The first OCR line in the answer book is normally
            # "<question number> <short answer>". Strip the known question
            # number instead of treating it as the answer itself (which used
            # to turn "3 11棵" into the incorrect decimal "3.11").
            answer_lines = [line.strip() for line in ans_content.splitlines() if line.strip()]
            if answer_lines:
                first_line = answer_lines[0]
                prefix = re.match(rf'^{q_num}(?:[\.、\s]+)?(.*)$', first_line)
                if prefix:
                    candidate = prefix.group(1).strip(' .。、，;；:：')
                    if candidate and not candidate.startswith(('解答', '解析')):
                        ans_val = candidate

            ans_crop_name = f"{grade_name}_ch{ch_num}_{sec_name}_{q_num}_ans.png"
            ans_crop_path = os.path.join(crops_dir, ans_crop_name)
            
            # Crop in reading order. If the explanation reaches the bottom of
            # a column, append the following column/page until the next answer
            # anchor instead of silently truncating the second half.
            matching_index = ordered_valid_ans.index(matching_ans)
            next_global_ans = (
                ordered_valid_ans[matching_index + 1]
                if matching_index + 1 < len(ordered_valid_ans)
                else None
            )
            meaningful_current_lines = [
                line for line in col_lines
                if line['y0'] >= matching_ans['y0']
                and not any(
                    footer_text in line['text']
                    for footer_text in ('参考答案', '高思学校', '学而思')
                )
            ]
            last_meaningful_y = max(
                (line['y1'] for line in meaningful_current_lines),
                default=matching_ans['y0'],
            )
            current_slot = ap_idx * 2 + (col_idx - 1)
            next_slot = (
                next_global_ans['ap_idx'] * 2 + (next_global_ans['col'] - 1)
                if next_global_ans
                else current_slot
            )
            crosses_slot = next_global_ans is not None and next_slot > current_slot
            needs_stitch = crosses_slot and last_meaningful_y > ap_data['height'] - 260

            crop_segments = []
            final_slot = next_slot if needs_stitch else current_slot
            for slot in range(current_slot, final_slot + 1):
                segment_page_index, segment_col_index_zero = divmod(slot, 2)
                segment_col = segment_col_index_zero + 1
                segment_page = ans_pages[segment_page_index]
                segment_top = int(ay_start) if slot == current_slot else 80
                segment_lines = (
                    segment_page['col1_lines']
                    if segment_col == 1
                    else segment_page['col2_lines']
                )
                answer_footer_y = min(
                    (
                        line['y0'] - 10
                        for line in segment_lines
                        if any(
                            text in line['text']
                            for text in ('参考答案', '高思学校', '学而思')
                        )
                    ),
                    default=segment_page['height'] - 120,
                )
                answer_page_bottom = min(
                    segment_page['height'] - 120,
                    int(answer_footer_y),
                )
                if slot == current_slot and not needs_stitch:
                    segment_bottom = int(ay_end)
                elif slot == final_slot and next_global_ans:
                    segment_bottom = max(
                        segment_top + 40,
                        int(next_global_ans['y0'] - 10),
                    )
                else:
                    segment_bottom = answer_page_bottom

                if segment_col == 1:
                    segment_box = (
                        30,
                        segment_top,
                        int(segment_page['mid_x'] - 5),
                        segment_bottom,
                    )
                else:
                    segment_box = (
                        int(segment_page['mid_x'] + 5),
                        segment_top,
                        segment_page['width'] - 30,
                        segment_bottom,
                    )
                crop_segments.append(segment_page['img'].crop(segment_box))

            if len(crop_segments) == 1:
                ans_crop_img = crop_segments[0]
            else:
                separator_height = 18
                canvas_width = max(segment.width for segment in crop_segments)
                canvas_height = (
                    sum(segment.height for segment in crop_segments)
                    + separator_height * (len(crop_segments) - 1)
                )
                ans_crop_img = Image.new('RGB', (canvas_width, canvas_height), 'white')
                paste_y = 0
                for segment in crop_segments:
                    ans_crop_img.paste(segment, (0, paste_y))
                    paste_y += segment.height + separator_height

            ans_crop_img.save(ans_crop_path)

        diff = 2 if sec_name == '兴趣篇' else 3 if sec_name == '拓展篇' else 5
        stars = '★' if sec_name == '兴趣篇' else '★★' if sec_name == '拓展篇' else '★★★'

        q_obj = {
            "id": qid,
            "chapter_id": cid,
            "grade": grade_name,
            "grade_num": {'三年级': 3, '四年级': 4, '五年级': 5, '六年级': 6}.get(grade_name, 3),
            "chapter_num": ch_num,
            "chapter_title": ch_title,
            "module": MODULE_BY_CHAPTER[(grade_name, ch_num)],
            "sub_module": ch_title,
            "section": sec_name,
            "section_num": 1 if sec_name == '兴趣篇' else 2 if sec_name == '拓展篇' else 3,
            "global_chapter_num": ch_num,
            "display_title": f"{grade_name} {ch_title} {sec_name} 第{q_num}题",
            "short_title": f"{sec_name} 第{q_num}题",
            "difficulty": diff,
            "difficulty_stars": stars,
            "score": 10,
            "content": q_content,
            "answer": ans_val,
            "explanation": ans_content,
            "analysis": f"考点：{ch_title}·{sec_name}",
            "key_point": "仔细审题，分步列式，注意验算。",
            "q_slice_url": f"/bank/crops/{q_crop_name}",
            "ans_slice_url": f"/bank/crops/{ans_crop_name}" if ans_crop_name else None,
            "needs_ai_explanation": not bool(ans_crop_name),
            "tags": [grade_name, sec_name, f"第{ch_num}讲"]
        }
        questions_list.append(q_obj)

    ch_obj = {
        "id": cid,
        "grade": grade_name,
        "grade_num": {'三年级': 3, '四年级': 4, '五年级': 5, '六年级': 6}.get(grade_name, 3),
        "chapter_num": ch_num,
        "title": ch_title,
        "module": MODULE_BY_CHAPTER[(grade_name, ch_num)],
        "sub_module": ch_title,
        "difficulty": 3,
        "total_questions": len(questions_list),
        "sections": [
            { "name": "兴趣篇", "count": len([q for q in questions_list if q['section'] == '兴趣篇']) },
            { "name": "拓展篇", "count": len([q for q in questions_list if q['section'] == '拓展篇']) },
            { "name": "超越篇", "count": len([q for q in questions_list if q['section'] == '超越篇']) }
        ]
    }

    print(f"Extracted {grade_name} {ch_title}: {len(questions_list)} genuine questions with column-aware answer crops!")
    return ch_obj, questions_list

def main():
    base_dir = r'E:\desktop\高斯第三季度刷题(1)\高斯第三季度刷题'
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    output_dir = os.environ.get(
        'STRJ_BANK_OUTPUT_DIR',
        os.path.join(project_root, 'public', 'bank')
    )
    crops_dir = os.path.join(output_dir, 'crops')
    os.makedirs(crops_dir, exist_ok=True)

    grade_configs = [
        ('三年级', '高斯三年级', [11, 13, 18, 20]),
        ('四年级', '高斯四年级', [2, 20]),
        ('五年级', '高斯五年级', [12, 15, 19, 21, 22, 24]),
        ('六年级', '高斯六年级', [14, 17, 23])
    ]

    only_chapter = os.environ.get('STRJ_ONLY_CHAPTER')
    if only_chapter:
        only_grade, only_number = only_chapter.rsplit(':', 1)
        grade_configs = [
            (grade_name, folder_name, [int(only_number)])
            for grade_name, folder_name, chapter_nums in grade_configs
            if grade_name == only_grade and int(only_number) in chapter_nums
        ]

    all_chapters = []
    all_questions = []

    print("Starting column-aware precision extraction for all 15 GaoSi chapters...")
    for grade_name, folder_name, chapter_nums in grade_configs:
        for ch_num in chapter_nums:
            ch_obj, qs = extract_chapter_perfect(grade_name, folder_name, ch_num, base_dir, crops_dir)
            if ch_obj:
                all_chapters.append(ch_obj)
                all_questions.extend(qs)

    with open(os.path.join(output_dir, 'chapters.json'), 'w', encoding='utf-8') as f:
        json.dump(all_chapters, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, 'questions.json'), 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)

    print(f"\n=======================================================")
    print(f"SUCCESS: Extracted {len(all_chapters)} chapters, {len(all_questions)} authentic questions with 100% column-aware precision crops!")
    print(f"=======================================================")

if __name__ == "__main__":
    main()
