# -*- coding: utf-8 -*-
import os
import json
import fitz  # PyMuPDF

def main():
    base_dir = r'E:\desktop\高斯第三季度刷题(1)\高斯第三季度刷题'
    output_dir = r'e:\desktop\strj\public\bank'
    pages_dir = os.path.join(output_dir, 'pages')
    os.makedirs(pages_dir, exist_ok=True)

    chapters_config = [
        # Grade 3
        {
            "id": "g3_ch11",
            "grade": "三年级",
            "grade_num": 3,
            "chapter_num": 11,
            "title": "巧填算符与数字谜",
            "module": "数字谜",
            "sub_module": "算符推理与横式竖式谜",
            "difficulty": 3,
            "q_pdf": os.path.join(base_dir, "高斯三年级", "高斯导引 三年级第11讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯三年级", "高斯导引 三年级第11讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 10, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 6, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g3_ch13",
            "grade": "三年级",
            "grade_num": 3,
            "chapter_num": 13,
            "title": "和差倍与年龄问题",
            "module": "应用题",
            "sub_module": "和倍/差倍/和差综合应用",
            "difficulty": 3,
            "q_pdf": os.path.join(base_dir, "高斯三年级", "高斯导引 三年级第13讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯三年级", "高斯导引 三年级第13讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 10, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 6, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g3_ch18",
            "grade": "三年级",
            "grade_num": 3,
            "chapter_num": 18,
            "title": "周期问题与规律探究",
            "module": "组合数学",
            "sub_module": "图形/数列/日历中的周期",
            "difficulty": 3,
            "q_pdf": os.path.join(base_dir, "高斯三年级", "高斯导引 三年级第18讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯三年级", "高斯导引 三年级第18讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 10, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 6, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g3_ch20",
            "grade": "三年级",
            "grade_num": 3,
            "chapter_num": 20,
            "title": "几何图形认知与分割拼合",
            "module": "几何",
            "sub_module": "平面图形割补与周长面积认知",
            "difficulty": 3,
            "q_pdf": os.path.join(base_dir, "高斯三年级", "高斯导引 三年级第20讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯三年级", "高斯导引 三年级第20讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 10, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 6, "diff": "★★★★★"}
            ]
        },
        # Grade 4
        {
            "id": "g4_ch02",
            "grade": "四年级",
            "grade_num": 4,
            "chapter_num": 2,
            "title": "加法原理与乘法原理",
            "module": "计数",
            "sub_module": "分类与分步计数原理",
            "difficulty": 4,
            "q_pdf": os.path.join(base_dir, "高斯四年级", "高斯导引 四年级第2讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯四年级", "高斯导引 四年级第2讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 12, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 8, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g4_ch20",
            "grade": "四年级",
            "grade_num": 4,
            "chapter_num": 20,
            "title": "容斥原理与集合包含",
            "module": "计数",
            "sub_module": "两集合与三集合容斥公式",
            "difficulty": 4,
            "q_pdf": os.path.join(base_dir, "高斯四年级", "高斯导引 四年级第20讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯四年级", "高斯导引 四年级第20讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 12, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 8, "diff": "★★★★★"}
            ]
        },
        # Grade 5
        {
            "id": "g5_ch12",
            "grade": "五年级",
            "grade_num": 5,
            "chapter_num": 12,
            "title": "质数、合数与因倍数分解",
            "module": "数论",
            "sub_module": "质因数分解与约数个数定理",
            "difficulty": 4,
            "q_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第12讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第12讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 12, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 8, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g5_ch15",
            "grade": "五年级",
            "grade_num": 5,
            "chapter_num": 15,
            "title": "行程问题与比例综合",
            "module": "应用题",
            "sub_module": "相遇追及/流水行船/比例行程",
            "difficulty": 4,
            "q_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第15讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第15讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 12, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 8, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g5_ch19",
            "grade": "五年级",
            "grade_num": 5,
            "chapter_num": 19,
            "title": "平面几何五大模型（鸟头/蝴蝶/燕尾）",
            "module": "几何",
            "sub_module": "等积变形与比例模型",
            "difficulty": 5,
            "q_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第19讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第19讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 12, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 8, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g5_ch21",
            "grade": "五年级",
            "grade_num": 5,
            "chapter_num": 21,
            "title": "同余定理与带余除法进阶",
            "module": "数论",
            "sub_module": "同余性质/中国剩余定理/完全平方数",
            "difficulty": 5,
            "q_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第21讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第21讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 10, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 6, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g5_ch22",
            "grade": "五年级",
            "grade_num": 5,
            "chapter_num": 22,
            "title": "工程问题与牛吃草模型",
            "module": "应用题",
            "sub_module": "工作效率/轮流工作/变速率牛吃草",
            "difficulty": 4,
            "q_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第22讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第22讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 10, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 6, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g5_ch24",
            "grade": "五年级",
            "grade_num": 5,
            "chapter_num": 24,
            "title": "时钟问题与追及角速度",
            "module": "应用题",
            "sub_module": "分针时针重合/垂直/快慢钟",
            "difficulty": 4,
            "q_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第24讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯五年级", "高斯导引 五年级第24讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 10, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 6, "diff": "★★★★★"}
            ]
        },
        # Grade 6
        {
            "id": "g6_ch14",
            "grade": "六年级",
            "grade_num": 6,
            "chapter_num": 14,
            "title": "递推计数与概率统计初步",
            "module": "计数",
            "sub_module": "斐波那契型递推/传球问题/古典概型",
            "difficulty": 5,
            "q_pdf": os.path.join(base_dir, "高斯六年级", "高斯导引 六年级第14讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯六年级", "高斯导引 六年级第14讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 12, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 8, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g6_ch17",
            "grade": "六年级",
            "grade_num": 6,
            "chapter_num": 17,
            "title": "数论综合与进阶（整除/余数/不定方程）",
            "module": "数论",
            "sub_module": "欧几里得辗转相除/二元一次不定方程",
            "difficulty": 5,
            "q_pdf": os.path.join(base_dir, "高斯六年级", "高斯导引 六年级第17讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯六年级", "高斯导引 六年级第17讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 12, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 8, "diff": "★★★★★"}
            ]
        },
        {
            "id": "g6_ch23",
            "grade": "六年级",
            "grade_num": 6,
            "chapter_num": 23,
            "title": "几何综合与立体图形三视图/表面积",
            "module": "几何",
            "sub_module": "圆与扇形/圆柱圆锥/立体截面",
            "difficulty": 5,
            "q_pdf": os.path.join(base_dir, "高斯六年级", "高斯导引 六年级第23讲.pdf"),
            "ans_pdf": os.path.join(base_dir, "高斯六年级", "高斯导引 六年级第23讲答案.pdf"),
            "sections": [
                {"name": "兴趣篇", "count": 6, "diff": "★☆☆☆☆"},
                {"name": "拓展篇", "count": 12, "diff": "★★★☆☆"},
                {"name": "超越篇", "count": 8, "diff": "★★★★★"}
            ]
        }
    ]

    all_questions = []
    chapters_meta = []

    print("Rendering pages and building question database...")

    for ch in chapters_config:
        ch_id = ch["id"]
        q_doc = fitz.open(ch["q_pdf"])
        ans_doc = fitz.open(ch["ans_pdf"])

        q_page_paths = []
        ans_page_paths = []

        # Render Question Pages
        for p_idx in range(len(q_doc)):
            page_name = f"{ch_id}_q_p{p_idx+1}.jpg"
            save_p = os.path.join(pages_dir, page_name)
            if not os.path.exists(save_p):
                pix = q_doc[p_idx].get_pixmap(dpi=120)
                pix.save(save_p)
            q_page_paths.append(f"/bank/pages/{page_name}")

        # Render Answer Pages
        for p_idx in range(len(ans_doc)):
            page_name = f"{ch_id}_ans_p{p_idx+1}.jpg"
            save_p = os.path.join(pages_dir, page_name)
            if not os.path.exists(save_p):
                pix = ans_doc[p_idx].get_pixmap(dpi=120)
                pix.save(save_p)
            ans_page_paths.append(f"/bank/pages/{page_name}")

        # Generate structured questions for each section
        total_ch_questions = 0
        section_infos = []
        
        q_idx_in_chapter = 1
        for sec in ch["sections"]:
            sec_name = sec["name"]
            sec_count = sec["count"]
            sec_diff_stars = sec["diff"]

            sec_info = {
                "name": sec_name,
                "count": sec_count,
                "diff": sec_diff_stars,
                "start_index": q_idx_in_chapter,
                "end_index": q_idx_in_chapter + sec_count - 1
            }
            section_infos.append(sec_info)

            # Estimate which page the question falls on
            total_q_pages = len(q_doc)
            total_questions_in_ch = sum(s["count"] for s in ch["sections"])
            total_ans_pages = len(ans_doc)

            for num in range(1, sec_count + 1):
                qid = f"{ch_id}_{sec_name[:2]}_{num}"
                
                # Approximate page mapping for questions & answers
                q_page_est = min(len(q_page_paths), max(1, int(1 + (q_idx_in_chapter - 1) / max(1, total_questions_in_ch) * total_q_pages)))
                ans_page_est = min(len(ans_page_paths), max(1, int(1 + (q_idx_in_chapter - 1) / max(1, total_questions_in_ch) * total_ans_pages)))

                diff_score = 1 if "★☆☆☆☆" in sec_diff_stars else (3 if "★★★☆☆" in sec_diff_stars else 5)

                q_item = {
                    "id": qid,
                    "chapter_id": ch_id,
                    "grade": ch["grade"],
                    "grade_num": ch["grade_num"],
                    "chapter_num": ch["chapter_num"],
                    "chapter_title": ch["title"],
                    "module": ch["module"],
                    "sub_module": ch["sub_module"],
                    "section": sec_name,
                    "section_num": num,
                    "global_chapter_num": q_idx_in_chapter,
                    "display_title": f"{ch['grade']} 第{ch['chapter_num']}讲《{ch['title']}》· {sec_name} 第{num}题",
                    "short_title": f"{sec_name} 第{num}题",
                    "difficulty": diff_score,
                    "difficulty_stars": sec_diff_stars,
                    "score": 10,
                    "q_page_url": q_page_paths[q_page_est - 1],
                    "q_page_num": q_page_est,
                    "ans_page_url": ans_page_paths[ans_page_est - 1],
                    "ans_page_num": ans_page_est,
                    "all_q_pages": q_page_paths,
                    "all_ans_pages": ans_page_paths,
                    "tags": [ch["grade"], ch["module"], ch["sub_module"], sec_name]
                }
                all_questions.append(q_item)
                q_idx_in_chapter += 1
                total_ch_questions += 1

        ch_meta = {
            "id": ch_id,
            "grade": ch["grade"],
            "grade_num": ch["grade_num"],
            "chapter_num": ch["chapter_num"],
            "title": ch["title"],
            "module": ch["module"],
            "sub_module": ch["sub_module"],
            "difficulty": ch["difficulty"],
            "total_questions": total_ch_questions,
            "sections": section_infos,
            "q_pages": q_page_paths,
            "ans_pages": ans_page_paths
        }
        chapters_meta.append(ch_meta)
        print(f"Done chapter {ch['grade']} 第{ch['chapter_num']}讲: {total_ch_questions} questions.")

    # Save to public/bank
    with open(os.path.join(output_dir, 'questions.json'), 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, 'chapters.json'), 'w', encoding='utf-8') as f:
        json.dump(chapters_meta, f, ensure_ascii=False, indent=2)

    # Module summary
    module_stats = {}
    for q in all_questions:
        m = q["module"]
        module_stats[m] = module_stats.get(m, 0) + 1

    meta_summary = {
        "exam_title": "2026年第三季度悦学业务部季度考（高斯导引专项）",
        "target_exam_date": "2026-09-18",
        "total_grades": 4,
        "total_chapters": len(chapters_meta),
        "total_questions": len(all_questions),
        "modules": module_stats
    }

    with open(os.path.join(output_dir, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump(meta_summary, f, ensure_ascii=False, indent=2)

    print(f"\nSUCCESS! Total questions: {len(all_questions)} in {len(chapters_meta)} chapters.")
    print("Module stats:", json.dumps(module_stats, ensure_ascii=False))

if __name__ == "__main__":
    main()
