/**
 * @module scripts/scorm/generate-fullscreen-probe-scorm
 * @description Пакет-зонд «сценарий на весь экран» (черновик задания-сценария в ИС,
 * docs/specs/sim-scenario/user-journey.md, раздел «Риски»). SCORM 2004 4th Ed. из
 * одного SCO, который проверяет на живом стенде три способа развернуть сценарий и вернуться
 * из него: полный экран из фрейма пакета, отдельное окно браузера и слой на область пакета.
 *
 * Собирается отдельно от обычного экспорта и общего рантайма не подключает — по тому же
 * правилу, что зонд PRD-57: чем меньше нашего кода между браузером LMS и замером, тем
 * меньше поводов объяснить результат собственной ошибкой.
 *
 * Запуск: `npm run scorm:probe:fullscreen`. Результат: `out/sim-fullscreen-probe.zip`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildZip } from "../../server/scorm/zip";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "..", "..", "out");
const OUT_NAME = "sim-fullscreen-probe.zip";
const PROBE_DIR = path.resolve(here, "fullscreen-probe");

/** Файлы пакета: страница SCO, страница отдельного окна и общий модуль. */
const PROBE_FILES = ["index.html", "sim.html", "fs-probe.js"] as const;

/** Идентификаторы манифеста — свои, чтобы зонд не столкнулся с настоящим курсом в реестре LMS. */
const MANIFEST_ID = "SIM-FULLSCREEN-PROBE";
const TITLE = "Зонд: сценарий на весь экран";

/**
 * Манифест одного SCO. `sim.html` объявлен файлом того же ресурса: LMS разворачивает его
 * рядом с точкой входа, и отдельное окно открывается с того же адреса, что и пакет.
 */
const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${MANIFEST_ID}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
                      http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
                      http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd
                      http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
                      http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-FS-PROBE">
    <organization identifier="ORG-FS-PROBE">
      <title>${TITLE}</title>
      <item identifier="ITEM-FS-PROBE" identifierref="RES-FS-PROBE" isvisible="true">
        <title>${TITLE}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-FS-PROBE" type="webcontent" adlcp:scormType="sco" href="index.html">
${PROBE_FILES.map((name) => `      <file href="${name}"/>`).join("\n")}
    </resource>
  </resources>
</manifest>
`;

async function main(): Promise<void> {
  const entries: Record<string, string> = { "imsmanifest.xml": manifest };
  for (const name of PROBE_FILES) entries[name] = fs.readFileSync(path.join(PROBE_DIR, name), "utf8");

  const zip = await buildZip(entries);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, OUT_NAME);
  fs.writeFileSync(target, zip);
  console.log(`Пакет-зонд собран: ${target} (${zip.length} байт)`);
  console.log("Загрузите его в LMS как учебный модуль SCORM 2004 и откройте — отчёт появится на экране.");
}

void main();
