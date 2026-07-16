"use server";

import { createClient } from "@/lib/supabase/server";
import { TestingTaskInput } from "@/features/testing-task-schema";
import type {
  TestingTask,
  TestingTaskPriority,
  TestingTaskStatus,
} from "@/lib/testing-task";

/**
 * Hapus testing task berdasarkan ID.
 */
export async function deleteTestingTask(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from("testing_tasks").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

/**
 * Buat testing task baru. Input divalidasi dengan Zod sebelum insert.
 */
export async function createTestingTask(input: unknown) {
  const parsed = TestingTaskInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Input tidak valid");
  }

  const supabase = await createClient();

  const { error } = await supabase.from("testing_tasks").insert({
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    status: parsed.data.status,
    priority: parsed.data.priority,
    start_date: parsed.data.start_date,
    due_date: parsed.data.due_date ?? null,
    total_tc: parsed.data.total_tc,
    ok_count: parsed.data.ok_count,
    nok_count: parsed.data.nok_count,
    na_count: parsed.data.na_count,
    total_execute_tc: parsed.data.total_execute_tc,
    total_passed_tc: parsed.data.total_passed_tc,
  });

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

/**
 * Perbarui testing task yang sudah ada. Input divalidasi dengan Zod.
 */
export async function updateTestingTask(id: string, input: unknown) {
  const parsed = TestingTaskInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Input tidak valid");
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("testing_tasks")
    .update({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      priority: parsed.data.priority,
      start_date: parsed.data.start_date,
      due_date: parsed.data.due_date ?? null,
      total_tc: parsed.data.total_tc,
      ok_count: parsed.data.ok_count,
      nok_count: parsed.data.nok_count,
      na_count: parsed.data.na_count,
      total_execute_tc: parsed.data.total_execute_tc,
      total_passed_tc: parsed.data.total_passed_tc,
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

/**
 * Ambil daftar testing task dengan pagination + filter opsional.
 * Urutan: start_date desc, lalu created_at desc (tie-breaker).
 */
export async function getTestingTasks({
  page = 1,
  limit = 10,
  search = "",
  status = "",
  priority = "",
}: {
  page?: number;
  limit?: number;
  search?: string;
  status?: TestingTaskStatus | "";
  priority?: TestingTaskPriority | "";
} = {}): Promise<{
  rows: TestingTask[];
  totalCount: number;
}> {
  const supabase = await createClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase.from("testing_tasks").select("*", { count: "exact" });

  const term = search.trim();
  if (term) {
    query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
  }
  if (status) {
    query = query.eq("status", status);
  }
  if (priority) {
    query = query.eq("priority", priority);
  }

  const { data, count } = await query
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  return { rows: (data ?? []) as TestingTask[], totalCount: count ?? 0 };
}
