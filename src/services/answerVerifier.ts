/**
 * Intelligent Answer Normalization & Verification Engine with Anti-Cheat & Tolerance
 */

export interface AnswerCheckResult {
  isCorrect: boolean;
  isGradable: boolean;
  userNormalized: string;
  targetNormalized: string;
  feedback: string;
}

const UNGRADABLE_ANSWERS = new Set([
  '',
  '见解析',
  '详见解析',
  '详见原版名师精解',
  '略',
  '待补充'
]);

export function isAutoGradableAnswer(standardAnswer?: string | null): boolean {
  if (!standardAnswer) return false;
  const answer = standardAnswer.trim();
  if (UNGRADABLE_ANSWERS.has(answer)) return false;
  if (/(?:见解析|详见|待补充|答案不唯一|如图|见图|证明|证法|构造|分类讨论|分情况说明|尝试)/.test(answer)) {
    return false;
  }
  // Whitespace between digits is usually an OCR-damaged number ("60 200").
  // Calendar/time answers need their units preserved and are safer to confirm
  // manually than to flatten into an unrelated number or ratio.
  if (/\d\s+\d/.test(answer) || /\d+月.*\d+日/.test(answer)) return false;
  if (/\S+\s*[（(]1[）)]/.test(answer)) return false;
  // Compound Chinese currency cannot be flattened safely: 2元7角6分 is
  // 2.76 yuan, not the integer 276.
  if (/\d+元.*\d+角|\d+角.*\d+分/.test(answer)) return false;

  const normalized = normalizeAnswer(answer);
  if (!normalized || /^[,;]|[,;]$|[,;]{2}/.test(normalized)) return false;
  if (parseLabeledNumericComponent(normalized) !== null) return true;
  if (parseNumericSequence(normalized) !== null) return true;
  if (extractOrderedNumericComponents(normalized) !== null) return true;

  // Keep concise non-numeric conclusions (e.g. 甲、星期一) gradable by exact
  // text, while routing long prose/explanations to manual confirmation.
  return normalized.length <= 16 && /^[\p{Script=Han}a-z]+$/u.test(normalized);
}

/**
 * Normalize an answer string for robust mathematical equivalence matching
 */
export function normalizeAnswer(input: string): string {
  if (!input) return '';

  let str = input.trim();

  // Convert full-width characters (e.g. １２３＋－） to half-width
  str = str.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  str = str.replace(/\u3000/g, ' '); // full-width space

  // Convert Chinese punctuation to standard
  str = str.replace(/[，、]/g, ',');
  str = str.replace(/[。；]/g, ';');
  str = str.replace(/[：]/g, ':');
  str = str.replace(/[“”]/g, '"');
  str = str.replace(/[（]/g, '(').replace(/[）]/g, ')');

  // Treat numbered sub-question markers as separators. Some OCR answers omit
  // punctuation entirely: "(1)12种(2)21种" should become "12;21".
  str = str.replace(/^\(\d+\)[.、:]?\s*/, '');
  str = str.replace(/[,;]*\(\d+\)[.、:]?\s*/g, ';');

  // Remove common unit words
  const unitsRegex = /(?:平方千米|平方公里|平方厘米|平方分米|平方米|立方厘米|立方分米|立方米|小时|分钟|公顷|毫米|厘米|分米|千米|公里|毫升|千克|公斤|颗|枚|盆|根|棵|瓶|件|对|级|页|路|站|段|个|只|块|把|本|条|张|袋|辆|架|套|名|位|人|组|间|层|秒|米|升|克|斤|两|吨|度|元|角|分(?!之)|道|步|种|次|圈|岁|倍)/g;
  str = str.replace(unitsRegex, '');

  // Remove "答案" "解" "答" "为" "是" "等于" prefixes/suffixes
  str = str.replace(/^(?:答案|答|解|为|是|等于|约等于|约|得)[:：\s]*/i, '');
  str = str.replace(/(?:个|只|块|厘米|米|元|人)?$/g, '');

  // Normalize fractions e.g. 1/2
  str = str.replace(/\s*\/\s*/g, '/');

  // Collapse spaces
  str = str.replace(/\s+/g, '');

  return str.toLowerCase();
}

/**
 * Verify student/teacher input against standard answer
 */
export function verifyAnswer(userInput: string, standardAnswer: string): AnswerCheckResult {
  const normUser = normalizeAnswer(userInput);
  const normStandard = normalizeAnswer(standardAnswer);

  if (!isAutoGradableAnswer(standardAnswer)) {
    return {
      isCorrect: false,
      isGradable: false,
      userNormalized: normUser,
      targetNormalized: normStandard,
      feedback: '本题暂无可自动判分的文本答案，请查看官方答案切片后手动标记。'
    };
  }

  if (!normUser) {
    return {
      isCorrect: false,
      isGradable: true,
      userNormalized: '',
      targetNormalized: normStandard,
      feedback: '请输入您的答案'
    };
  }

  // 1. Exact normalized match
  if (normUser === normStandard) {
    return {
      isCorrect: true,
      isGradable: true,
      userNormalized: normUser,
      targetNormalized: normStandard,
      feedback: '回答正确！🎉'
    };
  }

  // 2. Numerical equivalence check (e.g. 0.5 vs 1/2 or 10.0 vs 10)
  const numUser = parseLabeledNumericComponent(normUser);
  const numStd = parseLabeledNumericComponent(normStandard);
  if (numUser !== null && numStd !== null && Math.abs(numUser - numStd) < 1e-5) {
    return {
      isCorrect: true,
      isGradable: true,
      userNormalized: normUser,
      targetNormalized: normStandard,
      feedback: '回答正确！数值完全等价 🎉'
    };
  }

  // 3. Ordered multi-part equivalence. Question sub-parts carry meaning, so
  // "38,7" must not pass for "7人；38个" merely because the set is equal.
  const userParts = extractOrderedNumericComponents(normUser);
  const standardParts = extractOrderedNumericComponents(normStandard);
  if (userParts && standardParts && userParts.length === standardParts.length) {
    const allEquivalent = userParts.every(
      (value, index) => Math.abs(value - standardParts[index]) < 1e-5
    );
    if (allEquivalent) {
      return {
        isCorrect: true,
        isGradable: true,
        userNormalized: normUser,
        targetNormalized: normStandard,
        feedback: '回答正确！各小问依次匹配 🎉'
      };
    }
  }

  // 4. Pure ratio/time sequences, including a short non-numeric label before
  // an equals sign such as "大:中:小=15:6:4".
  const userSequence = parseNumericSequence(normUser);
  const standardSequence = parseNumericSequence(normStandard);
  if (
    userSequence
    && standardSequence
    && userSequence.length === standardSequence.length
    && userSequence.every((value, index) => Math.abs(value - standardSequence[index]) < 1e-5)
  ) {
    return {
      isCorrect: true,
      isGradable: true,
      userNormalized: normUser,
      targetNormalized: normStandard,
      feedback: '回答正确！比值顺序完全匹配 🎉'
    };
  }

  return {
    isCorrect: false,
    isGradable: true,
    userNormalized: normUser,
    targetNormalized: normStandard,
    feedback: `未匹配标准答案 (输入: ${userInput.trim()} | 参考: ${standardAnswer})`
  };
}

function parseFractionOrNumber(str: string): number | null {
  const percentMatch = str.match(/^(-?\d+(?:\.\d+)?)%$/);
  if (percentMatch) return parseFloat(percentMatch[1]) / 100;

  const mixedMatch = str.match(/^(-?\d+)又(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseFloat(mixedMatch[1]);
    const numerator = parseFloat(mixedMatch[2]);
    const denominator = parseFloat(mixedMatch[3]);
    if (denominator !== 0) {
      return whole < 0 ? whole - numerator / denominator : whole + numerator / denominator;
    }
  }

  const chineseFractionMatch = str.match(/^(\d+)分之(-?\d+)$/);
  if (chineseFractionMatch) {
    const denominator = parseFloat(chineseFractionMatch[1]);
    const numerator = parseFloat(chineseFractionMatch[2]);
    if (denominator !== 0) return numerator / denominator;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(str)) {
    return parseFloat(str);
  }
  const fracMatch = str.match(/^(-?\d+)\/(\d+)$/);
  if (fracMatch) {
    const num = parseFloat(fracMatch[1]);
    const den = parseFloat(fracMatch[2]);
    if (den !== 0) return num / den;
  }
  return null;
}

function parseLabeledNumericComponent(component: string): number | null {
  const direct = parseFractionOrNumber(component);
  if (direct !== null) return direct;

  // Only strip an unambiguous item marker. A bare leading number is the
  // answer itself, not a label ("4,3" must remain [4, 3]).
  let value = component.replace(/^(?:\(\d+\)|\d+[.、])/, '');

  // Accept short labels that themselves contain no numbers, such as 面积4 or
  // A=1. Do not strip arithmetic expressions like 5+4-3=6 down to just 6.
  const labeled = value.match(/^[^\d-]*[=:]?(-?\d+又\d+\/\d+|-?\d+\/\d+|-?\d+(?:\.\d+)?%?)$/);
  if (!labeled) return null;
  value = labeled[1];
  return parseFractionOrNumber(value);
}

function extractOrderedNumericComponents(str: string): number[] | null {
  if (!/[,;]/.test(str)) return null;
  const rawParts = str.split(/[,;]/);
  if (rawParts.length < 2 || rawParts.some(part => !part)) return null;
  const parsed = rawParts.map(parseLabeledNumericComponent);
  return parsed.every((value): value is number => value !== null) ? parsed : null;
}

function parseNumericSequence(str: string): number[] | null {
  let candidate = str;
  const equalsIndex = candidate.lastIndexOf('=');
  if (equalsIndex >= 0) {
    const label = candidate.slice(0, equalsIndex);
    if (/\d/.test(label)) return null;
    candidate = candidate.slice(equalsIndex + 1);
  }
  if (!/^-?\d+(?:\.\d+)?(?::-?\d+(?:\.\d+)?)+$/.test(candidate)) return null;
  return candidate.split(':').map(Number);
}

/**
 * Generate smart answer template / formatting hint based on standard answer
 */
export function getAnswerFormatHint(standardAnswer: string): string {
  if (!isAutoGradableAnswer(standardAnswer)) {
    return '本题请先演算，再查看官方答案切片并手动标记对错。';
  }
  if (/^\d+$/.test(standardAnswer.trim())) {
    return '💡 本题答案为整数数值，直接输入纯数字即可（如: 10）。';
  }
  if (/^\d+\.\d+$/.test(standardAnswer.trim())) {
    return '💡 本题答案为小数值（如: 3.14），请输入准确数值。';
  }
  if (standardAnswer.includes('/') || standardAnswer.includes('分之')) {
    return '💡 本题答案包含分数，可直接输入 a/b 格式（如: 3/4）。';
  }
  if (/[,;，；、]/.test(standardAnswer) || /[（(]\d+[）)]/.test(standardAnswer)) {
    return '💡 本题包含多个数值解答，请用逗号隔开（如: 3, 4）。';
  }
  return '💡 请输入最终答案的核心数值或简短结论（系统支持自动忽略单位与空格）。';
}
