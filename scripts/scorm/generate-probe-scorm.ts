/**
 * @module scripts/scorm/generate-probe-scorm
 * @description Пакет-зонд PRD-57 (задача #51): SCORM 2004 4th Ed. из трёх файлов, который
 * снимает на живом стенде пять фактов, сегодня стоящих в требованиях предположениями.
 *
 * Собирается ОТДЕЛЬНО от обычного экспорта и не подключает общий рантайм: зонд пишет в LMS
 * заведомо неверные значения, и чем меньше нашего кода между `SetValue` и ответом LMS, тем
 * меньше поводов объяснить результат собственной ошибкой.
 *
 * Запуск: `npm run scorm:probe`. Результат: `out/prd57-stand-probe.zip`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildZip } from "../../server/scorm/zip";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "..", "..", "out");
const OUT_NAME = "prd57-stand-probe.zip";
const PROBE_DIR = path.resolve(here, "probe");

/** Идентификаторы манифеста — свои, чтобы зонд не столкнулся с настоящим курсом в реестре LMS. */
const MANIFEST_ID = "PRD57-STAND-PROBE";
const TITLE = "Зонд PRD-57: замеры на стенде";

/**
 * Манифест одного SCO. Секвенсирования нет намеренно: зонду нечего проходить, он
 * открывается, снимает замеры и закрывает сессию.
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
  <organizations default="ORG-PROBE">
    <organization identifier="ORG-PROBE">
      <title>${TITLE}</title>
      <item identifier="ITEM-PROBE" identifierref="RES-PROBE" isvisible="true">
        <title>${TITLE}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-PROBE" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
      <file href="probe-runner.js"/>
    </resource>
  </resources>
</manifest>
`;

async function main(): Promise<void> {
  const page = fs.readFileSync(path.join(PROBE_DIR, "probe-page.html"), "utf8");
  const runner = fs.readFileSync(path.join(PROBE_DIR, "probe-runner.js"), "utf8");

  const zip = await buildZip({
    "imsmanifest.xml": manifest,
    "index.html": page,
    "probe-runner.js": runner,
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, OUT_NAME);
  fs.writeFileSync(target, zip);
  console.log(`Пакет-зонд собран: ${target} (${zip.length} байт)`);
  console.log("Загрузите его в LMS как учебный модуль SCORM 2004 и откройте — отчёт появится на экране.");
}

void main();
