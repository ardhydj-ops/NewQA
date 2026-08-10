"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProductInput } from "@/features/product-schema";
import type { ProductRow } from "@/lib/product";

export async function getProducts(): Promise<ProductRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("id, name").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductRow[];
}

function friendlyError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("A Product with that name already exists");
  return new Error(error.message);
}

export async function createProduct(input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProductInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("products").insert({ name: parsed.data.name });
  if (error) throw friendlyError(error);
  return { success: true };
}

export async function updateProduct(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProductInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("products").update({ name: parsed.data.name }).eq("id", id);
  if (error) throw friendlyError(error);
  return { success: true };
}

export async function deleteProduct(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);
  if (countError) throw new Error(countError.message);
  if (count && count > 0) {
    throw new Error(`Can't delete: ${count} project(s) use this product`);
  }

  const { error } = await admin.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
