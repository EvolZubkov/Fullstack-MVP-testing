/**
 * @module shared/text/hanging-words
 *
 * Russian words that must not be left hanging at the end of a line: the
 * typography pass binds each of them to the word that follows with a
 * non-breaking space.
 *
 * The list is inlined as a constant on purpose. Its previous incarnation shipped
 * as a JSON asset fetched at runtime, which made the pass non-deterministic —
 * calls made before the fetch resolved silently fell back to a cruder rule — and
 * unreachable at all inside a SCORM package, where there is no server to fetch
 * from. Both hosts must produce the same text for the same input, so the data
 * travels with the code.
 */

/** Prepositions, including the vocalised forms (`во`, `ко`, `предо`). */
const PREPOSITIONS = [
  "в", "во", "к", "ко", "с", "со", "у", "о", "об", "обо", "от", "ото", "до", "за",
  "из", "на", "над", "по", "под", "подо", "пред", "предо", "при", "про", "без",
  "безо", "меж", "между", "через", "чрез", "сквозь", "вне", "вместо", "кроме",
  "перед", "передо", "около", "после", "вдоль", "вокруг", "ради", "для",
];

/** Conjunctions and particles. */
const CONJUNCTIONS = [
  "и", "а", "но", "да", "или", "либо", "то", "ни", "не", "же", "бы", "ли", "как",
  "так", "что", "чем", "хоть", "хотя", "если", "когда", "пока", "лишь", "едва",
];

/** Personal pronouns in every case form. */
const PRONOUNS = [
  "я", "ты", "он", "она", "оно", "мы", "вы", "они", "меня", "тебя", "его", "ее",
  "её", "нас", "вас", "их", "мне", "тебе", "ему", "ей", "нам", "вам", "им",
  "мной", "мною", "тобой", "тобою", "ею", "нами", "вами", "ими",
];

/** Possessive pronouns. */
const POSSESSIVES = [
  "мой", "моя", "моё", "мое", "мои", "твой", "твоя", "твоё", "твое", "твои",
  "наш", "наша", "наше", "наши", "ваш", "ваша", "ваше", "ваши", "свой", "своя",
  "своё", "свое", "свои",
];

/** Demonstrative, definitive and interrogative pronouns. */
const DEMONSTRATIVES = [
  "этот", "эта", "это", "эти", "тот", "та", "те", "сам", "сама", "само", "сами",
  "весь", "вся", "всё", "все", "каждый", "каждая", "каждое", "каждые", "кто",
  "кто-то", "что-то", "кто-нибудь", "что-нибудь",
];

/** Short adverbs and interjections that read as leading words. */
const ADVERBS = ["вот", "уже", "ещё", "там", "тут", "ну"];

/** Every hanging word, lower-cased, for O(1) lookup by the typography pass. */
export const HANGING_WORDS: ReadonlySet<string> = new Set([
  ...PREPOSITIONS,
  ...CONJUNCTIONS,
  ...PRONOUNS,
  ...POSSESSIVES,
  ...DEMONSTRATIVES,
  ...ADVERBS,
]);
