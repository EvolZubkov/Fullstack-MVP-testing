import type {
  Test, TestSection, Topic, Question, TopicCourse, PassRule,
  TestQuestionScoring, ByVariantThreshold,
} from "@shared/schema";
import { escapeXml } from "../utils/escape";
import { buildTestScoringContext } from "../../services/effective-scoring";
import * as fs from "fs";
import * as path from "path";

interface ExportData {
  test: Test;
  sections: (TestSection & { topic: Topic; questions: Question[]; courses: TopicCourse[] })[];
  /**
   * PRD-15 block D: per-(test, question) scoring overrides. Needed here only to
   * resolve a variant's attainable points for the PRD-24 `by_variant` threshold —
   * price is a property of the TEST, not of the question (T-40).
   */
  questionScoring?: TestQuestionScoring[];
}

// ---- SCORM identifier (stable per test) ----
type ScormIdMap = Record<string, { code: string; createdAt: string }>;

function getSingaporeDateStamp(d = new Date()): string {
  // YYYYMMDD in Asia/Singapore
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const day = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${y}${m}${day}`;
}

function translitRuToLat(input: string): string {
  const map: Record<string, string> = {
    А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "Zh", З: "Z", И: "I", Й: "Y",
    К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F",
    Х: "Kh", Ц: "Ts", Ч: "Ch", Ш: "Sh", Щ: "Shch", Ы: "Y", Э: "E", Ю: "Yu", Я: "Ya",
    Ь: "", Ъ: "",
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ы: "y", э: "e", ю: "yu", я: "ya",
    ь: "", ъ: "",
  };
  return input.split("").map((ch) => (ch in map ? map[ch] : ch)).join("");
}

function slugifyForId(title: string): string {
  const t = translitRuToLat(title || "").trim();
  const cleaned = t
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "Test";
}

function getOrCreateScormCode(test: Test): string {
  const dir = path.resolve(process.cwd(), "uploads", "scorm");
  const file = path.join(dir, "identifiers.json");
  fs.mkdirSync(dir, { recursive: true });

  let mapObj: ScormIdMap = {};
  if (fs.existsSync(file)) {
    try {
      mapObj = JSON.parse(fs.readFileSync(file, "utf8")) as ScormIdMap;
    } catch {
      mapObj = {};
    }
  }

  const existing = mapObj[test.id]?.code;
  if (existing) return existing; // ✅ уже генерировали — не меняем

  const stamp = getSingaporeDateStamp();
  const slug = slugifyForId(test.title || `test_${test.id}`);

  // XML xs:ID не может начинаться с цифры → добавляем "_"
  const code = `${stamp}_${slug}`;

  mapObj[test.id] = { code, createdAt: stamp };
  try {
    fs.writeFileSync(file, JSON.stringify(mapObj, null, 2), "utf8");
  } catch {
    // если не получилось записать — всё равно отдадим пакет, просто код не сохранится
  }
  return code;
}


export function buildManifest(test: Test, data: ExportData, extraFiles: string[] = []): string {
  const code = getOrCreateScormCode(test);
  const manifestId = code;
  const orgId = code;
  const itemId = `${code}_m`;
  const resId = `${code}_r`;

  const overallPassRule = test.overallPassRuleJson as PassRule;
  // Effective per-topic draw: drawAll / adaptive draw the whole current pool.
  const effectiveDraw = (s: ExportData["sections"][number]): number =>
    (test.mode || "standard") === "adaptive" || s.drawAll ? s.questions.length : s.drawCount;
  const totalQuestions = data.sections.reduce((sum, s) => sum + effectiveDraw(s), 0);

  const overallThreshold =
    overallPassRule.type === "percent"
      ? (overallPassRule.value / 100).toFixed(2)
      : totalQuestions > 0
        ? (overallPassRule.value / totalQuestions).toFixed(2)
        : "0.8";

  // PRD-24: attainable points of a variant come from the EFFECTIVE price chain
  // (override → section default → test default → system), never from the question.
  const scoringCtx = buildTestScoringContext(test, data.sections, data.questionScoring ?? []);

  /**
   * PRD-24 (FR-17): a `by_variant` topic has no single threshold, so advertise the
   * LOWEST normalized one across its variants — `percent/100`, or `value / Σ points
   * of that variant` for an absolute rule. Metadata stricter than the applied rule
   * could block a learner who cleared their own variant. Returns null when the rule
   * is not per-variant (or carries no usable entries), so the caller falls through.
   */
  const byVariantThreshold = (s: ExportData["sections"][number]): string | null => {
    const rule = s.topicPassRuleJson as { source?: string; byForm?: Record<string, ByVariantThreshold> } | null;
    if (!rule || rule.source !== "by_variant" || !s.formSetJson) return null;
    const pointsById = new Map(s.questions.map((q) => [q.id, scoringCtx.resolve(q).points]));
    const norms: number[] = [];
    for (const form of s.formSetJson.forms) {
      const entry = rule.byForm?.[form.id];
      if (!entry) continue;
      if (entry.type === "percent") {
        norms.push(entry.value / 100);
      } else {
        const sum = form.questionIds.reduce((acc, id) => acc + (pointsById.get(id) ?? 1), 0);
        norms.push(sum > 0 ? entry.value / sum : 0);
      }
    }
    return norms.length ? Math.min(...norms).toFixed(2) : null;
  };

  const objectives = data.sections
    .map((s) => {
      const topicPassRule = s.topicPassRuleJson as PassRule | null;
      const perVariant = byVariantThreshold(s);
      let threshold = "0.5";
      if (perVariant !== null) {
        threshold = perVariant;
      } else if (topicPassRule && topicPassRule.type) {
        // `type` guard: a `by_variant` rule carries no type/value of its own, so a
        // topic left without a usable variant map keeps the neutral default.
        threshold =
          topicPassRule.type === "percent"
            ? (topicPassRule.value / 100).toFixed(2)
            : (topicPassRule.value / Math.max(effectiveDraw(s), 1)).toFixed(2);
      }
      return `
        <imsss:objective objectiveID="obj_topic_${s.topic.id}">
          <imsss:minNormalizedMeasure>${threshold}</imsss:minNormalizedMeasure>
        </imsss:objective>`;
    })
    .join("");

  // ✅ manifest перечисляет реальные файлы, добавленные в zip
  const uniqueExtra = Array.from(new Set(extraFiles))
    .filter(Boolean)
    // на всякий: в manifest должны быть относительные пути
    .map((p) => p.replace(/^[\\/]+/, ""));

  const extraFileTags = uniqueExtra
    .map((href) => `      <file href="${escapeXml(href)}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${manifestId}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
    http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
    http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
    http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd
    http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">

  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
    <adlcp:location>metadata.xml</adlcp:location>
  </metadata>

  <organizations default="${orgId}">
    <organization identifier="${orgId}" structure="hierarchical">
      <title>${escapeXml(test.title)}</title>
      <item identifier="${itemId}" identifierref="${resId}">
        <title>${escapeXml(test.title)}</title>
        <imsss:sequencing>
          <imsss:controlMode choice="true" flow="true" />
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true" />
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="primary_obj" satisfiedByMeasure="true">
              <imsss:minNormalizedMeasure>${overallThreshold}</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>${objectives}
          </imsss:objectives>
        </imsss:sequencing>
        <adlnav:presentation>
          <adlnav:navigationInterface>
            <adlnav:hideLMSUI>continue</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>previous</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>abandon</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>exit</adlnav:hideLMSUI>
          </adlnav:navigationInterface>
        </adlnav:presentation>
      </item>
    </organization>
  </organizations>

  <resources>
    <resource identifier="${resId}" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
      <file href="styles.css"/>
      <file href="runtime.js"/>
      <file href="app.js"/>
      <file href="vendor/html2canvas.min.js"/>
      <file href="vendor/jspdf.umd.min.js"/>
${extraFileTags ? extraFileTags + "\n" : ""}    </resource>
  </resources>
</manifest>`;
}
