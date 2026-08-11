import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  console.error("Run this script with: npx tsx --env-file=.env.local scripts/seed-qa-lead.ts");
  process.exit(1);
}

const [, , name, email, password] = process.argv;

if (!name || !email || !password) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/seed-qa-lead.ts \"Full Name\" email@example.com aStrongPassword123");
  process.exit(1);
}

async function main() {
  const admin = createClient(url!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser.user) {
    console.error("Failed to create auth user:", authError?.message);
    process.exit(1);
  }

  const { error: insertError } = await admin.from("profiles").insert({
    id: authUser.user.id,
    name,
    email,
    role: "qa_lead",
    capacity_days: 5,
  });

  if (insertError) {
    console.error("Failed to insert profile row:", insertError.message);
    await admin.auth.admin.deleteUser(authUser.user.id);
    process.exit(1);
  }

  console.log(`Created QA Lead "${name}" <${email}>. They can now sign in at /login.`);
}

main();
