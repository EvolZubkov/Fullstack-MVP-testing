/**
 * @module features/questions/scenario/scenario-summary
 * @description The words an author reads about an accepted «Сценарий в ИС» scenario: the summary
 * tags («11 сцен», «2 ловушки», «лимит 5:00») and the numbers they are made of. One module for the
 * question drawer and the bank row, so the two never describe the same scenario differently.
 */
import type { ScenarioSummary } from "@shared/sim/validate";

/** Russian plural: forms for 1, 2–4 and 5+. */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} ${many}`;
  if (mod10 === 1) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** Size in megabytes with a decimal comma: «1,1 МБ». */
export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

/** Seconds as «m:ss». */
function mmss(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The tags of an accepted scenario, as the wireframe lists them. */
export function summaryTags(s: ScenarioSummary): string[] {
  const tags = [
    plural(s.scenes, ["сцена", "сцены", "сцен"]),
    plural(s.images, ["изображение", "изображения", "изображений"]),
    plural(s.fields, ["поле", "поля", "полей"]),
    plural(s.traps, ["ловушка", "ловушки", "ловушек"]),
    `цель: ${plural(s.checks, ["проверка", "проверки", "проверок"])}`,
  ];
  if (s.limitSeconds) tags.push(`лимит ${mmss(s.limitSeconds)}`);
  return tags;
}
