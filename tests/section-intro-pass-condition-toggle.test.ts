/**
 * @module tests/section-intro-pass-condition-toggle
 * @description Тумблер варианта «Введение раздела» `passConditionShown`: выключенный, он
 * убирает строку «Для прохождения: …» и ничего больше — пометка «Обязательная тема»,
 * предупреждение о таймере и сам порог темы остаются. Держит вместе ядро (разрешение
 * настройки страницы), три поставляемых шаблона (рендер и объявление в манифесте) и путь
 * пакета SCORM, включая его запасной построитель.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildSectionIntroContext, type SectionIntroInput } from "../shared/template/result-context";
import { buildPageContext, passConditionShownOf } from "../shared/template/page-sequences";
import {
  sectionPassConditionText,
  sectionIsRequiredForVerdict,
  sectionTimerWarningText,
} from "../shared/template/pass-condition";
import { TEMPLATE_IDS, templateFile, templateManifest, type TemplateId } from "./helpers/template-roots";

/** Раздел с порогом в баллах, обязательный для вердикта, с лимитом времени. */
const GATED: Pick<
  SectionIntroInput,
  "timeLimitMinutes" | "passRule" | "possiblePoints" | "required" | "passDecisionPolicy"
> = {
  timeLimitMinutes: 20,
  passRule: { type: "count", value: 11 },
  possiblePoints: 22,
  required: true,
  passDecisionPolicy: "required_topics_only",
};

/** Рендерит экран введения шаблона `id` и возвращает его корень. */
function renderIntro(id: TemplateId, passConditionShown: boolean | undefined): HTMLElement {
  const layout = readFileSync(templateFile(id, "layouts/section-intro.html"), "utf8");
  const built = buildSectionIntroContext({
    sectionNumber: 3,
    sectionsTotal: 8,
    topicName: "Технологии",
    questionCount: 12,
    ...GATED,
    passConditionShown,
  });
  const root = document.createElement("div");
  renderScreenInto(root, {
    layout,
    context: { ...built, design: {}, page: buildPageContext(null) },
    slots: { instruction: "" },
  });
  return root;
}

describe("passConditionShownOf", () => {
  it("гасит строку только явным false", () => {
    expect(passConditionShownOf({ id: "p", settingsJson: { passConditionShown: false } } as never)).toBe(false);
    expect(passConditionShownOf({ id: "p", settingsJson: { passConditionShown: true } } as never)).toBe(true);
  });

  it("страница без значения и вариант без настройки строку сохраняют", () => {
    expect(passConditionShownOf({ id: "p", settingsJson: {} } as never)).toBe(true);
    expect(passConditionShownOf({ id: "p", settingsJson: null } as never)).toBe(true);
    expect(passConditionShownOf(null)).toBe(true);
  });

  it("читает и пакетную форму настроек (`settings`)", () => {
    expect(passConditionShownOf({ id: "p", settings: { passConditionShown: false } } as never)).toBe(false);
  });
});

describe("buildSectionIntroContext — passConditionShown", () => {
  it("выключенный тумблер оставляет пустое условие, но не трогает пометку и таймер", () => {
    const { sectionIntro } = buildSectionIntroContext({ sectionNumber: 1, topicName: "T", questionCount: 12, ...GATED, passConditionShown: false });
    expect(sectionIntro.passCondition).toBe("");
    expect(sectionIntro.isRequired).toBe(true);
    expect(sectionIntro.timerWarning).not.toBe("");
  });

  it("без тумблера условие печатается как раньше", () => {
    const { sectionIntro } = buildSectionIntroContext({ sectionNumber: 1, topicName: "T", questionCount: 12, ...GATED });
    expect(sectionIntro.passCondition).toBe("Для прохождения: 11 баллов из 22");
  });
});

describe.each(TEMPLATE_IDS)("%s — условие прохождения на вводной раздела", (id) => {
  it("печатает строку, пока тумблер включён", () => {
    expect(renderIntro(id, true).textContent).toContain("Для прохождения: 11 баллов из 22");
  });

  it("при выключенном тумблере строки нет, пометка «Обязательная тема» остаётся", () => {
    const text = renderIntro(id, false).textContent ?? "";
    expect(text).not.toContain("Для прохождения");
    expect(text).toContain("Обязательная тема");
  });

  it("объявляет тумблер у варианта введения с умолчанием «показывать»", () => {
    const manifest = JSON.parse(readFileSync(templateManifest(id), "utf8")) as {
      contentTemplates?: Array<{ kind?: string; settings?: Array<{ key: string; type?: string; default?: unknown }> }>;
    };
    const intro = (manifest.contentTemplates ?? []).find((v) => v.kind === "intro");
    const setting = (intro?.settings ?? []).find((s) => s.key === "passConditionShown");
    expect(setting?.type).toBe("boolean");
    expect(setting?.default).toBe(true);
  });
});

describe("пакет SCORM — запасной построитель вводной", () => {
  const src = readFileSync(resolve(process.cwd(), "server/scorm/template/app/render/contentPage.js"), "utf8");

  afterEach(() => vi.unstubAllGlobals());

  it("выключенный тумблер гасит условие и в запасном пути", () => {
    vi.stubGlobal("TBTemplate", { sectionPassConditionText, sectionIsRequiredForVerdict, sectionTimerWarningText });
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const rt = new Function(`${src}\n;return { buildSectionIntroFallback };`)() as {
      buildSectionIntroFallback: (inp: unknown) => { sectionIntro: { passCondition: string; isRequired: boolean } };
    };
    const off = rt.buildSectionIntroFallback({ topicName: "T", questionCount: 12, ...GATED, passConditionShown: false });
    expect(off.sectionIntro.passCondition).toBe("");
    expect(off.sectionIntro.isRequired).toBe(true);
    const on = rt.buildSectionIntroFallback({ topicName: "T", questionCount: 12, ...GATED });
    expect(on.sectionIntro.passCondition).toBe("Для прохождения: 11 баллов из 22");
  });
});
