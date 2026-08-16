import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Chapter, Question } from '../src/types';
import { filterDrillQuestions } from '../src/services/practiceSession';

const root = process.cwd();
const questions = JSON.parse(fs.readFileSync(path.join(root, 'public/bank/questions.json'), 'utf8')) as Question[];
const chapters = JSON.parse(fs.readFileSync(path.join(root, 'public/bank/chapters.json'), 'utf8')) as Chapter[];

function publicAssetExists(url?: string): boolean {
  if (!url) return false;
  return fs.existsSync(path.join(root, 'public', decodeURIComponent(url).replace(/^\//, '')));
}

function pngWidth(url?: string): number | undefined {
  if (!url) return undefined;
  const file = fs.readFileSync(path.join(root, 'public', decodeURIComponent(url).replace(/^\//, '')));
  const pngSignature = '89504e470d0a1a0a';
  if (file.subarray(0, 8).toString('hex') !== pngSignature) return undefined;
  return file.readUInt32BE(16);
}

describe('question bank integrity', () => {
  it('contains only supported math modules and no duplicate ids', () => {
    const supported = new Set(['计算', '计数', '数论', '几何', '应用题', '数字谜', '组合数学']);
    expect(new Set(questions.map(question => question.id)).size).toBe(questions.length);
    expect(questions.every(question => supported.has(question.module))).toBe(true);
  });

  it('links every question slice and explicitly marks answer slices handled by AI', () => {
    const missingQuestions = questions.filter(question => !publicAssetExists(question.q_slice_url));
    const invalidAnswers = questions.filter(question =>
      !publicAssetExists(question.ans_slice_url) && !question.needs_ai_explanation
    );
    const undocumentedAiFallbacks = questions.filter(question =>
      question.needs_ai_explanation && question.explanation.length < 20
    );
    expect(missingQuestions.map(question => question.id)).toEqual([]);
    expect(invalidAnswers.map(question => question.id)).toEqual([]);
    expect(undocumentedAiFallbacks.map(question => question.id)).toEqual([]);
  });

  it('never exposes a full-width multi-column fallback as one answer', () => {
    const suspicious = questions.filter(question => {
      const width = pngWidth(question.ans_slice_url);
      return width !== undefined && width > 700;
    });
    expect(suspicious.map(question => question.id)).toEqual([]);
  });

  it('keeps chapter and section counts synchronized with questions', () => {
    for (const chapter of chapters) {
      const chapterQuestions = questions.filter(question => question.chapter_id === chapter.id);
      expect(chapter.total_questions).toBe(chapterQuestions.length);
      for (const section of chapter.sections) {
        expect(section.count).toBe(chapterQuestions.filter(question => question.section === section.name).length);
      }
    }
  });

  it('keeps each visible short title aligned with the real question id', () => {
    const mismatches = questions.filter(question => {
      const questionNumber = question.id.split('_').at(-1);
      return question.short_title !== `${question.section} 第${questionNumber}题`;
    });
    expect(mismatches.map(question => question.id)).toEqual([]);
  });

  it('opens module practice across every matching chapter in the real bank', () => {
    const applicationQuestions = filterDrillQuestions(questions, {
      grade: '全部',
      chapterId: '',
      section: '全部',
      module: '应用题'
    });

    expect(applicationQuestions).toHaveLength(128);
    expect(new Set(applicationQuestions.map(question => question.chapter_id)).size).toBe(4);
  });
});
