"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { getSettings } from "@/features/settings-action";
import { RejectSubmissionInput } from "@/features/testing-approval-schema";
import type { TestingDocumentSubmission } from "@/lib/testing-approval";

type AdminClient = ReturnType<typeof createAdminClient>;

export type TestingSubmissionWithProject = TestingDocumentSubmission & { project_name: string };

type SubmissionRow = TestingDocumentSubmission & { projects: { name: string } | null };

export async function getTestingSubmissions(): Promise<TestingSubmissionWithProject[]> {
  await requireRole(["qa_lead", "head_of_qa", "project_manager"]);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("testing_document_submissions")
    .select("*, projects(name)")
    .order("submitted_at", { ascending: false });
  if (error) throw new Error(error.message);

  return ((data ?? []) as SubmissionRow[]).map(({ projects, ...submission }) => ({
    ...submission,
    project_name: projects?.name ?? "—",
  }));
}

export async function submitTestingDocument(projectId: string): Promise<{ success: true }> {
  const profile = await requireRole(["qa_lead"]);

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("name, approval_status, progress_percent")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Item not found");
  if (project.approval_status !== "approved") {
    throw new Error("Only an approved item can be submitted");
  }
  if (project.progress_percent !== 100) {
    throw new Error("Progress must reach 100% before submitting for approval");
  }

  const { count, error: pendingError } = await admin
    .from("testing_document_submissions")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "pending");
  if (pendingError) throw new Error(pendingError.message);
  if (count && count > 0) {
    throw new Error("This item already has a pending submission");
  }

  const { error } = await admin
    .from("testing_document_submissions")
    .insert({ project_id: projectId, submitted_by: profile.id });
  if (error) throw new Error(error.message);

  await notifyHeadsOfQa(admin, project.name, profile.name);

  return { success: true };
}

export async function approveTestingSubmission(id: string): Promise<{ success: true }> {
  const profile = await requireRole(["head_of_qa"]);

  const admin = createAdminClient();

  const { data: submission, error: fetchError } = await admin
    .from("testing_document_submissions")
    .select("status, project_id, submitted_by")
    .eq("id", id)
    .single();
  if (fetchError || !submission || submission.status !== "pending") {
    throw new Error("This submission is no longer pending");
  }

  const { error } = await admin
    .from("testing_document_submissions")
    .update({ status: "approved", decided_by: profile.id, decided_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await notifySubmitter(admin, submission.project_id, submission.submitted_by, "approved", null);

  return { success: true };
}

export async function rejectTestingSubmission(id: string, input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["head_of_qa"]);

  const parsed = RejectSubmissionInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: submission, error: fetchError } = await admin
    .from("testing_document_submissions")
    .select("status, project_id, submitted_by")
    .eq("id", id)
    .single();
  if (fetchError || !submission || submission.status !== "pending") {
    throw new Error("This submission is no longer pending");
  }

  const { error } = await admin
    .from("testing_document_submissions")
    .update({
      status: "rejected",
      decided_by: profile.id,
      decided_at: new Date().toISOString(),
      rejection_comment: parsed.data.comment,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await notifySubmitter(admin, submission.project_id, submission.submitted_by, "rejected", parsed.data.comment);

  return { success: true };
}

async function notifyHeadsOfQa(admin: AdminClient, projectName: string, submittedByName: string): Promise<void> {
  if (!(await getSettings()).email_notifications_enabled) return;

  const { data: heads } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "head_of_qa")
    .eq("is_active", true);

  for (const head of heads ?? []) {
    await sendEmail({
      to: head.email,
      subject: `Testing approval needed: ${projectName}`,
      html: `<p>${submittedByName} submitted <strong>${projectName}</strong> for testing document approval.</p>`,
    });
  }
}

async function notifySubmitter(
  admin: AdminClient,
  projectId: string,
  submittedBy: string,
  status: "approved" | "rejected",
  comment: string | null,
): Promise<void> {
  if (!(await getSettings()).email_notifications_enabled) return;

  const { data: project } = await admin.from("projects").select("name").eq("id", projectId).single();
  const { data: submitter } = await admin.from("profiles").select("email").eq("id", submittedBy).single();
  if (!project || !submitter) return;

  await sendEmail({
    to: submitter.email,
    subject: `Testing submission ${status}: ${project.name}`,
    html:
      status === "approved"
        ? `<p>Your testing document submission for <strong>${project.name}</strong> was approved.</p>`
        : `<p>Your testing document submission for <strong>${project.name}</strong> was rejected.</p><p>Comment: ${comment}</p>`,
  });
}
