"use server";

import ExcelJS from "exceljs";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { weekdaysBetween } from "@/lib/load";
import { QA_LEAD_ROLES } from "@/lib/profile";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type ImportRowOutcome = "created" | "staged" | "skipped" | "error";

export type ImportRowResult = {
  row: number;
  projectName: string;
  outcome: ImportRowOutcome;
  detail: string;
};

export type ImportProjectScheduleResult = {
  rows: ImportRowResult[];
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    if ("richText" in value) {
      return (value.richText as { text: string }[]).map((t) => t.text).join("").trim();
    }
    if ("text" in value) {
      return String((value as { text: unknown }).text).trim();
    }
  }
  return String(value).trim();
}

function parseExcelDate(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + value * 86400000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Every row becomes an approval-gated proposal, never a live change —
 * regardless of whether the uploader is a PM or a QA Lead/Head of QA —
 * since a bulk import carries more risk of typos/bad rows than a single
 * manual entry.
 */
export async function importProjectSchedule(file: File): Promise<ImportProjectScheduleResult> {
  const actor = await requireRole([...QA_LEAD_ROLES, "project_manager"]);

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Please upload an .xlsx file");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File is too large (max 5 MB)");
  }

  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error("Couldn't read this file — make sure it's a valid .xlsx workbook");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("The workbook has no worksheets");
  }

  const admin = createAdminClient();
  const results: ImportRowResult[] = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const name = cellText(row.getCell(1).value);
    const startRaw = row.getCell(2).value;
    const endRaw = row.getCell(3).value;

    if (!name && startRaw == null && endRaw == null) {
      continue;
    }

    if (!name) {
      results.push({ row: rowNumber, projectName: "", outcome: "error", detail: "Project Name is required" });
      continue;
    }

    const startDate = parseExcelDate(startRaw);
    const endDate = parseExcelDate(endRaw);
    if (!startDate || !endDate) {
      results.push({
        row: rowNumber,
        projectName: name,
        outcome: "error",
        detail: "Start Date / End Date is missing or invalid",
      });
      continue;
    }
    if (endDate < startDate) {
      results.push({ row: rowNumber, projectName: name, outcome: "error", detail: "End Date is before Start Date" });
      continue;
    }

    const { data: existing, error: lookupError } = await admin
      .from("projects")
      .select("id, approval_status, start_date, end_date, priority, proposed_start_date")
      .eq("name", name)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) {
      results.push({ row: rowNumber, projectName: name, outcome: "error", detail: lookupError.message });
      continue;
    }

    const treatAsNew = !existing || existing.approval_status === "rejected";

    if (treatAsNew) {
      const { error: insertError } = await admin.from("projects").insert({
        name,
        start_date: startDate,
        end_date: endDate,
        total_working_days: weekdaysBetween(startDate, endDate),
        item_type: "project",
        status: "to_do",
        priority: "medium",
        progress_percent: 0,
        jira_link: "",
        jiva_link: "",
        approval_status: "pending",
        proposed_by: actor.id,
      });
      if (insertError) {
        results.push({ row: rowNumber, projectName: name, outcome: "error", detail: insertError.message });
        continue;
      }
      results.push({ row: rowNumber, projectName: name, outcome: "created", detail: "New project proposal created" });
      continue;
    }

    if (existing.proposed_start_date !== null) {
      results.push({ row: rowNumber, projectName: name, outcome: "skipped", detail: "Already has a pending change" });
      continue;
    }

    if (existing.start_date === startDate && existing.end_date === endDate) {
      results.push({ row: rowNumber, projectName: name, outcome: "skipped", detail: "No change" });
      continue;
    }

    const { error: updateError } = await admin
      .from("projects")
      .update({
        proposed_start_date: startDate,
        proposed_end_date: endDate,
        proposed_total_working_days: weekdaysBetween(startDate, endDate),
        proposed_priority: existing.priority,
        change_proposed_by: actor.id,
        change_requested_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (updateError) {
      results.push({ row: rowNumber, projectName: name, outcome: "error", detail: updateError.message });
      continue;
    }
    results.push({ row: rowNumber, projectName: name, outcome: "staged", detail: "Rebaseline proposal staged" });
  }

  return { rows: results };
}
