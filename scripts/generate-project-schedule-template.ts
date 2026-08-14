import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Schedule");

  sheet.columns = [
    { header: "Project Name", key: "name", width: 40 },
    { header: "Start Date", key: "start", width: 16, style: { numFmt: "yyyy-mm-dd" } },
    { header: "End Date", key: "end", width: 16, style: { numFmt: "yyyy-mm-dd" } },
  ];
  sheet.getRow(1).font = { bold: true };

  const outputDir = path.join(process.cwd(), "public", "templates");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "project-schedule-template.xlsx");
  await workbook.xlsx.writeFile(outputPath);
  console.log(`Wrote template to ${outputPath}`);
}

main();
