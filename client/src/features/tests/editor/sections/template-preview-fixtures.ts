/**
 * @module features/tests/editor/sections/template-preview-fixtures
 * @description Demo data for the template preview modal (PRD-7 S12 G2 / FR-30).
 *
 * The preview modal renders a fixed set of example pages and questions inside
 * a mocked SCORM shell, branded with the current `design.draft.params`. These
 * fixtures are intentionally hard-coded and stateless — the modal shows the
 * template's look-and-feel, not the test's actual content.
 *
 * Content is in Russian to mirror what the author will see on screen.
 */

/** Shared course chrome (sidebar topics, course title) used across all items. */
export const PREVIEW_COURSE_CHROME = {
  courseTitle: "Демо-курс по информационной безопасности",
  topicTitle: "Тема 1 из 3",
  pageIndicator: "стр. 1 из 5",
  sidebarTopics: [
    { label: "1. Основы безопасности", active: true },
    { label: "2. Продвинутые угрозы", active: false },
    { label: "3. Практика", active: false },
  ],
  progressPercent: 20,
} as const;

/** Intro page demo (kind: "intro"). */
export const PREVIEW_INTRO = {
  title: "Введение в раздел",
  subtitle: "Перед началом ответьте внимательно",
  heroAlt: "Изображение (hero)",
} as const;

/** Info / learning material demo (kind: "info"). */
export const PREVIEW_INFO = {
  title: "Парольная политика организации",
  body: "Сложный пароль состоит минимум из 12 символов: строчные и заглавные буквы, цифры, специальные знаки. Менять пароль рекомендуется не реже одного раза в 90 дней. Никогда не передавайте пароль третьим лицам — даже коллегам.",
} as const;

/** Summary / result page demo (kind: "summary"). */
export const PREVIEW_SUMMARY = {
  title: "Ваш результат",
  scorePercent: 84,
  scoreLabel: "Тест пройден",
  hint: "Минимальный проходной балл — 70%.",
} as const;

/** Question types — fixed in test-builder (matches BRD/PRD question kinds). */
export type PreviewQuestionType = "single" | "multiple" | "ranking" | "matching";

export const PREVIEW_QUESTION_TYPE_LABEL: Record<PreviewQuestionType, string> = {
  single: "Один вариант ответа",
  multiple: "Несколько вариантов",
  ranking: "Ранжирование",
  matching: "Сопоставление",
};

/** Demo data per question type. */
export const PREVIEW_QUESTIONS: Record<
  PreviewQuestionType,
  {
    prompt: string;
    /** single/multiple — options list with selected flag. */
    options?: { label: string; selected: boolean }[];
    /** ranking — ordered list. */
    rankItems?: string[];
    /** matching — pairs of left/right labels. */
    pairs?: { left: string; right: string }[];
  }
> = {
  single: {
    prompt: "Какой пароль из перечисленных самый надёжный?",
    options: [
      { label: "qwerty123", selected: false },
      { label: "Pa$$w0rd!2024", selected: true },
      { label: "admin", selected: false },
      { label: "12345678", selected: false },
    ],
  },
  multiple: {
    prompt: "Какие признаки указывают на фишинговое письмо?",
    options: [
      { label: "Адрес отправителя содержит опечатки в домене", selected: true },
      { label: "Письмо требует срочно перейти по ссылке", selected: true },
      { label: "Письмо подписано вашим коллегой", selected: false },
      { label: "Письмо запрашивает пароль или код подтверждения", selected: true },
    ],
  },
  ranking: {
    prompt: "Расставьте этапы реагирования на инцидент по порядку.",
    rankItems: [
      "1. Обнаружить и идентифицировать инцидент",
      "2. Локализовать угрозу и изолировать систему",
      "3. Устранить причину и восстановить работу",
      "4. Извлечь уроки и обновить регламент",
    ],
  },
  matching: {
    prompt: "Сопоставьте угрозу с типичной мерой защиты.",
    pairs: [
      { left: "Фишинг", right: "Обучение и проверка отправителя" },
      { left: "Утечка пароля", right: "Многофакторная аутентификация" },
      { left: "Незашифрованный канал", right: "TLS / VPN" },
      { left: "Кража устройства", right: "Шифрование диска" },
    ],
  },
};

/** Stable demo course total / question count for caption / footer. */
export const PREVIEW_DEMO_TOTAL = {
  pageCount: 5,
  questionCount: 4,
} as const;
