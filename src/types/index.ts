export type MathModule = '计算' | '计数' | '数论' | '几何' | '应用题' | '数字谜' | '组合数学';

export interface QuestionSection {
  name: string; // '兴趣篇' | '拓展篇' | '超越篇'
  count: number;
  diff: string;
  start_index: number;
  end_index: number;
}

export interface Question {
  id: string;
  chapter_id: string;
  grade: string;
  grade_num: number;
  chapter_num: number;
  chapter_title: string;
  module: MathModule;
  sub_module: string;
  section: string;
  section_num: number;
  global_chapter_num: number;
  display_title: string;
  short_title: string;
  difficulty: number;
  difficulty_stars: string;
  score: number;
  content: string; // 数字化题目文本与LaTeX
  answer: string; // 数字化标准答案
  explanation: string; // 数字化详细分步解析
  analysis?: string; // 考点分析
  key_point?: string; // 名师避坑要领
  q_page_url: string;
  q_page_num: number;
  ans_page_url: string;
  ans_page_num: number;
  q_slice_url?: string;
  ans_slice_url?: string;
  needs_ai_explanation?: boolean;
  all_q_pages: string[];
  all_ans_pages: string[];
  tags: string[];
}

export interface Chapter {
  id: string;
  grade: string;
  grade_num: number;
  chapter_num: number;
  title: string;
  module: MathModule;
  sub_module: string;
  difficulty: number;
  total_questions: number;
  sections: QuestionSection[];
  q_pages: string[];
  ans_pages: string[];
}

export type AnswerStatus = 'correct' | 'wrong' | 'unsolved';

export interface UserRecord {
  question_id: string;
  chapter_id?: string;
  status: AnswerStatus;
  user_answer?: string;
  is_mastered?: boolean;
  attempt_count: number;
  wrong_count?: number;
  /**
   * Per-device grow-only counters make offline attempts mergeable without
   * adding the same cloud snapshot more than once. Older records without
   * these fields are migrated lazily into the reserved `legacy` bucket.
   */
  attempt_counts_by_device?: Record<string, number>;
  wrong_counts_by_device?: Record<string, number>;
  last_attempt_at: string; // ISO string
  user_notes?: string;
  notes?: string;
  source?: 'online' | 'manual' | 'ai_ocr';
  // Ebbinghaus Forgetting Curve
  ebbinghaus_stage?: number; // 0 to 5
  next_review_at?: string; // ISO date string
  review_history?: Array<{ id?: string; reviewed_at: string; passed: boolean }>;
}

export interface UserSummary {
  username: string; // 姓名拼音缩写，如 'zs'
  real_name: string; // 真实姓名，如 '张三'
  role: 'user' | 'admin';
  avatar?: string;
  daily_target: number;
  focus_module?: MathModule;
  plan_mode: 'balanced' | 'module_focus' | 'rush';
  solved_count: number;
  correct_count: number;
  wrong_count: number;
  accuracy_rate: number; // 0 - 100
  completion_rate: number; // 0 - 100
  streak_days: number;
  last_active_at: string;
}

export interface TeamMember {
  username: string; // 姓名拼音缩写
  account_id?: string; // Stable identity; changes when a deleted username is reused
  real_name: string;
  role: 'user' | 'admin';
  password_hash?: string;
  created_at: string;
  last_login_at: string;
}

export interface TeamMemberMutation {
  operation: 'upsert' | 'delete';
  updated_at: string;
  /** Delete mutations retain the member snapshot so an administrator can restore it. */
  member?: TeamMember;
}

export interface SyncConfig {
  webdav_url: string;
  webdav_username: string;
  webdav_password: string;
  opencodego_api_key: string;
  auto_sync: boolean;
  last_synced_at?: string;
  sync_status: 'idle' | 'syncing' | 'success' | 'error';
  last_error_msg?: string;
}

export interface ExamPlanConfig {
  mode: 'balanced' | 'module_focus' | 'rush';
  focus_module: MathModule;
  daily_target: number;
  exam_date: string; // '2026-09-18'
  /** Last local edit time, used to resolve multi-device cloud conflicts. */
  updated_at?: string;
}

export interface TeamAnnouncement {
  id: string;
  title: string;
  content: string;
  created_at: string;
  author: string;
  is_pinned?: boolean;
}

export interface TeamErrorItem {
  question_id: string;
  question: Question;
  wrong_count: number;
  attempt_count: number;
  wrong_rate: number; // 0 - 100
  wrong_users: string[]; // usernames
  solution_tips?: string[];
}
