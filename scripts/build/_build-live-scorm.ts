import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { buildScormExportData } from "../../server/scorm/build-export-data";
import { generateScormPackage } from "../../server/scorm/index";
async function main() {
  const data = await buildScormExportData(process.argv[2], { source: "debug" });
  const buf = await generateScormPackage(data as never);
  mkdirSync("out", { recursive: true });
  writeFileSync(process.argv[3], buf);
  console.log(`WROTE ${process.argv[3]}`);
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e?.message || e); process.exit(1); });
