# QA Resource Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the QA Resource Manager app from scratch in this empty repository — capacity, project, and allocation tracking for a QA team, with QA Lead / QA Member / Project Manager roles and a proposal/approval workflow, following `docs/superpowers/specs/2026-08-06-qa-resource-manager-design.md`.

**Architecture:** Next.js 16 App Router + Supabase (Postgres + Auth), following the same conventions as this repo's prior (now-deleted) codebase: `"use server"` action files per feature, Zod validation, TanStack React Query on the client calling server actions directly as query/mutation functions, shadcn/ui (Radix) components, sonner toasts. All writes go through a service-role Supabase client inside server actions (the DB has no write RLS policies — authorization is enforced by a `requireRole()` check, not Postgres).

**Tech Stack:** Next.js 16.2.6, React 19.2.4, TypeScript (strict), `@supabase/ssr` + `@supabase/supabase-js`, TanStack React Query 5, Zod 4, shadcn/ui (`radix-nova` style), Tailwind CSS 4, sonner.

## Global Constraints

- **No automated test framework** — this repo has none, and the prior similar feature (`testing-tasks-crud`) didn't introduce one either. Verification per task uses `npx tsc --noEmit` (type-check), `npx eslint <changed files>` (lint, scoped to touched files), and disposable `npx tsx` scratch scripts for pure-logic checks (deleted after use, never committed). One full end-to-end manual pass happens in the final task.
- **All INSERT/UPDATE/DELETE use `createAdminClient()`** (service-role, bypasses RLS) from `src/lib/supabase/admin.ts`. All SELECT reads use the regular cookie-scoped `createClient()` from `src/lib/supabase/server.ts` (relies on the "Authenticated read" RLS policy). Role authorization is enforced entirely by `requireRole()` in each server action, per the spec's "Roles & auth" section — never assume RLS is doing this.
- **Assignable testers are QA Lead + QA Member only.** Project Managers manage/propose but are never themselves assigned as a tester — `getAssignableProfiles()` and the Resource Dashboard's capacity/load calculations both filter `role in ('qa_lead','qa_member')`. This is an inferred rule (not stated verbatim in the spec) needed to make "assign testers" and "resource load" well-defined; flag it in review if it doesn't match intent.
- **No pagination anywhere.** Team Management, Project Portfolio, and Allocation Tool lists are unbounded — reasonable for a single internal QA team's dataset size (dozens of people/projects, not thousands). Unlike the old `transactions` feature, none of these lists paginate.
- **Light theme only**, no dark-mode toggle — the Kinetic Enterprise design system in `stitch_qa_resource_manager/kinetic_enterprise/DESIGN.md` is a single fixed "Enterprise Modern" look. Hand-written components use plain Tailwind color utilities with no `dark:` variants.
- **Email is immutable after user creation** — editing a profile never changes `email` (would require syncing `auth.users`, out of scope). The Team Management edit form omits the email field entirely.
- Dates are `YYYY-MM-DD` strings end-to-end (DB `date` columns, Zod `isoDate` pattern, HTML `<input type="date">`). Weeks are ISO weeks (Monday–Sunday, UTC).
- Migrations are applied manually via the Supabase Dashboard SQL Editor (no local Supabase CLI / service-role key wired into any migration tooling) — same as this repo's prior migrations.
- Comments in new code: none by default; only where a non-obvious constraint or workaround needs explaining (this repo's prior Indonesian-JSDoc-per-function convention is not carried over — this is a new, unrelated app).

---

### Task 1: Initialize the Next.js project and install dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `postcss.config.mjs`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/app/layout.tsx` (placeholder, replaced fully in Task 7)
- Create: `src/app/globals.css` (placeholder, replaced fully in Task 2)
- Create: `src/app/page.tsx` (placeholder, replaced fully in Task 7)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a runnable `npm run dev` Next.js app skeleton — every later task assumes `npm install` has been run and these config files exist unmodified except where a later task explicitly edits them.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "qa-resource-manager",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
  "dependencies": {
    "@supabase/ssr": "^0.12.0",
    "@supabase/supabase-js": "^2.108.1",
    "@tanstack/react-query": "^5.101.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.17.0",
    "next": "16.2.6",
    "radix-ui": "^1.5.0",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "server-only": "^0.0.1",
    "shadcn": "^4.11.0",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.6.0",
    "tw-animate-css": "^1.4.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "babel-plugin-react-compiler": "1.0.0",
    "eslint": "^9",
    "eslint-config-next": "16.2.6",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
```

- [ ] **Step 4: Write `eslint.config.mjs`**

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
```

- [ ] **Step 5: Write `postcss.config.mjs`**

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 6: Write `.gitignore`**

```gitignore
# dependencies
/node_modules
/.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# env files (can opt-in for committing if needed)
.env*
!.env.example

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts

# git worktrees
/.worktrees
```

- [ ] **Step 7: Write `.env.example`**

```dotenv
# Copy this file to `.env.local` and fill in real values.
# `.env.local` is git-ignored — never commit it.

# Supabase project URL — Settings -> API -> Project URL
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co

# Publishable API key — Settings -> API -> Publishable keys (starts with sb_publishable_...)
# Safe to expose to the browser; access is restricted by RLS + server-action role checks.
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...your-publishable-key...

# Service role key — Settings -> API -> Service role key (starts with sb_secret_... or is a long JWT)
# NEVER expose this to the browser. Server-only: used to create Auth users and to bypass
# RLS for writes, since this app has no client-side write policies.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key...
```

- [ ] **Step 8: Write placeholder root files**

`src/app/globals.css`:

```css
@import "tailwindcss";
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QA Resource Manager",
  description: "Capacity and allocation tracking for QA teams",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:

```tsx
export default function RootPage() {
  return <div>QA Resource Manager</div>;
}
```

- [ ] **Step 9: Install dependencies**

Run: `npm install`
Expected: installs without error, creates `package-lock.json` and `node_modules/`.

- [ ] **Step 10: Verify the dev server boots**

Run: `npm run dev` (in the background, or run and then Ctrl+C after confirming), visit `http://localhost:3000`.
Expected: page loads showing "QA Resource Manager", no console errors.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts eslint.config.mjs postcss.config.mjs .gitignore .env.example src/app/layout.tsx src/app/globals.css src/app/page.tsx
git commit -m "chore: initialize Next.js project"
```

---

### Task 2: Tailwind theme (Kinetic Enterprise) + shadcn UI primitives

**Files:**
- Create: `components.json`
- Modify: `src/app/globals.css`
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/button.tsx`, `card.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `separator.tsx`, `sidebar.tsx`, `skeleton.tsx`, `sonner.tsx`, `table.tsx`, `textarea.tsx`, `badge.tsx`, `tooltip.tsx`
- Create: `src/hooks/use-mobile.ts`
- Create: `src/components/ui/load-bar.tsx`
- Create: `src/components/ui/progress-bar.tsx`

**Interfaces:**
- Consumes: Task 1's Tailwind/PostCSS setup.
- Produces: the full shadcn/ui component set every later UI task imports from `@/components/ui/*`; `cn()` from `@/lib/utils`; `ProgressBar` (`{ percent: number; className?: string }`) from `@/components/ui/progress-bar`, first consumed by Task 15; `LoadBar` (`{ percent: number; className?: string }`) from `@/components/ui/load-bar`, first consumed by Task 18.

- [ ] **Step 1: Write `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "radix-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "rtl": false,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "menuColor": "default",
  "menuAccent": "subtle",
  "registries": {}
}
```

- [ ] **Step 2: Run shadcn init to scaffold the UI primitives**

Run: `npx shadcn@latest add button card dialog alert-dialog dropdown-menu input label select separator sidebar skeleton sonner table textarea badge tooltip`
Expected: creates `src/components/ui/*.tsx` for each of those components, `src/hooks/use-mobile.ts` (used internally by `sidebar.tsx`), and `src/lib/utils.ts` with a `cn()` helper. If the CLI asks about `globals.css`/Tailwind setup, accept its defaults — Step 3 below overwrites the theme tokens afterward regardless.

- [ ] **Step 3: Replace `src/app/globals.css` with the Kinetic Enterprise theme**

Tokens sourced from `stitch_qa_resource_manager/kinetic_enterprise/DESIGN.md` (front-matter `colors:` block), converted to the shadcn CSS-variable contract. Light theme only — no `.dark` block.

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-sans);
  --font-heading: var(--font-sans);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
}

:root {
  --background: #fcf8fa;
  --foreground: #1b1b1d;
  --card: #ffffff;
  --card-foreground: #1b1b1d;
  --popover: #ffffff;
  --popover-foreground: #1b1b1d;
  --primary: #131b2e;
  --primary-foreground: #ffffff;
  --secondary: #f0edef;
  --secondary-foreground: #1b1b1d;
  --muted: #f6f3f5;
  --muted-foreground: #45464d;
  --accent: #eae7e9;
  --accent-foreground: #1b1b1d;
  --destructive: #ba1a1a;
  --border: #c6c6cd;
  --input: #c6c6cd;
  --ring: #0058be;
  --radius: 0.25rem;
  --sidebar: #131b2e;
  --sidebar-foreground: #f3f0f2;
  --sidebar-primary: #0058be;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #2170e4;
  --sidebar-accent-foreground: #ffffff;
  --sidebar-border: #3f465c;
  --sidebar-ring: #0058be;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

- [ ] **Step 4: Write the semantic `LoadBar` component**

`src/components/ui/load-bar.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { loadStatus, type LoadStatus } from "@/lib/load";

const FILL_CLASS: Record<LoadStatus, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  critical: "bg-rose-600",
};

const TEXT_CLASS: Record<LoadStatus, string> = {
  ok: "text-emerald-700",
  warn: "text-amber-700",
  critical: "text-rose-700",
};

type LoadBarProps = {
  percent: number;
  className?: string;
};

export function LoadBar({ percent, className }: LoadBarProps) {
  const status = loadStatus(percent);
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-2 flex-1 rounded-full bg-slate-200">
        <div className={cn("h-2 rounded-full", FILL_CLASS[status])} style={{ width: `${width}%` }} />
      </div>
      <span className={cn("w-12 text-right text-sm font-semibold tabular-nums", TEXT_CLASS[status])}>
        {Math.round(percent)}%
      </span>
    </div>
  );
}
```

Note: this imports `loadStatus` from `@/lib/load`, which does not exist until Task 7. That's fine — this file is not imported by anything until Task 21 (Dashboard UI) and Task 18 (Allocation Tool UI), both after Task 7. `tsc --noEmit` in this task's Step 6 will fail on this import; that's expected and checked explicitly below rather than silently ignored.

- [ ] **Step 5: Write the generic `ProgressBar` component**

`src/components/ui/progress-bar.tsx`:

```tsx
import { cn } from "@/lib/utils";

type ProgressBarProps = {
  percent: number;
  className?: string;
};

export function ProgressBar({ percent, className }: ProgressBarProps) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-2 w-24 rounded-full bg-slate-200">
        <div className="h-2 rounded-full bg-blue-600" style={{ width: `${width}%` }} />
      </div>
      <span className="w-10 text-right text-sm tabular-nums text-slate-600">{Math.round(width)}%</span>
    </div>
  );
}
```

- [ ] **Step 6: Type-check and confirm the expected pre-Task-10 error**

Run: `npx tsc --noEmit`
Expected: exactly one error, in `src/components/ui/load-bar.tsx`, `Cannot find module '@/lib/load'`. No other errors. (This file resolves cleanly once Task 7 lands.)

- [ ] **Step 7: Commit**

```bash
git add components.json src/app/globals.css src/lib/utils.ts src/components/ui src/hooks/use-mobile.ts
git commit -m "feat: add Kinetic Enterprise theme and shadcn UI primitives"
```

---

### Task 3: Supabase project setup and environment variables

**Files:**
- Modify: `.env.local` (git-ignored, created manually — not committed)

**Interfaces:**
- Consumes: `.env.example` from Task 1.
- Produces: three environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) that every Supabase client (Task 4) and every server action reads via `process.env`.

This task is entirely manual setup — there is no code to write.

- [ ] **Step 1: Create a Supabase project**

Go to https://supabase.com/dashboard, create a new project (any name/region — e.g. "qa-resource-manager"). Wait for provisioning to finish (a couple of minutes).

- [ ] **Step 2: Collect the three keys**

In the project dashboard: Settings -> API.
- Copy **Project URL** -> this is `NEXT_PUBLIC_SUPABASE_URL`.
- Copy the **Publishable key** (starts `sb_publishable_...`) -> this is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Copy the **Service role key** (secret, starts `sb_secret_...` or is a long JWT — do not confuse with the publishable key) -> this is `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 3: Write `.env.local`**

At the repo root, create `.env.local` (already git-ignored per Task 1's `.gitignore`):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-actual-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_actual_key
SUPABASE_SERVICE_ROLE_KEY=your_actual_service_role_key
```

- [ ] **Step 4: Verify it's ignored by git**

Run: `git status --short`
Expected: `.env.local` does **not** appear in the output (confirms `.gitignore` is working — never commit this file).

No commit for this task — nothing here is tracked by git.

---

### Task 4: Supabase clients (browser, server, proxy, admin)

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/middleware.ts`
- Create: `src/lib/supabase/admin.ts`
- Create: `src/proxy.ts`

**Interfaces:**
- Consumes: Task 3's env vars.
- Produces: `createClient()` (sync) from `@/lib/supabase/client` for client components; `createClient()` (async, `Promise<SupabaseClient>`) from `@/lib/supabase/server` for server components/actions — consumed by every server action starting Task 12; `createAdminClient()` (sync) from `@/lib/supabase/admin` — consumed by every write-performing server action starting Task 12.

- [ ] **Step 1: Write the browser client**

`src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

- [ ] **Step 2: Write the server client**

`src/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render — safe to ignore when
            // the proxy also refreshes the session on every request.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Write the session-refresh middleware helper**

`src/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Required: triggers token refresh and cookie sync on every request.
  await supabase.auth.getUser();

  return supabaseResponse;
}
```

- [ ] **Step 4: Write `src/proxy.ts`**

```ts
import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
```

- [ ] **Step 5: Write the admin (service-role) client**

`src/lib/supabase/admin.ts`:

```ts
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS entirely. Only ever call this from
 * inside a "use server" action, after a `requireRole()` check.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error as Task 2 (`@/lib/load` not found in `load-bar.tsx`), no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase src/proxy.ts
git commit -m "feat: add Supabase browser, server, admin, and proxy clients"
```

---

### Task 5: Database migration

**Files:**
- Create: `supabase/migrations/0001_qa_resource_manager.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `public.profiles`, `public.projects`, `public.allocations` with the exact columns below — every later server action's `.select()`/`.insert()`/`.update()` calls depend on these exact names and types.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0001_qa_resource_manager.sql`:

```sql
-- QA Resource Manager — initial schema.
-- Run via Supabase Dashboard -> SQL Editor -> paste -> Run.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  email           text not null unique,
  role            text not null check (role in ('qa_lead','qa_member','project_manager')),
  qa_group        text check (qa_group in
                  ('qris_h2h','qris_bo','digital_h2h','digital_bo','corporate_it')),
  capacity_hours  numeric not null default 40 check (capacity_hours > 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now())
);

create table if not exists public.projects (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  start_date        date not null,
  end_date          date,
  product           text not null check (product in
                    ('qris_h2h','qris_bo','qrcb','pi','jv','ccw')),
  status            text not null default 'to_do' check (status in
                    ('to_do','ready_sit','sit','ready_uat','uat','completed')),
  progress_percent  integer not null default 0 check (progress_percent between 0 and 100),
  approval_status   text not null default 'approved' check (approval_status in
                    ('pending','approved','rejected')),
  proposed_by       uuid references public.profiles(id),
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

create table if not exists public.allocations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,
  role_on_project  text not null,
  hours_per_week   numeric not null check (hours_per_week > 0),
  start_date       date not null,
  end_date         date,
  approval_status  text not null default 'approved' check (approval_status in
                   ('pending','approved','rejected')),
  proposed_by      uuid references public.profiles(id),
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

create index if not exists allocations_user_idx on public.allocations (user_id);
create index if not exists allocations_project_idx on public.allocations (project_id);
create index if not exists allocations_date_range_idx on public.allocations (start_date, end_date);
create index if not exists projects_approval_status_idx on public.projects (approval_status);
create index if not exists allocations_approval_status_idx on public.allocations (approval_status);

-- updated_at auto-bump on every UPDATE, for all three tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists allocations_set_updated_at on public.allocations;
create trigger allocations_set_updated_at
  before update on public.allocations
  for each row execute function public.set_updated_at();

-- RLS — read-only for authenticated users. All writes go through the
-- service-role client in server actions (see src/lib/supabase/admin.ts);
-- there are deliberately no INSERT/UPDATE/DELETE policies.
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.allocations enable row level security;

create policy "Authenticated read" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.projects
  for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.allocations
  for select using (auth.role() = 'authenticated');
```

- [ ] **Step 2: Apply the migration**

Supabase Dashboard (the same project created in Task 3) -> SQL Editor -> paste the full file contents -> Run.
Expected: no errors. Then Table Editor -> confirm `profiles`, `projects`, and `allocations` all exist with the columns listed above.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_qa_resource_manager.sql
git commit -m "feat: add profiles, projects, and allocations schema"
```

---

### Task 6: Shared types

**Files:**
- Create: `src/lib/profile.ts`
- Create: `src/lib/project.ts`
- Create: `src/lib/allocation.ts`

**Interfaces:**
- Consumes: nothing (pure types, mirroring Task 5's columns).
- Produces: `Profile`, `ProfileRole`, `QaGroup` from `@/lib/profile`; `Project`, `Product`, `ProjectStatus`, `ApprovalStatus` from `@/lib/project`; `Allocation` from `@/lib/allocation`. Consumed by every task from Task 7 onward.

- [ ] **Step 1: Write `src/lib/profile.ts`**

```ts
export type ProfileRole = "qa_lead" | "qa_member" | "project_manager";

export type QaGroup =
  | "qris_h2h"
  | "qris_bo"
  | "digital_h2h"
  | "digital_bo"
  | "corporate_it";

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: ProfileRole;
  qa_group: QaGroup | null;
  capacity_hours: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Write `src/lib/project.ts`**

```ts
export type Product = "qris_h2h" | "qris_bo" | "qrcb" | "pi" | "jv" | "ccw";

export type ProjectStatus =
  | "to_do"
  | "ready_sit"
  | "sit"
  | "ready_uat"
  | "uat"
  | "completed";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type Project = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  product: Product;
  status: ProjectStatus;
  progress_percent: number;
  approval_status: ApprovalStatus;
  proposed_by: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 3: Write `src/lib/allocation.ts`**

```ts
import type { ApprovalStatus } from "@/lib/project";

export type Allocation = {
  id: string;
  user_id: string;
  project_id: string;
  role_on_project: string;
  hours_per_week: number;
  start_date: string;
  end_date: string | null;
  approval_status: ApprovalStatus;
  proposed_by: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error as Task 4 (`@/lib/load` not found in `load-bar.tsx`), no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profile.ts src/lib/project.ts src/lib/allocation.ts
git commit -m "feat: add Profile, Project, and Allocation types"
```

---

### Task 7: Load calculation helpers

**Files:**
- Create: `src/lib/load.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no DB/React dependency).
- Produces: `isoWeekRange(date: Date): DateRange`, `monthRange(year: number, monthIndex0: number): DateRange`, `weeklyHoursForUser(allocations, userId, week): number`, `weeklyLoadPercent(allocatedHours, capacityHours): number`, `loadStatus(percent): LoadStatus`, `monthlyHoursForUser(allocations, userId, month): number`, `monthlyHoursForProject(allocations, projectId, month): number`, and types `DateRange`, `AllocationForCalc`, `LoadStatus` — all from `@/lib/load`. `loadStatus`/`LoadStatus` are consumed by `src/components/ui/load-bar.tsx` (Task 2, forward reference now resolved); everything else is consumed starting Task 17 (Dashboard server actions).

- [ ] **Step 1: Write `src/lib/load.ts`**

```ts
export type DateRange = { start: string; end: string };

export type AllocationForCalc = {
  user_id: string;
  project_id: string;
  hours_per_week: number;
  start_date: string;
  end_date: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUTCDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function formatISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday..Sunday range containing `date` (UTC). */
export function isoWeekRange(date: Date): DateRange {
  const day = date.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: formatISODate(monday), end: formatISODate(sunday) };
}

/** First..last calendar day of the given month (0-indexed, UTC). */
export function monthRange(year: number, monthIndex0: number): DateRange {
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const last = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  return { start: formatISODate(first), end: formatISODate(last) };
}

function overlapsRange(allocation: AllocationForCalc, range: DateRange): boolean {
  const allocEnd = allocation.end_date ?? range.end;
  return allocation.start_date <= range.end && allocEnd >= range.start;
}

/** Inclusive day count where `allocation` overlaps `range`; 0 if no overlap. */
function overlapDays(allocation: AllocationForCalc, range: DateRange): number {
  const allocEnd = allocation.end_date ?? range.end;
  const start = allocation.start_date > range.start ? allocation.start_date : range.start;
  const end = allocEnd < range.end ? allocEnd : range.end;
  if (start > end) return 0;
  return Math.round((toUTCDate(end).getTime() - toUTCDate(start).getTime()) / MS_PER_DAY) + 1;
}

export function weeklyHoursForUser(
  allocations: AllocationForCalc[],
  userId: string,
  week: DateRange,
): number {
  return allocations
    .filter((a) => a.user_id === userId && overlapsRange(a, week))
    .reduce((sum, a) => sum + a.hours_per_week, 0);
}

export function weeklyLoadPercent(allocatedHours: number, capacityHours: number): number {
  if (capacityHours <= 0) return 0;
  return (allocatedHours / capacityHours) * 100;
}

export type LoadStatus = "ok" | "warn" | "critical";

export function loadStatus(percent: number): LoadStatus {
  if (percent > 100) return "critical";
  if (percent >= 80) return "warn";
  return "ok";
}

/** Hours in `month`, prorated by day (hours_per_week / 7 * overlap days). */
export function monthlyHoursForUser(
  allocations: AllocationForCalc[],
  userId: string,
  month: DateRange,
): number {
  return allocations
    .filter((a) => a.user_id === userId)
    .reduce((sum, a) => sum + (a.hours_per_week / 7) * overlapDays(a, month), 0);
}

export function monthlyHoursForProject(
  allocations: AllocationForCalc[],
  projectId: string,
  month: DateRange,
): number {
  return allocations
    .filter((a) => a.project_id === projectId)
    .reduce((sum, a) => sum + (a.hours_per_week / 7) * overlapDays(a, month), 0);
}
```

- [ ] **Step 2: Write and run a scratch verification script**

Create `scratch-verify-load.ts` at the repo root (temporary, not committed):

```ts
import {
  isoWeekRange,
  monthRange,
  weeklyHoursForUser,
  weeklyLoadPercent,
  loadStatus,
  monthlyHoursForUser,
  monthlyHoursForProject,
  type AllocationForCalc,
} from "@/lib/load";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// isoWeekRange: Wednesday 2026-08-05 -> Monday..Sunday of that week.
const week = isoWeekRange(new Date("2026-08-05T00:00:00Z"));
assertEqual(week, { start: "2026-08-03", end: "2026-08-09" }, "isoWeekRange mid-week");

// isoWeekRange: Sunday itself -> still that same Mon..Sun week.
const weekFromSunday = isoWeekRange(new Date("2026-08-09T00:00:00Z"));
assertEqual(weekFromSunday, { start: "2026-08-03", end: "2026-08-09" }, "isoWeekRange on Sunday");

// monthRange: August 2026 (31 days).
assertEqual(monthRange(2026, 7), { start: "2026-08-01", end: "2026-08-31" }, "monthRange August");

const allocations: AllocationForCalc[] = [
  // Fully inside the week, ongoing (no end_date).
  { user_id: "u1", project_id: "p1", hours_per_week: 20, start_date: "2026-07-01", end_date: null },
  // Starts mid-week -> still counts (weekly hours don't prorate, full week value).
  { user_id: "u1", project_id: "p2", hours_per_week: 10, start_date: "2026-08-06", end_date: "2026-08-20" },
  // Ended before the week starts -> excluded.
  { user_id: "u1", project_id: "p3", hours_per_week: 99, start_date: "2026-01-01", end_date: "2026-08-02" },
  // Different user -> excluded.
  { user_id: "u2", project_id: "p1", hours_per_week: 40, start_date: "2026-07-01", end_date: null },
];

assertEqual(weeklyHoursForUser(allocations, "u1", week), 30, "weeklyHoursForUser u1");
assertEqual(weeklyHoursForUser(allocations, "u2", week), 40, "weeklyHoursForUser u2");
assertEqual(weeklyHoursForUser(allocations, "u3", week), 0, "weeklyHoursForUser missing user");

assertEqual(weeklyLoadPercent(30, 40), 75, "weeklyLoadPercent 30/40");
assertEqual(weeklyLoadPercent(10, 0), 0, "weeklyLoadPercent zero capacity guard");

assertEqual(loadStatus(79.9), "ok", "loadStatus 79.9 -> ok");
assertEqual(loadStatus(80), "warn", "loadStatus 80 -> warn");
assertEqual(loadStatus(100), "warn", "loadStatus 100 -> warn");
assertEqual(loadStatus(100.1), "critical", "loadStatus 100.1 -> critical");

// Monthly proration: a 14-hrs/week allocation spanning exactly Aug 1-14 (14 days)
// of a 31-day August contributes 14/7 * 14 = 28 hours, not the full month's worth.
const augustMonth = monthRange(2026, 7);
const partialMonthAllocations: AllocationForCalc[] = [
  { user_id: "u1", project_id: "p1", hours_per_week: 14, start_date: "2026-08-01", end_date: "2026-08-14" },
  // Open-ended, started before the month -> counts for the full month (31 days).
  { user_id: "u1", project_id: "p2", hours_per_week: 7, start_date: "2026-01-01", end_date: null },
];
assertEqual(
  Math.round(monthlyHoursForUser(partialMonthAllocations, "u1", augustMonth)),
  28 + 31,
  "monthlyHoursForUser partial + open-ended",
);
assertEqual(
  Math.round(monthlyHoursForProject(partialMonthAllocations, "p1", augustMonth)),
  28,
  "monthlyHoursForProject partial",
);

console.log("OK: load.ts passes all cases");
```

Run: `npx tsx scratch-verify-load.ts`
Expected: prints `OK: load.ts passes all cases`, exits 0. If any assertion throws, fix `src/lib/load.ts` and re-run — do not edit the scratch script's expected values to match broken output.

- [ ] **Step 3: Delete the scratch script**

```bash
rm scratch-verify-load.ts
```

- [ ] **Step 4: Type-check — this is the task where the Task 2 placeholder error resolves**

Run: `npx tsc --noEmit`
Expected: **zero errors** (the `@/lib/load` import in `src/components/ui/load-bar.tsx` now resolves).

- [ ] **Step 5: Commit**

```bash
git add src/lib/load.ts
git commit -m "feat: add weekly/monthly load calculation helpers"
```

---

### Task 8: Auth core — session helpers, sign-in/out actions, login page

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/features/auth-action.ts`
- Create: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/server` (Task 4), `Profile`/`ProfileRole` from `@/lib/profile` (Task 6).
- Produces: `getCurrentProfile(): Promise<Profile | null>` and `requireRole(allowed: ProfileRole[]): Promise<Profile>` from `@/lib/auth` — `requireRole` throws `Error` if unauthenticated, deactivated, or role not in `allowed`; consumed by every write-performing server action from Task 12 onward. `signIn(formData: FormData)` and `signOut()` from `@/features/auth-action`, consumed by Task 9's `AppShell`/`SignOutButton` and this task's login page.

- [ ] **Step 1: Write `src/lib/auth.ts`**

```ts
import { createClient } from "@/lib/supabase/server";
import type { Profile, ProfileRole } from "@/lib/profile";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (data as Profile) ?? null;
}

export async function requireRole(allowed: ProfileRole[]): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in");
  if (!profile.is_active) throw new Error("This account has been deactivated");
  if (!allowed.includes(profile.role)) throw new Error("You are not authorized to do this");
  return profile;
}
```

- [ ] **Step 2: Write `src/features/auth-action.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData): Promise<{ error: string } | undefined> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "Invalid email or password" };
  }

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 3: Write the login page**

`src/app/login/page.tsx`:

```tsx
"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/features/auth-action";

type LoginState = { error: string } | null;

async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const result = await signIn(formData);
  return result ?? null;
}

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight">QA Resource Manager</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {state?.error && <p className="text-sm text-rose-600">{state.error}</p>}
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/features/auth-action.ts src/app/login
git commit -m "feat: add auth session helpers, sign-in/out actions, and login page"
```

---

### Task 9: App shell and role-gated navigation

**Files:**
- Create: `src/components/app-sidebar.tsx`
- Create: `src/components/sign-out-button.tsx`
- Create: `src/components/app-shell.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/providers/query-provider.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `getCurrentProfile` (Task 8), `signOut` (Task 8), `Profile`/`ProfileRole` (Task 6), shadcn sidebar/separator/sonner primitives (Task 2).
- Produces: the `(app)` route group layout that every page task (13, 15, 18, 20, 21) renders inside — those pages are placed at `src/app/(app)/<route>/page.tsx` and can assume `getCurrentProfile()` will return non-null (already redirected otherwise) and that they render inside `<AppShell>`. `QueryProvider` from `@/providers/query-provider`, wrapping the whole app.

- [ ] **Step 1: Write the React Query provider**

`src/providers/query-provider.tsx`:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const isServer = typeof window === "undefined";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (isServer) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 2: Write the role-gated sidebar**

`src/components/app-sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckSquare,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  Users,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { Profile, ProfileRole } from "@/lib/profile";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: ProfileRole[];
};

const ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Resource Dashboard",
    icon: LayoutDashboard,
    roles: ["qa_lead", "qa_member", "project_manager"],
  },
  {
    href: "/team",
    label: "Team Management",
    icon: Users,
    roles: ["qa_lead", "qa_member", "project_manager"],
  },
  {
    href: "/projects",
    label: "Project Portfolio",
    icon: ClipboardList,
    roles: ["qa_lead", "qa_member", "project_manager"],
  },
  {
    href: "/allocations",
    label: "Allocation Tool",
    icon: ListChecks,
    roles: ["qa_lead", "qa_member", "project_manager"],
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: CheckSquare,
    roles: ["qa_lead"],
  },
];

export function AppSidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const items = ITEMS.filter((item) => item.roles.includes(profile.role));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LayoutDashboard className="size-4" />
          </div>
          <span className="text-base font-semibold tracking-tight text-white group-data-[collapsible=icon]:hidden">
            QA Resource Manager
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href}>
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
```

- [ ] **Step 3: Write the sign-out button**

`src/components/sign-out-button.tsx`:

```tsx
"use client";

import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth-action";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
        <LogOut className="size-4" />
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Write the app shell**

`src/components/app-shell.tsx`:

```tsx
"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { SignOutButton } from "@/components/sign-out-button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import type { Profile } from "@/lib/profile";

const ROLE_LABEL: Record<Profile["role"], string> = {
  qa_lead: "QA Lead",
  qa_member: "QA Member",
  project_manager: "Project Manager",
};

export function AppShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar profile={profile} />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right text-sm">
                <div className="font-medium">{profile.name}</div>
                <div className="text-xs text-muted-foreground">{ROLE_LABEL[profile.role]}</div>
              </div>
              <SignOutButton />
            </div>
          </header>
          <main className="flex-1 p-6">{children}</main>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  );
}
```

Note (found during implementation, not in the original plan text): `SidebarMenuButton`'s `tooltip` prop renders shadcn's `Tooltip`, which throws at runtime ("`Tooltip` must be used within `TooltipProvider`") unless wrapped — add `import { TooltipProvider } from "@/components/ui/tooltip";` and wrap the return value as shown above.

- [ ] **Step 5: Write the `(app)` route group layout**

`src/app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) {
    redirect("/login");
  }

  return <AppShell profile={profile}>{children}</AppShell>;
}
```

- [ ] **Step 6: Update the root layout to wrap everything in `QueryProvider`**

Replace `src/app/layout.tsx` (from Task 1's placeholder) with:

```tsx
import type { Metadata } from "next";
import "./globals.css";

import { QueryProvider } from "@/providers/query-provider";

export const metadata: Metadata = {
  title: "QA Resource Manager",
  description: "Capacity and allocation tracking for QA teams",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Update the root page to redirect into the app**

Replace `src/app/page.tsx` (from Task 1's placeholder) with:

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/dashboard");
}
```

(`/dashboard` doesn't exist as a route until Task 21, and `(app)/layout.tsx` doesn't exist until this task's Step 5 creates the route group — but the group itself has no `page.tsx` at `/dashboard` yet, so this redirect will 404 until Task 21. That's expected and reconciled in Task 21's verification step, not here.)

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/app-sidebar.tsx src/components/sign-out-button.tsx src/components/app-shell.tsx "src/app/(app)/layout.tsx" src/providers/query-provider.tsx src/app/layout.tsx src/app/page.tsx
git commit -m "feat: add role-gated app shell and navigation"
```

---

### Task 10: Seed the first QA Lead

**Files:**
- Create: `scripts/seed-qa-lead.ts`

**Interfaces:**
- Consumes: `.env.local` (Task 3) via Node's `--env-file` flag — deliberately does **not** import from `@/lib/supabase/admin` (that file's `server-only` guard and the `@/*` path alias are not reliably resolved when run standalone via `tsx` outside the Next.js build).
- Produces: exactly one `profiles` row with `role = 'qa_lead'` plus a matching `auth.users` row — the login credential every subsequent manual verification step (Task 22, and any earlier ad hoc manual check) uses to get into the app in the first place, since Team Management (Task 13) requires an existing QA Lead to create any other user.

- [ ] **Step 1: Write the seed script**

`scripts/seed-qa-lead.ts`:

```ts
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
    capacity_hours: 40,
  });

  if (insertError) {
    console.error("Failed to insert profile row:", insertError.message);
    await admin.auth.admin.deleteUser(authUser.user.id);
    process.exit(1);
  }

  console.log(`Created QA Lead "${name}" <${email}>. They can now sign in at /login.`);
}

main();
```

- [ ] **Step 2: Run it once against the real Supabase project**

Run: `npx tsx --env-file=.env.local scripts/seed-qa-lead.ts "Your Name" you@example.com "ChooseAStrongPassword123"`
Expected: prints `Created QA Lead "Your Name" <you@example.com>. They can now sign in at /login.` Then in the Supabase Dashboard, Table Editor -> `profiles`, confirm one row exists with `role = 'qa_lead'`.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-qa-lead.ts
git commit -m "feat: add first-QA-Lead seed script"
```

---

### Task 11: Zod validation schemas

**Files:**
- Create: `src/features/profile-schema.ts`
- Create: `src/features/project-schema.ts`
- Create: `src/features/allocation-schema.ts`

**Interfaces:**
- Consumes: nothing beyond `zod`.
- Produces: `ProfileInput`, `ProfileUpdateInput` (types + Zod objects) from `@/features/profile-schema`, consumed by Task 12. `ProjectInput`, `ProposedAllocationInput`, `ProjectProposalInput` from `@/features/project-schema`, consumed by Task 14. `AllocationInput` from `@/features/allocation-schema`, consumed by Task 16.

- [ ] **Step 1: Write `src/features/profile-schema.ts`**

```ts
import { z } from "zod";

export const ProfileInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  role: z.enum(["qa_lead", "qa_member", "project_manager"]),
  qa_group: z
    .enum(["qris_h2h", "qris_bo", "digital_h2h", "digital_bo", "corporate_it"])
    .optional(),
  capacity_hours: z.number().positive("Capacity must be greater than 0"),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

// Editing never changes email (would require syncing auth.users separately).
export const ProfileUpdateInput = ProfileInput.omit({ email: true });
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateInput>;
```

- [ ] **Step 2: Write `src/features/project-schema.ts`**

```ts
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

export const ProjectInput = z.object({
  name: z.string().trim().min(1, "Project name is required"),
  start_date: isoDate,
  end_date: isoDate.optional(),
  product: z.enum(["qris_h2h", "qris_bo", "qrcb", "pi", "jv", "ccw"]),
  status: z.enum(["to_do", "ready_sit", "sit", "ready_uat", "uat", "completed"]),
  progress_percent: z.number().int().min(0).max(100),
});
export type ProjectInput = z.infer<typeof ProjectInput>;

export const ProposedAllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  hours_per_week: z.number().positive("Hours must be greater than 0"),
  start_date: isoDate,
  end_date: isoDate.optional(),
});
export type ProposedAllocationInput = z.infer<typeof ProposedAllocationInput>;

export const ProjectProposalInput = z.object({
  project: ProjectInput,
  allocations: z.array(ProposedAllocationInput).min(1, "Add at least one tester assignment"),
});
export type ProjectProposalInput = z.infer<typeof ProjectProposalInput>;
```

- [ ] **Step 3: Write `src/features/allocation-schema.ts`**

```ts
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

export const AllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  project_id: z.string().uuid("Select a project"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  hours_per_week: z.number().positive("Hours must be greater than 0"),
  start_date: isoDate,
  end_date: isoDate.optional(),
});
export type AllocationInput = z.infer<typeof AllocationInput>;
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/profile-schema.ts src/features/project-schema.ts src/features/allocation-schema.ts
git commit -m "feat: add Zod schemas for profiles, projects, and allocations"
```

---

### Task 12: Team Management server actions

**Files:**
- Create: `src/features/profile-action.ts`

**Interfaces:**
- Consumes: `createClient` (Task 4 server client), `createAdminClient` (Task 4), `requireRole` (Task 8), `ProfileInput`/`ProfileUpdateInput` (Task 11), `Profile`/`ProfileRole` (Task 6).
- Produces: `getProfiles(): Promise<Profile[]>`, `getAssignableProfiles(): Promise<Profile[]>` (active `qa_lead`/`qa_member` only — the "assignable testers" rule from Global Constraints), `createProfile(input: unknown): Promise<{ profile: Profile; tempPassword: string }>`, `updateProfile(id: string, input: unknown): Promise<{ success: true }>`, `setProfileActive(id: string, isActive: boolean): Promise<{ success: true }>` — all from `@/features/profile-action`. `getAssignableProfiles` is consumed by Task 15's propose-project dialog (the Allocation Tool's resource picker instead reuses `getWeeklyDashboard`'s `resourceLoad`, already filtered the same way — see Task 17); the rest starting Task 13.

- [ ] **Step 1: Write `src/features/profile-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProfileInput, ProfileUpdateInput } from "@/features/profile-schema";
import type { Profile } from "@/lib/profile";

function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return password;
}

export async function getProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("*").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function getAssignableProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .in("role", ["qa_lead", "qa_member"])
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function createProfile(
  input: unknown,
): Promise<{ profile: Profile; tempPassword: string }> {
  await requireRole(["qa_lead"]);

  const parsed = ProfileInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const tempPassword = generateTempPassword();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    throw new Error(authError?.message ?? "Failed to create a login for this user");
  }

  const { data: profile, error: insertError } = await admin
    .from("profiles")
    .insert({
      id: authUser.user.id,
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      qa_group: parsed.data.qa_group ?? null,
      capacity_hours: parsed.data.capacity_hours,
    })
    .select("*")
    .single();

  if (insertError || !profile) {
    await admin.auth.admin.deleteUser(authUser.user.id);
    throw new Error(insertError?.message ?? "Failed to create profile");
  }

  return { profile: profile as Profile, tempPassword };
}

export async function updateProfile(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProfileUpdateInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      name: parsed.data.name,
      role: parsed.data.role,
      qa_group: parsed.data.qa_group ?? null,
      capacity_hours: parsed.data.capacity_hours,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function setProfileActive(id: string, isActive: boolean): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/profile-action.ts
git commit -m "feat: add Team Management server actions"
```

---

### Task 13: Team Management UI

**Files:**
- Create: `src/components/team/team-form-dialog.tsx`
- Create: `src/components/team/team-table.tsx`
- Create: `src/components/team/team-page-content.tsx`
- Create: `src/app/(app)/team/page.tsx`

**Interfaces:**
- Consumes: `getProfiles`, `createProfile`, `updateProfile`, `setProfileActive` (Task 12), `Profile`/`ProfileRole`/`QaGroup` (Task 6), `getCurrentProfile` (Task 8), shadcn primitives (Task 2).
- Produces: the `/team` route. No exports consumed by other tasks (leaf feature).

- [ ] **Step 1: Write the create/edit dialog**

`src/components/team/team-form-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProfile, updateProfile } from "@/features/profile-action";
import type { Profile, ProfileRole, QaGroup } from "@/lib/profile";

type FormState = {
  name: string;
  email: string;
  role: ProfileRole;
  qa_group: QaGroup | "none";
  capacity_hours: string;
};

function formFromProfile(profile?: Profile): FormState {
  return profile
    ? {
        name: profile.name,
        email: profile.email,
        role: profile.role,
        qa_group: profile.qa_group ?? "none",
        capacity_hours: String(profile.capacity_hours),
      }
    : { name: "", email: "", role: "qa_member", qa_group: "none", capacity_hours: "40" };
}

type TeamFormDialogProps = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: Profile;
};

export function TeamFormDialog({ mode, open, onOpenChange, initialValue }: TeamFormDialogProps) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState<FormState>(() => formFromProfile(initialValue));
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role,
        qa_group: form.qa_group === "none" ? undefined : form.qa_group,
        capacity_hours: Number(form.capacity_hours),
      };
      return isEdit && initialValue
        ? updateProfile(initialValue.id, payload)
        : createProfile(payload);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      if (!isEdit && result && "tempPassword" in result) {
        setTempPassword(result.tempPassword);
      } else {
        toast.success("Team member updated");
        onOpenChange(false);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setTempPassword(null);
      setForm(formFromProfile());
    }
    onOpenChange(nextOpen);
  }

  if (tempPassword) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>User created</DialogTitle>
            <DialogDescription>
              Share this temporary password with {form.name} — it will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted px-4 py-3 text-center font-mono text-lg tracking-wider">
            {tempPassword}
          </div>
          <DialogFooter>
            <Button onClick={() => handleClose(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this team member's details." : "Creates a profile and a login for this team member."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              disabled={isEdit}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={form.role} onValueChange={(value) => setForm((f) => ({ ...f, role: value as ProfileRole }))}>
                <SelectTrigger id="role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qa_lead">QA Lead</SelectItem>
                  <SelectItem value="qa_member">QA Member</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="capacity">Capacity (hrs/wk)</Label>
              <Input
                id="capacity"
                type="number"
                min={1}
                step={1}
                value={form.capacity_hours}
                onChange={(e) => setForm((f) => ({ ...f, capacity_hours: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qa_group">QA Group</Label>
            <Select
              value={form.qa_group}
              onValueChange={(value) => setForm((f) => ({ ...f, qa_group: value as QaGroup | "none" }))}
            >
              <SelectTrigger id="qa_group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="qris_h2h">QRIS H2H</SelectItem>
                <SelectItem value="qris_bo">QRIS BO</SelectItem>
                <SelectItem value="digital_h2h">Digital H2H</SelectItem>
                <SelectItem value="digital_bo">Digital BO</SelectItem>
                <SelectItem value="corporate_it">Corporate IT</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : isEdit ? "Save" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write the table**

`src/components/team/team-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TeamFormDialog } from "@/components/team/team-form-dialog";
import { setProfileActive } from "@/features/profile-action";
import type { Profile, ProfileRole, QaGroup } from "@/lib/profile";

const ROLE_LABEL: Record<ProfileRole, string> = {
  qa_lead: "QA Lead",
  qa_member: "QA Member",
  project_manager: "Project Manager",
};

const QA_GROUP_LABEL: Record<QaGroup, string> = {
  qris_h2h: "QRIS H2H",
  qris_bo: "QRIS BO",
  digital_h2h: "Digital H2H",
  digital_bo: "Digital BO",
  corporate_it: "Corporate IT",
};

type TeamTableProps = {
  rows: Profile[];
  isLoading: boolean;
  isError: boolean;
  canWrite: boolean;
};

export function TeamTable({ rows, isLoading, isError, canWrite }: TeamTableProps) {
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const queryClient = useQueryClient();

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setProfileActive(id, isActive),
    onSuccess: () => {
      toast.success("Team member updated");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columnCount = canWrite ? 6 : 5;

  return (
    <Card>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>QA Group</TableHead>
              <TableHead className="text-right">Capacity (hrs/wk)</TableHead>
              {canWrite && <TableHead className="pr-6 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                  {canWrite && <TableCell className="pr-6"><Skeleton className="ml-auto size-8 rounded-md" /></TableCell>}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  Failed to load team members.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  No team members yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((profile) => (
                <TableRow key={profile.id} className={!profile.is_active ? "opacity-50" : undefined}>
                  <TableCell className="pl-6 text-sm font-medium">{profile.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{profile.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROLE_LABEL[profile.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {profile.qa_group ? QA_GROUP_LABEL[profile.qa_group] : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{profile.capacity_hours}</TableCell>
                  {canWrite && (
                    <TableCell className="pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditingProfile(profile)}>
                            <Pencil className="size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              toggleActiveMutation.mutate({ id: profile.id, isActive: !profile.is_active })
                            }
                          >
                            {profile.is_active ? (
                              <>
                                <UserX className="size-4" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <UserCheck className="size-4" />
                                Reactivate
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {editingProfile && (
        <TeamFormDialog
          key={editingProfile.id}
          mode="edit"
          open
          onOpenChange={(o) => {
            if (!o) setEditingProfile(null);
          }}
          initialValue={editingProfile}
        />
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Write the page content and route**

`src/components/team/team-page-content.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TeamFormDialog } from "@/components/team/team-form-dialog";
import { TeamTable } from "@/components/team/team-table";
import { getProfiles } from "@/features/profile-action";
import type { ProfileRole } from "@/lib/profile";

export function TeamPageContent({ role }: { role: ProfileRole }) {
  const [createOpen, setCreateOpen] = useState(false);
  const canWrite = role === "qa_lead";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => getProfiles(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Team Management</h1>
          <p className="text-sm text-muted-foreground">Manage QA resources, roles, and capacity.</p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Add User
          </Button>
        )}
      </div>

      <TeamTable rows={data ?? []} isLoading={isLoading} isError={isError} canWrite={canWrite} />

      {canWrite && <TeamFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />}
    </div>
  );
}
```

`src/app/(app)/team/page.tsx`:

```tsx
import { TeamPageContent } from "@/components/team/team-page-content";
import { getCurrentProfile } from "@/lib/auth";

export default async function TeamPage() {
  const profile = await getCurrentProfile();
  return <TeamPageContent role={profile!.role} />;
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npx eslint src/components/team "src/app/(app)/team"`
Expected: zero errors/warnings.

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`, sign in as the seeded QA Lead (Task 10) at `/login`, navigate to Team Management. Click "Add User", fill the form, submit. Expected: a "User created" dialog shows a temp password; the new row appears in the table after closing it.

- [ ] **Step 6: Commit**

```bash
git add src/components/team "src/app/(app)/team"
git commit -m "feat: add Team Management page"
```

---

### Task 14: Project Portfolio server actions

**Files:**
- Create: `src/features/project-action.ts`

**Interfaces:**
- Consumes: `createClient`, `createAdminClient` (Task 4), `requireRole` (Task 8), `ProjectInput`/`ProjectProposalInput` (Task 11), `Project`/`Product`/`ProjectStatus` (Task 6).
- Produces: `getProjects({ status?, product?, search?, approvalStatus? }): Promise<Project[]>` — the `approvalStatus` filter is used by Task 18 (Allocation Tool, always passes `"approved"`) and Task 20 (Approvals page name lookups), while Task 15 passes none (shows all). `createProject`, `updateProject`, `deleteProject`, `proposeProject`, `withdrawProjectProposal` — all `Promise<{ success: true }>` except `getProjects`. All from `@/features/project-action`, consumed starting Task 15.

- [ ] **Step 1: Write `src/features/project-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProjectInput, ProjectProposalInput } from "@/features/project-schema";
import type { Product, Project, ProjectStatus, ApprovalStatus } from "@/lib/project";

export async function getProjects({
  status = "",
  product = "",
  search = "",
  approvalStatus,
}: {
  status?: ProjectStatus | "";
  product?: Product | "";
  search?: string;
  approvalStatus?: ApprovalStatus;
} = {}): Promise<Project[]> {
  const supabase = await createClient();

  let query = supabase.from("projects").select("*");

  const term = search.trim();
  if (term) query = query.ilike("name", `%${term}%`);
  if (status) query = query.eq("status", status);
  if (product) query = query.eq("product", product);
  if (approvalStatus) query = query.eq("approval_status", approvalStatus);

  const { data, error } = await query.order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}

export async function createProject(input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("projects").insert({
    name: parsed.data.name,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date ?? null,
    product: parsed.data.product,
    status: parsed.data.status,
    progress_percent: parsed.data.progress_percent,
    approval_status: "approved",
  });

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function updateProject(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({
      name: parsed.data.name,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date ?? null,
      product: parsed.data.product,
      status: parsed.data.status,
      progress_percent: parsed.data.progress_percent,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteProject(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function proposeProject(input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const parsed = ProjectProposalInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({
      name: parsed.data.project.name,
      start_date: parsed.data.project.start_date,
      end_date: parsed.data.project.end_date ?? null,
      product: parsed.data.project.product,
      status: parsed.data.project.status,
      progress_percent: parsed.data.project.progress_percent,
      approval_status: "pending",
      proposed_by: profile.id,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Failed to submit proposal");
  }

  const { error: allocationsError } = await admin.from("allocations").insert(
    parsed.data.allocations.map((allocation) => ({
      user_id: allocation.user_id,
      project_id: project.id,
      role_on_project: allocation.role_on_project,
      hours_per_week: allocation.hours_per_week,
      start_date: allocation.start_date,
      end_date: allocation.end_date ?? null,
      approval_status: "pending",
      proposed_by: profile.id,
    })),
  );

  if (allocationsError) {
    await admin.from("projects").delete().eq("id", project.id);
    throw new Error(allocationsError.message);
  }

  return { success: true };
}

export async function withdrawProjectProposal(id: string): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("proposed_by, approval_status")
    .eq("id", id)
    .single();

  if (!project || project.proposed_by !== profile.id || project.approval_status !== "pending") {
    throw new Error("This proposal can no longer be withdrawn");
  }

  const { error } = await admin.from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/project-action.ts
git commit -m "feat: add Project Portfolio server actions"
```

---

### Task 15: Project Portfolio UI

**Files:**
- Create: `src/components/projects/project-form-dialog.tsx`
- Create: `src/components/projects/propose-project-dialog.tsx`
- Create: `src/components/projects/project-table.tsx`
- Create: `src/components/projects/projects-page-content.tsx`
- Create: `src/app/(app)/projects/page.tsx`
- Create: `src/lib/format.ts`

**Interfaces:**
- Consumes: `getProjects`, `createProject`, `updateProject`, `deleteProject`, `proposeProject`, `withdrawProjectProposal` (Task 14), `getAssignableProfiles` (Task 12), `Project`/`Product`/`ProjectStatus` (Task 6), `ProgressBar` (Task 2), `getCurrentProfile` (Task 8).
- Produces: the `/projects` route; `formatDate(iso: string): string` from `@/lib/format`, reused by Task 18 (Allocation Tool UI) and Task 20 (Approvals UI).

- [ ] **Step 1: Write the date formatter**

`src/lib/format.ts`:

```ts
const dateFmt = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(`${iso}T00:00:00Z`));
}
```

- [ ] **Step 2: Write the QA-Lead create/edit dialog**

`src/components/projects/project-form-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProject, updateProject } from "@/features/project-action";
import type { Product, Project, ProjectStatus } from "@/lib/project";

type FormState = {
  name: string;
  start_date: string;
  end_date: string;
  product: Product;
  status: ProjectStatus;
  progress_percent: string;
};

function formFromProject(project?: Project): FormState {
  return project
    ? {
        name: project.name,
        start_date: project.start_date,
        end_date: project.end_date ?? "",
        product: project.product,
        status: project.status,
        progress_percent: String(project.progress_percent),
      }
    : {
        name: "",
        start_date: "",
        end_date: "",
        product: "qris_h2h",
        status: "to_do",
        progress_percent: "0",
      };
}

type ProjectFormDialogProps = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: Project;
};

export function ProjectFormDialog({ mode, open, onOpenChange, initialValue }: ProjectFormDialogProps) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState<FormState>(() => formFromProject(initialValue));
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        start_date: form.start_date,
        end_date: form.end_date || undefined,
        product: form.product,
        status: form.status,
        progress_percent: Number(form.progress_percent),
      };
      return isEdit && initialValue ? updateProject(initialValue.id, payload) : createProject(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Project updated" : "Project created");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (!isEdit) setForm(formFromProject());
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit project" : "New project"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Project Name</Label>
            <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">End Date</Label>
              <Input
                id="end_date"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="product">Product</Label>
              <Select value={form.product} onValueChange={(value) => setForm((f) => ({ ...f, product: value as Product }))}>
                <SelectTrigger id="product" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qris_h2h">QRIS H2H</SelectItem>
                  <SelectItem value="qris_bo">QRIS BO</SelectItem>
                  <SelectItem value="qrcb">QRCB</SelectItem>
                  <SelectItem value="pi">PI</SelectItem>
                  <SelectItem value="jv">JV</SelectItem>
                  <SelectItem value="ccw">CCW</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={form.status} onValueChange={(value) => setForm((f) => ({ ...f, status: value as ProjectStatus }))}>
                <SelectTrigger id="status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="to_do">To Do</SelectItem>
                  <SelectItem value="ready_sit">Ready to SIT</SelectItem>
                  <SelectItem value="sit">SIT</SelectItem>
                  <SelectItem value="ready_uat">Ready to UAT</SelectItem>
                  <SelectItem value="uat">UAT</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="progress">Progress %</Label>
            <Input
              id="progress"
              type="number"
              min={0}
              max={100}
              step={1}
              value={form.progress_percent}
              onChange={(e) => setForm((f) => ({ ...f, progress_percent: e.target.value }))}
              required
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : isEdit ? "Save" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Write the Project-Manager propose dialog**

`src/components/projects/propose-project-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAssignableProfiles } from "@/features/profile-action";
import { proposeProject } from "@/features/project-action";
import type { Product, ProjectStatus } from "@/lib/project";

type AllocationRow = {
  user_id: string;
  role_on_project: string;
  hours_per_week: string;
  start_date: string;
  end_date: string;
};

function emptyAllocationRow(): AllocationRow {
  return { user_id: "", role_on_project: "", hours_per_week: "8", start_date: "", end_date: "" };
}

type ProposeProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProposeProjectDialog({ open, onOpenChange }: ProposeProjectDialogProps) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [product, setProduct] = useState<Product>("qris_h2h");
  const [status, setStatus] = useState<ProjectStatus>("to_do");
  const [rows, setRows] = useState<AllocationRow[]>([emptyAllocationRow()]);
  const queryClient = useQueryClient();

  const { data: testers } = useQuery({
    queryKey: ["assignable-profiles"],
    queryFn: () => getAssignableProfiles(),
  });

  const mutation = useMutation({
    mutationFn: () =>
      proposeProject({
        project: {
          name,
          start_date: startDate,
          end_date: endDate || undefined,
          product,
          status,
          progress_percent: 0,
        },
        allocations: rows.map((row) => ({
          user_id: row.user_id,
          role_on_project: row.role_on_project,
          hours_per_week: Number(row.hours_per_week),
          start_date: row.start_date,
          end_date: row.end_date || undefined,
        })),
      }),
    onSuccess: () => {
      toast.success("Proposal submitted — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setStartDate("");
      setEndDate("");
      setRows([emptyAllocationRow()]);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function updateRow(index: number, patch: Partial<AllocationRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Propose project</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="proposal_name">Project Name</Label>
            <Input id="proposal_name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_start">Start Date</Label>
              <Input id="proposal_start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal_end">End Date</Label>
              <Input id="proposal_end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_product">Product</Label>
              <Select value={product} onValueChange={(value) => setProduct(value as Product)}>
                <SelectTrigger id="proposal_product" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qris_h2h">QRIS H2H</SelectItem>
                  <SelectItem value="qris_bo">QRIS BO</SelectItem>
                  <SelectItem value="qrcb">QRCB</SelectItem>
                  <SelectItem value="pi">PI</SelectItem>
                  <SelectItem value="jv">JV</SelectItem>
                  <SelectItem value="ccw">CCW</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal_status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as ProjectStatus)}>
                <SelectTrigger id="proposal_status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="to_do">To Do</SelectItem>
                  <SelectItem value="ready_sit">Ready to SIT</SelectItem>
                  <SelectItem value="sit">SIT</SelectItem>
                  <SelectItem value="ready_uat">Ready to UAT</SelectItem>
                  <SelectItem value="uat">UAT</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Tester Assignments</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, emptyAllocationRow()])}>
                <Plus className="size-4" />
                Add tester
              </Button>
            </div>

            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-12 items-end gap-2 rounded-md border p-3">
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Tester</Label>
                  <Select value={row.user_id} onValueChange={(value) => updateRow(index, { user_id: value })}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(testers ?? []).map((tester) => (
                        <SelectItem key={tester.id} value={tester.id}>
                          {tester.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Role</Label>
                  <Input value={row.role_on_project} onChange={(e) => updateRow(index, { role_on_project: e.target.value })} required />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Hrs/Wk</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={row.hours_per_week}
                    onChange={(e) => updateRow(index, { hours_per_week: e.target.value })}
                    required
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Start</Label>
                  <Input type="date" value={row.start_date} onChange={(e) => updateRow(index, { start_date: e.target.value })} required />
                </div>
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs">End</Label>
                  <Input type="date" value={row.end_date} onChange={(e) => updateRow(index, { end_date: e.target.value })} />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={rows.length === 1}
                    onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
                    aria-label="Remove tester row"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Submitting..." : "Submit proposal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write the table**

`src/components/projects/project-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { deleteProject, withdrawProjectProposal } from "@/features/project-action";
import { formatDate } from "@/lib/format";
import type { Product, Project, ProjectStatus } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

const PRODUCT_LABEL: Record<Product, string> = {
  qris_h2h: "QRIS H2H",
  qris_bo: "QRIS BO",
  qrcb: "QRCB",
  pi: "PI",
  jv: "JV",
  ccw: "CCW",
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  to_do: "To Do",
  ready_sit: "Ready to SIT",
  sit: "SIT",
  ready_uat: "Ready to UAT",
  uat: "UAT",
  completed: "Completed",
};

type ProjectTableProps = {
  rows: Project[];
  isLoading: boolean;
  isError: boolean;
  role: ProfileRole;
  currentProfileId: string;
};

export function ProjectTable({ rows, isLoading, isError, role, currentProfileId }: ProjectTableProps) {
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const queryClient = useQueryClient();

  const canEdit = role === "qa_lead";
  const canPropose = role === "project_manager";
  const showActions = canEdit || canPropose;
  const columnCount = showActions ? 7 : 6;

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      toast.success("Project deleted");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDeletingProject(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const withdrawMutation = useMutation({
    mutationFn: withdrawProjectProposal,
    onSuccess: () => {
      toast.success("Proposal withdrawn");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Project Name</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>End Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              {showActions && <TableHead className="pr-6 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  {showActions && <TableCell className="pr-6"><Skeleton className="ml-auto size-8 rounded-md" /></TableCell>}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  Failed to load projects.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  No projects yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="pl-6 text-sm font-medium">
                    {project.name}
                    {project.approval_status === "pending" && (
                      <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                        Pending Approval
                      </Badge>
                    )}
                    {project.approval_status === "rejected" && (
                      <Badge variant="outline" className="ml-2 border-rose-200 bg-rose-50 text-rose-700">
                        Rejected
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{PRODUCT_LABEL[project.product]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(project.start_date)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {project.end_date ? formatDate(project.end_date) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{STATUS_LABEL[project.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <ProgressBar percent={project.progress_percent} />
                  </TableCell>
                  {showActions && (
                    <TableCell className="pr-6 text-right">
                      {canEdit && project.approval_status === "approved" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditingProject(project)}>
                              <Pencil className="size-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setDeletingProject(project)}
                              className="text-rose-600 focus:text-rose-600"
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {canPropose && project.approval_status === "pending" && project.proposed_by === currentProfileId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={withdrawMutation.isPending}
                          onClick={() => withdrawMutation.mutate(project.id)}
                        >
                          <Undo2 className="size-4" />
                          Withdraw
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {editingProject && (
        <ProjectFormDialog
          key={editingProject.id}
          mode="edit"
          open
          onOpenChange={(o) => {
            if (!o) setEditingProject(null);
          }}
          initialValue={editingProject}
        />
      )}

      <AlertDialog
        open={deletingProject !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingProject(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes &ldquo;{deletingProject?.name}&rdquo; and all of its allocations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingProject) deleteMutation.mutate(deletingProject.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
```

- [ ] **Step 5: Write the page content and route**

`src/components/projects/projects-page-content.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectTable } from "@/components/projects/project-table";
import { ProposeProjectDialog } from "@/components/projects/propose-project-dialog";
import { getProjects } from "@/features/project-action";
import type { Product, ProjectStatus } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

export function ProjectsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "">("");
  const [productFilter, setProductFilter] = useState<Product | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["projects", { search, status: statusFilter, product: productFilter }],
    queryFn: () => getProjects({ search, status: statusFilter, product: productFilter }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Project Portfolio</h1>
          <p className="text-sm text-muted-foreground">Manage and track QA projects across all stages.</p>
        </div>
        {role === "qa_lead" && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Project
          </Button>
        )}
        {role === "project_manager" && (
          <Button onClick={() => setProposeOpen(true)}>
            <Plus className="size-4" />
            Propose Project
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects..." className="max-w-64" />
        <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : (v as ProjectStatus))}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="to_do">To Do</SelectItem>
            <SelectItem value="ready_sit">Ready to SIT</SelectItem>
            <SelectItem value="sit">SIT</SelectItem>
            <SelectItem value="ready_uat">Ready to UAT</SelectItem>
            <SelectItem value="uat">UAT</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={productFilter || "all"} onValueChange={(v) => setProductFilter(v === "all" ? "" : (v as Product))}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            <SelectItem value="qris_h2h">QRIS H2H</SelectItem>
            <SelectItem value="qris_bo">QRIS BO</SelectItem>
            <SelectItem value="qrcb">QRCB</SelectItem>
            <SelectItem value="pi">PI</SelectItem>
            <SelectItem value="jv">JV</SelectItem>
            <SelectItem value="ccw">CCW</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ProjectTable rows={data ?? []} isLoading={isLoading} isError={isError} role={role} currentProfileId={currentProfileId} />

      {role === "qa_lead" && <ProjectFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />}
      {role === "project_manager" && <ProposeProjectDialog open={proposeOpen} onOpenChange={setProposeOpen} />}
    </div>
  );
}
```

`src/app/(app)/projects/page.tsx`:

```tsx
import { ProjectsPageContent } from "@/components/projects/projects-page-content";
import { getCurrentProfile } from "@/lib/auth";

export default async function ProjectsPage() {
  const profile = await getCurrentProfile();
  return <ProjectsPageContent role={profile!.role} currentProfileId={profile!.id} />;
}
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npx eslint src/components/projects src/lib/format.ts "src/app/(app)/projects"`
Expected: zero errors/warnings.

- [ ] **Step 7: Manual smoke check**

As the seeded QA Lead: create a project via "New Project". Create a second profile with role Project Manager via Team Management (Task 13), sign in as them in a second browser/incognito session, go to Project Portfolio, click "Propose Project", add one tester row, submit. Expected: the QA Lead sees the new project with a "Pending Approval" badge; the PM sees it too with a "Withdraw" button.

- [ ] **Step 8: Commit**

```bash
git add src/components/projects "src/app/(app)/projects" src/lib/format.ts
git commit -m "feat: add Project Portfolio page"
```

---

### Task 16: Allocation Tool server actions

**Files:**
- Create: `src/features/allocation-action.ts`

**Interfaces:**
- Consumes: `createClient`, `createAdminClient` (Task 4), `requireRole` (Task 8), `AllocationInput` (Task 11), `Allocation` (Task 6).
- Produces: `getAllocationsForUser(userId: string): Promise<Allocation[]>`, `createAllocation(input: unknown): Promise<{ success: true }>` (approved directly for `qa_lead`, `pending` + `proposed_by` set for `project_manager`; rejects if the target project isn't `approved`), `updateAllocation(id, input): Promise<{ success: true }>`, `deleteAllocation(id): Promise<{ success: true }>`, `withdrawAllocationProposal(id): Promise<{ success: true }>` — all from `@/features/allocation-action`, consumed starting Task 18.

- [ ] **Step 1: Write `src/features/allocation-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { AllocationInput } from "@/features/allocation-schema";
import type { Allocation } from "@/lib/allocation";

export async function getAllocationsForUser(userId: string): Promise<Allocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("*")
    .eq("user_id", userId)
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Allocation[];
}

export async function createAllocation(input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["qa_lead", "project_manager"]);

  const parsed = AllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("approval_status")
    .eq("id", parsed.data.project_id)
    .single();

  if (!project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }

  const isLead = profile.role === "qa_lead";

  const { error } = await admin.from("allocations").insert({
    user_id: parsed.data.user_id,
    project_id: parsed.data.project_id,
    role_on_project: parsed.data.role_on_project,
    hours_per_week: parsed.data.hours_per_week,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date ?? null,
    approval_status: isLead ? "approved" : "pending",
    proposed_by: isLead ? null : profile.id,
  });

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function updateAllocation(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = AllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("allocations")
    .update({
      user_id: parsed.data.user_id,
      project_id: parsed.data.project_id,
      role_on_project: parsed.data.role_on_project,
      hours_per_week: parsed.data.hours_per_week,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date ?? null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteAllocation(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("allocations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function withdrawAllocationProposal(id: string): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const admin = createAdminClient();
  const { data: allocation } = await admin
    .from("allocations")
    .select("proposed_by, approval_status")
    .eq("id", id)
    .single();

  if (!allocation || allocation.proposed_by !== profile.id || allocation.approval_status !== "pending") {
    throw new Error("This proposal can no longer be withdrawn");
  }

  const { error } = await admin.from("allocations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/allocation-action.ts
git commit -m "feat: add Allocation Tool server actions"
```

---

### Task 17: Dashboard server actions

**Files:**
- Create: `src/features/dashboard-action.ts`

**Interfaces:**
- Consumes: `createClient` (Task 4), `isoWeekRange`, `monthRange`, `weeklyHoursForUser`, `weeklyLoadPercent`, `monthlyHoursForUser`, `monthlyHoursForProject`, `AllocationForCalc` (Task 7), `Profile` (Task 6), `Project` (Task 6).
- Produces: `getWeeklyDashboard(weekStartISO: string): Promise<WeeklyDashboard>` where `WeeklyDashboard = { totalCapacity: number; totalAllocated: number; availableCapacity: number; resourceLoad: ResourceLoadRow[]; topDemand: { project: Project; hours: number }[] }` and `ResourceLoadRow = { profile: Profile; allocatedHours: number; loadPercent: number }`; `getMonthlyDashboard(year: number, monthIndex0: number): Promise<{ perMember: MonthlyMemberRow[]; perProject: MonthlyProjectRow[] }>` where `MonthlyMemberRow = { profile: Profile; hours: number }` and `MonthlyProjectRow = { project: Project; hours: number }` — both from `@/features/dashboard-action`, consumed by Task 18 (Allocation Tool UI, `getWeeklyDashboard` only, for the left-panel mini load bars) and Task 21 (Dashboard UI, both).

- [ ] **Step 1: Write `src/features/dashboard-action.ts`**

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isoWeekRange,
  monthRange,
  weeklyHoursForUser,
  weeklyLoadPercent,
  monthlyHoursForUser,
  monthlyHoursForProject,
  type AllocationForCalc,
} from "@/lib/load";
import type { Profile } from "@/lib/profile";
import type { Project } from "@/lib/project";

const RESOURCE_ROLES = ["qa_lead", "qa_member"] as const;

async function getActiveResources(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .in("role", RESOURCE_ROLES);
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

async function getApprovedAllocationsInRange(start: string, end: string): Promise<AllocationForCalc[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("user_id, project_id, hours_per_week, start_date, end_date")
    .eq("approval_status", "approved")
    .lte("start_date", end)
    .or(`end_date.is.null,end_date.gte.${start}`);
  if (error) throw new Error(error.message);
  return (data ?? []) as AllocationForCalc[];
}

async function getProjectsByIds(ids: string[]): Promise<Project[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}

export type ResourceLoadRow = {
  profile: Profile;
  allocatedHours: number;
  loadPercent: number;
};

export type WeeklyDashboard = {
  totalCapacity: number;
  totalAllocated: number;
  availableCapacity: number;
  resourceLoad: ResourceLoadRow[];
  topDemand: { project: Project; hours: number }[];
};

export async function getWeeklyDashboard(weekStartISO: string): Promise<WeeklyDashboard> {
  const week = isoWeekRange(new Date(`${weekStartISO}T00:00:00Z`));
  const [resources, allocations] = await Promise.all([
    getActiveResources(),
    getApprovedAllocationsInRange(week.start, week.end),
  ]);

  const resourceLoad: ResourceLoadRow[] = resources.map((profile) => {
    const allocatedHours = weeklyHoursForUser(allocations, profile.id, week);
    return {
      profile,
      allocatedHours,
      loadPercent: weeklyLoadPercent(allocatedHours, profile.capacity_hours),
    };
  });

  const totalCapacity = resources.reduce((sum, p) => sum + p.capacity_hours, 0);
  const totalAllocated = resourceLoad.reduce((sum, r) => sum + r.allocatedHours, 0);

  const hoursByProject = new Map<string, number>();
  for (const allocation of allocations) {
    hoursByProject.set(allocation.project_id, (hoursByProject.get(allocation.project_id) ?? 0) + allocation.hours_per_week);
  }

  const projectIds = [...hoursByProject.keys()];
  const projects = await getProjectsByIds(projectIds);

  const topDemand = projects
    .map((project) => ({ project, hours: hoursByProject.get(project.id) ?? 0 }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  return {
    totalCapacity,
    totalAllocated,
    availableCapacity: totalCapacity - totalAllocated,
    resourceLoad,
    topDemand,
  };
}

export type MonthlyMemberRow = { profile: Profile; hours: number };
export type MonthlyProjectRow = { project: Project; hours: number };

export async function getMonthlyDashboard(
  year: number,
  monthIndex0: number,
): Promise<{ perMember: MonthlyMemberRow[]; perProject: MonthlyProjectRow[] }> {
  const month = monthRange(year, monthIndex0);
  const [resources, allocations] = await Promise.all([
    getActiveResources(),
    getApprovedAllocationsInRange(month.start, month.end),
  ]);

  const perMember = resources
    .map((profile) => ({ profile, hours: monthlyHoursForUser(allocations, profile.id, month) }))
    .sort((a, b) => b.hours - a.hours);

  const projectIds = [...new Set(allocations.map((a) => a.project_id))];
  const projects = await getProjectsByIds(projectIds);

  const perProject = projects
    .map((project) => ({ project, hours: monthlyHoursForProject(allocations, project.id, month) }))
    .sort((a, b) => b.hours - a.hours);

  return { perMember, perProject };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/dashboard-action.ts
git commit -m "feat: add Resource Dashboard server actions"
```

---

### Task 18: Allocation Tool UI

**Files:**
- Create: `src/components/allocations/allocation-form.tsx`
- Create: `src/components/allocations/allocation-edit-dialog.tsx`
- Create: `src/components/allocations/assignments-table.tsx`
- Create: `src/components/allocations/allocations-page-content.tsx`
- Create: `src/app/(app)/allocations/page.tsx`

**Interfaces:**
- Consumes: `getWeeklyDashboard` (Task 17), `getProjects` (Task 14), `getAllocationsForUser`, `createAllocation`, `updateAllocation`, `deleteAllocation`, `withdrawAllocationProposal` (Task 16), `isoWeekRange` (Task 7), `formatDate` (Task 15), `LoadBar` (Task 2), `Project` (Task 6), `Allocation` (Task 6), `ProfileRole` (Task 6), `getCurrentProfile` (Task 8).
- Produces: the `/allocations` route. No exports consumed by other tasks (leaf feature).

- [ ] **Step 1: Write the assignment form (right panel)**

`src/components/allocations/allocation-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAllocation } from "@/features/allocation-action";
import type { Project } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

type AllocationFormProps = {
  userId: string;
  userName: string;
  capacityHours: number;
  allocatedHours: number;
  projects: Project[];
  role: ProfileRole;
};

export function AllocationForm({ userId, userName, capacityHours, allocatedHours, projects, role }: AllocationFormProps) {
  const [projectId, setProjectId] = useState("");
  const [roleOnProject, setRoleOnProject] = useState("");
  const [hoursPerWeek, setHoursPerWeek] = useState("8");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      createAllocation({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        hours_per_week: Number(hoursPerWeek),
        start_date: startDate,
        end_date: endDate || undefined,
      }),
    onSuccess: () => {
      toast.success(role === "qa_lead" ? "Resource assigned" : "Assignment proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      setProjectId("");
      setRoleOnProject("");
      setHoursPerWeek("8");
      setStartDate("");
      setEndDate("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="space-y-4"
    >
      <div className="rounded-md border bg-muted px-3 py-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Selected Resource</span>
          <span className="font-medium">{userName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Remaining Capacity</span>
          <span className="font-medium">{Math.max(0, capacityHours - allocatedHours)} hrs / week</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project">Target Project</Label>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger id="project" className="w-full">
            <SelectValue placeholder="Select a project..." />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="role_on_project">Role on Project</Label>
        <Input
          id="role_on_project"
          value={roleOnProject}
          onChange={(e) => setRoleOnProject(e.target.value)}
          placeholder="e.g. Lead QA"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="hours">Allocated Hours (Weekly)</Label>
        <Input
          id="hours"
          type="number"
          min={1}
          step={1}
          value={hoursPerWeek}
          onChange={(e) => setHoursPerWeek(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start_date">Start</Label>
          <Input id="start_date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end_date">End</Label>
          <Input id="end_date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={!projectId || mutation.isPending}>
          {mutation.isPending ? "Assigning..." : role === "qa_lead" ? "Assign Resource" : "Propose Assignment"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Write the edit dialog**

`src/components/allocations/allocation-edit-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAllocation } from "@/features/allocation-action";
import type { Allocation } from "@/lib/allocation";

type AllocationEditDialogProps = {
  allocation: Allocation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AllocationEditDialog({ allocation, open, onOpenChange }: AllocationEditDialogProps) {
  const [roleOnProject, setRoleOnProject] = useState(allocation.role_on_project);
  const [hoursPerWeek, setHoursPerWeek] = useState(String(allocation.hours_per_week));
  const [startDate, setStartDate] = useState(allocation.start_date);
  const [endDate, setEndDate] = useState(allocation.end_date ?? "");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      updateAllocation(allocation.id, {
        user_id: allocation.user_id,
        project_id: allocation.project_id,
        role_on_project: roleOnProject,
        hours_per_week: Number(hoursPerWeek),
        start_date: startDate,
        end_date: endDate || undefined,
      }),
    onSuccess: () => {
      toast.success("Assignment updated");
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", allocation.user_id] });
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit assignment</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="edit_role">Role on Project</Label>
            <Input id="edit_role" value={roleOnProject} onChange={(e) => setRoleOnProject(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit_hours">Allocated Hours (Weekly)</Label>
            <Input
              id="edit_hours"
              type="number"
              min={1}
              step={1}
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit_start">Start</Label>
              <Input id="edit_start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_end">End</Label>
              <Input id="edit_end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Write the assignments table (bottom panel)**

`src/components/allocations/assignments-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AllocationEditDialog } from "@/components/allocations/allocation-edit-dialog";
import {
  deleteAllocation,
  getAllocationsForUser,
  withdrawAllocationProposal,
} from "@/features/allocation-action";
import { formatDate } from "@/lib/format";
import type { Allocation } from "@/lib/allocation";
import type { Project } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

type AssignmentsTableProps = {
  userId: string;
  userName: string;
  projects: Project[];
  role: ProfileRole;
  currentProfileId: string;
};

export function AssignmentsTable({ userId, userName, projects, role, currentProfileId }: AssignmentsTableProps) {
  const [editingAllocation, setEditingAllocation] = useState<Allocation | null>(null);
  const queryClient = useQueryClient();
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  const { data, isLoading } = useQuery({
    queryKey: ["allocations", "user", userId],
    queryFn: () => getAllocationsForUser(userId),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAllocation,
    onSuccess: () => {
      toast.success("Assignment removed");
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const withdrawMutation = useMutation({
    mutationFn: withdrawAllocationProposal,
    onSuccess: () => {
      toast.success("Proposal withdrawn");
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = data ?? [];
  const totalAllocated = rows
    .filter((a) => a.approval_status === "approved")
    .reduce((sum, a) => sum + a.hours_per_week, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Assignments: {userName}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Project Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Hours/Wk</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No assignments yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((allocation) => (
                <TableRow key={allocation.id}>
                  <TableCell className="pl-6 text-sm font-medium">
                    {projectNameById.get(allocation.project_id) ?? "—"}
                    {allocation.approval_status === "pending" && (
                      <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                        Pending
                      </Badge>
                    )}
                    {allocation.approval_status === "rejected" && (
                      <Badge variant="outline" className="ml-2 border-rose-200 bg-rose-50 text-rose-700">
                        Rejected
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{allocation.role_on_project}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{allocation.hours_per_week}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(allocation.start_date)} –{" "}
                    {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {role === "qa_lead" && allocation.approval_status === "approved" && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setEditingAllocation(allocation)}
                          aria-label="Edit assignment"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(allocation.id)}
                          aria-label="Delete assignment"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                    {role === "project_manager" &&
                      allocation.approval_status === "pending" &&
                      allocation.proposed_by === currentProfileId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={withdrawMutation.isPending}
                          onClick={() => withdrawMutation.mutate(allocation.id)}
                        >
                          <Undo2 className="size-4" />
                          Withdraw
                        </Button>
                      )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="pl-6">Total Allocated</TableCell>
                <TableCell className="text-right tabular-nums">{totalAllocated} hrs</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>

      {editingAllocation && (
        <AllocationEditDialog
          key={editingAllocation.id}
          allocation={editingAllocation}
          open
          onOpenChange={(o) => {
            if (!o) setEditingAllocation(null);
          }}
        />
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Write the page content (left resource panel + orchestration)**

`src/components/allocations/allocations-page-content.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadBar } from "@/components/ui/load-bar";
import { AllocationForm } from "@/components/allocations/allocation-form";
import { AssignmentsTable } from "@/components/allocations/assignments-table";
import { getWeeklyDashboard } from "@/features/dashboard-action";
import { getProjects } from "@/features/project-action";
import { isoWeekRange } from "@/lib/load";
import type { ProfileRole } from "@/lib/profile";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

export function AllocationsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const canWrite = role === "qa_lead" || role === "project_manager";

  const { data: dashboard, isLoading: loadLoading } = useQuery({
    queryKey: ["weekly-dashboard", weekStart],
    queryFn: () => getWeeklyDashboard(weekStart),
  });

  const { data: projects } = useQuery({
    queryKey: ["projects", { approvalStatus: "approved" }],
    queryFn: () => getProjects({ approvalStatus: "approved" }),
  });

  const resources = dashboard?.resourceLoad ?? [];
  const filteredResources = useMemo(
    () => resources.filter((r) => r.profile.name.toLowerCase().includes(search.trim().toLowerCase())),
    [resources, search],
  );

  const selected = resources.find((r) => r.profile.id === selectedUserId) ?? null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Allocation Tool</h1>
        <p className="text-sm text-muted-foreground">Assign QA resources to approved projects and manage capacity.</p>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="week-start" className="text-sm text-muted-foreground">
          Planning week of
        </label>
        <Input
          id="week-start"
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(mondayOf(new Date(`${e.target.value}T00:00:00Z`)))}
          className="w-40"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Select Resource</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search QA members..."
                className="pl-9"
              />
            </div>
            <div className="space-y-2">
              {loadLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredResources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No resources found.</p>
              ) : (
                filteredResources.map((r) => (
                  <button
                    key={r.profile.id}
                    type="button"
                    onClick={() => setSelectedUserId(r.profile.id)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      selectedUserId === r.profile.id ? "border-blue-600 bg-blue-50" : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{r.profile.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.allocatedHours}/{r.profile.capacity_hours} hrs
                      </span>
                    </div>
                    <LoadBar percent={r.loadPercent} className="mt-2" />
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Allocation Details</h2>
            {!selected ? (
              <p className="text-sm text-muted-foreground">Select a resource to assign work.</p>
            ) : canWrite ? (
              <AllocationForm
                userId={selected.profile.id}
                userName={selected.profile.name}
                capacityHours={selected.profile.capacity_hours}
                allocatedHours={selected.allocatedHours}
                projects={projects ?? []}
                role={role}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {selected.profile.name} — {selected.allocatedHours}/{selected.profile.capacity_hours} hrs this week.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {selected && (
        <AssignmentsTable
          userId={selected.profile.id}
          userName={selected.profile.name}
          projects={projects ?? []}
          role={role}
          currentProfileId={currentProfileId}
        />
      )}
    </div>
  );
}
```

`src/app/(app)/allocations/page.tsx`:

```tsx
import { AllocationsPageContent } from "@/components/allocations/allocations-page-content";
import { getCurrentProfile } from "@/lib/auth";

export default async function AllocationsPage() {
  const profile = await getCurrentProfile();
  return <AllocationsPageContent role={profile!.role} currentProfileId={profile!.id} />;
}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npx eslint src/components/allocations "src/app/(app)/allocations"`
Expected: zero errors/warnings.

- [ ] **Step 6: Commit**

```bash
git add src/components/allocations "src/app/(app)/allocations"
git commit -m "feat: add Allocation Tool page"
```

---

### Task 19: Approvals server actions

**Files:**
- Create: `src/features/approval-action.ts`

**Interfaces:**
- Consumes: `createAdminClient` (Task 4), `requireRole` (Task 8), `Project` (Task 6), `Allocation` (Task 6).
- Produces: `PendingProjectProposal = Project & { allocations: Allocation[] }` type; `getPendingProjectProposals(): Promise<PendingProjectProposal[]>`, `getPendingAllocationProposals(): Promise<Allocation[]>` (excludes allocations whose parent project is itself still pending — those surface via the project-proposal bundle instead), `approveProjectProposal(projectId): Promise<{ success: true }>`, `rejectProjectProposal(projectId): Promise<{ success: true }>`, `approveAllocation(id): Promise<{ success: true }>`, `rejectAllocation(id): Promise<{ success: true }>` — all from `@/features/approval-action`, consumed starting Task 20.

- [ ] **Step 1: Write `src/features/approval-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import type { Allocation } from "@/lib/allocation";
import type { Project } from "@/lib/project";

export type PendingProjectProposal = Project & { allocations: Allocation[] };

export async function getPendingProjectProposals(): Promise<PendingProjectProposal[]> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { data: projects, error } = await admin
    .from("projects")
    .select("*")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const proposals: PendingProjectProposal[] = [];
  for (const project of (projects ?? []) as Project[]) {
    const { data: allocations } = await admin.from("allocations").select("*").eq("project_id", project.id);
    proposals.push({ ...project, allocations: (allocations ?? []) as Allocation[] });
  }
  return proposals;
}

export async function getPendingAllocationProposals(): Promise<Allocation[]> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("allocations")
    .select("*, projects!inner(approval_status)")
    .eq("approval_status", "pending")
    .eq("projects.approval_status", "approved")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Allocation[];
}

export async function approveProjectProposal(projectId: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error: projectError } = await admin
    .from("projects")
    .update({ approval_status: "approved" })
    .eq("id", projectId);
  if (projectError) throw new Error(projectError.message);

  const { error: allocationsError } = await admin
    .from("allocations")
    .update({ approval_status: "approved" })
    .eq("project_id", projectId)
    .eq("approval_status", "pending");
  if (allocationsError) throw new Error(allocationsError.message);

  return { success: true };
}

export async function rejectProjectProposal(projectId: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error: projectError } = await admin
    .from("projects")
    .update({ approval_status: "rejected" })
    .eq("id", projectId);
  if (projectError) throw new Error(projectError.message);

  const { error: allocationsError } = await admin
    .from("allocations")
    .update({ approval_status: "rejected" })
    .eq("project_id", projectId)
    .eq("approval_status", "pending");
  if (allocationsError) throw new Error(allocationsError.message);

  return { success: true };
}

export async function approveAllocation(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("allocations").update({ approval_status: "approved" }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function rejectAllocation(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("allocations").update({ approval_status: "rejected" }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/approval-action.ts
git commit -m "feat: add Approvals server actions"
```

---

### Task 20: Approvals UI

**Files:**
- Create: `src/components/approvals/approvals-page-content.tsx`
- Create: `src/app/(app)/approvals/page.tsx`

**Interfaces:**
- Consumes: `getPendingProjectProposals`, `getPendingAllocationProposals`, `approveProjectProposal`, `rejectProjectProposal`, `approveAllocation`, `rejectAllocation` (Task 19), `getProjects` (Task 14), `formatDate` (Task 15), `getCurrentProfile` (Task 8).
- Produces: the `/approvals` route, server-side role-gated (redirects non-QA-Leads to `/dashboard` even if they navigate there directly — the sidebar already hides the link, this is defense in depth). No exports consumed by other tasks (leaf feature).

- [ ] **Step 1: Write the page content**

`src/components/approvals/approvals-page-content.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  approveAllocation,
  approveProjectProposal,
  getPendingAllocationProposals,
  getPendingProjectProposals,
  rejectAllocation,
  rejectProjectProposal,
} from "@/features/approval-action";
import { getProjects } from "@/features/project-action";
import { formatDate } from "@/lib/format";

export function ApprovalsPageContent() {
  const queryClient = useQueryClient();

  const { data: proposals, isLoading: proposalsLoading } = useQuery({
    queryKey: ["approvals", "projects"],
    queryFn: () => getPendingProjectProposals(),
  });

  const { data: allocationProposals, isLoading: allocationsLoading } = useQuery({
    queryKey: ["approvals", "allocations"],
    queryFn: () => getPendingAllocationProposals(),
  });

  const { data: approvedProjects } = useQuery({
    queryKey: ["projects", { approvalStatus: "approved" }],
    queryFn: () => getProjects({ approvalStatus: "approved" }),
  });
  const projectNameById = new Map((approvedProjects ?? []).map((p) => [p.id, p.name]));

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
  }

  const approveProjectMutation = useMutation({
    mutationFn: approveProjectProposal,
    onSuccess: () => {
      toast.success("Project approved");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectProjectMutation = useMutation({
    mutationFn: rejectProjectProposal,
    onSuccess: () => {
      toast.success("Project rejected");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveAllocationMutation = useMutation({
    mutationFn: approveAllocation,
    onSuccess: () => {
      toast.success("Assignment approved");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectAllocationMutation = useMutation({
    mutationFn: rejectAllocation,
    onSuccess: () => {
      toast.success("Assignment rejected");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Review project proposals and future assignments submitted by Project Managers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Proposals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {proposalsLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !proposals || proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending project proposals.</p>
          ) : (
            proposals.map((proposal) => (
              <div key={proposal.id} className="rounded-md border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{proposal.name}</span>
                      <Badge variant="secondary">{proposal.product}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(proposal.start_date)} – {proposal.end_date ? formatDate(proposal.end_date) : "Ongoing"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rejectProjectMutation.isPending}
                      onClick={() => rejectProjectMutation.mutate(proposal.id)}
                    >
                      <X className="size-4" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={approveProjectMutation.isPending}
                      onClick={() => approveProjectMutation.mutate(proposal.id)}
                    >
                      <Check className="size-4" />
                      Approve
                    </Button>
                  </div>
                </div>

                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Hours/Wk</TableHead>
                      <TableHead>Timeline</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proposal.allocations.map((allocation) => (
                      <TableRow key={allocation.id}>
                        <TableCell>{allocation.role_on_project}</TableCell>
                        <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
                        <TableCell>
                          {formatDate(allocation.start_date)} –{" "}
                          {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Future Assignment Proposals</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Project</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Hours/Wk</TableHead>
                <TableHead>Timeline</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocationsLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !allocationProposals || allocationProposals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No pending assignment proposals.
                  </TableCell>
                </TableRow>
              ) : (
                allocationProposals.map((allocation) => (
                  <TableRow key={allocation.id}>
                    <TableCell className="pl-6">{projectNameById.get(allocation.project_id) ?? "—"}</TableCell>
                    <TableCell>{allocation.role_on_project}</TableCell>
                    <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
                    <TableCell>
                      {formatDate(allocation.start_date)} – {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rejectAllocationMutation.isPending}
                          onClick={() => rejectAllocationMutation.mutate(allocation.id)}
                        >
                          <X className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          disabled={approveAllocationMutation.isPending}
                          onClick={() => approveAllocationMutation.mutate(allocation.id)}
                        >
                          <Check className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Write the role-gated route**

`src/app/(app)/approvals/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { ApprovalsPageContent } from "@/components/approvals/approvals-page-content";
import { getCurrentProfile } from "@/lib/auth";

export default async function ApprovalsPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "qa_lead") {
    redirect("/dashboard");
  }
  return <ApprovalsPageContent />;
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npx eslint src/components/approvals "src/app/(app)/approvals"`
Expected: zero errors/warnings.

- [ ] **Step 4: Manual smoke check**

As the PM created in Task 15's smoke check (with a pending project proposal already submitted), sign in as the QA Lead, go to Approvals. Expected: the pending project proposal appears with its tester row(s); clicking Approve makes it disappear from Approvals and its "Pending Approval" badge disappear from Project Portfolio.

- [ ] **Step 5: Commit**

```bash
git add src/components/approvals "src/app/(app)/approvals"
git commit -m "feat: add Approvals page"
```

---

### Task 21: Resource Dashboard UI

**Files:**
- Create: `src/components/dashboard/dashboard-page-content.tsx`
- Create: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getWeeklyDashboard`, `getMonthlyDashboard` (Task 17), `isoWeekRange` (Task 7), `LoadBar` (Task 2).
- Produces: the `/dashboard` route — this is also the route `src/app/page.tsx` (Task 9) redirects to, so this task is what makes the root URL resolve instead of 404ing.

- [ ] **Step 1: Write the page content**

`src/components/dashboard/dashboard-page-content.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadBar } from "@/components/ui/load-bar";
import { getMonthlyDashboard, getWeeklyDashboard } from "@/features/dashboard-action";
import { isoWeekRange } from "@/lib/load";
import type { Product } from "@/lib/project";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

const PRODUCT_LABEL: Record<Product, string> = {
  qris_h2h: "QRIS H2H",
  qris_bo: "QRIS BO",
  qrcb: "QRCB",
  pi: "PI",
  jv: "JV",
  ccw: "CCW",
};

export function DashboardPageContent() {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [year, setYear] = useState(today.getUTCFullYear());
  const [monthIndex0, setMonthIndex0] = useState(today.getUTCMonth());

  const { data: weekly, isLoading: weeklyLoading } = useQuery({
    queryKey: ["weekly-dashboard", weekStart],
    queryFn: () => getWeeklyDashboard(weekStart),
  });

  const { data: monthly, isLoading: monthlyLoading } = useQuery({
    queryKey: ["monthly-dashboard", year, monthIndex0],
    queryFn: () => getMonthlyDashboard(year, monthIndex0),
  });

  const monthValue = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Resource Dashboard</h1>
          <p className="text-sm text-muted-foreground">High-level overview of QA capacity and project demand.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="week-picker" className="text-xs text-muted-foreground">
            Week of
          </Label>
          <Input
            id="week-picker"
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(mondayOf(new Date(`${e.target.value}T00:00:00Z`)))}
            className="w-40"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total QA Capacity</p>
            <p className="text-3xl font-bold tabular-nums">
              {weekly?.totalCapacity ?? 0} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total Allocated</p>
            <p className="text-3xl font-bold tabular-nums">
              {weekly?.totalAllocated ?? 0} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Available Capacity</p>
            <p className="text-3xl font-bold tabular-nums">
              {weekly?.availableCapacity ?? 0} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Resource Load</h2>
            {weeklyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="space-y-3">
                {(weekly?.resourceLoad ?? []).map((row) => (
                  <div key={row.profile.id} className="flex items-center gap-3">
                    <span className="w-32 truncate text-sm font-medium">{row.profile.name}</span>
                    <span className="w-24 text-xs text-muted-foreground">
                      {row.allocatedHours}/{row.profile.capacity_hours} hrs
                    </span>
                    <LoadBar percent={row.loadPercent} className="flex-1" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Top Product Demand</h2>
            {weeklyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (weekly?.topDemand.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No allocated projects this week.</p>
            ) : (
              <div className="space-y-3">
                {weekly!.topDemand.map(({ project, hours }) => (
                  <div key={project.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{project.name}</span>
                    <span className="text-muted-foreground tabular-nums">{hours} hrs</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-1">
        <Label htmlFor="month-picker" className="text-xs text-muted-foreground">
          Month
        </Label>
        <Input
          id="month-picker"
          type="month"
          value={monthValue}
          onChange={(e) => {
            const [y, m] = e.target.value.split("-").map(Number);
            setYear(y);
            setMonthIndex0(m - 1);
          }}
          className="w-40"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Monthly Hours per QA Member</h2>
            {monthlyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="space-y-2">
                {(monthly?.perMember ?? []).map(({ profile, hours }) => (
                  <div key={profile.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{profile.name}</span>
                    <span className="text-muted-foreground tabular-nums">{Math.round(hours)} hrs</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Monthly Demand per Project</h2>
            {monthlyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="space-y-2">
                {(monthly?.perProject ?? []).map(({ project, hours }) => (
                  <div key={project.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {project.name} <span className="text-muted-foreground">({PRODUCT_LABEL[project.product]})</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">{Math.round(hours)} hrs</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the route**

`src/app/(app)/dashboard/page.tsx`:

```tsx
import { DashboardPageContent } from "@/components/dashboard/dashboard-page-content";

export default function DashboardPage() {
  return <DashboardPageContent />;
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npx eslint src/components/dashboard "src/app/(app)/dashboard"`
Expected: zero errors/warnings.

- [ ] **Step 4: Manual smoke check**

Visit `http://localhost:3000/` while signed in. Expected: redirects to `/dashboard` and renders (no 404 — this resolves the forward reference noted in Task 9). With the QA Lead + one allocation created earlier, the Resource Load table and cards show non-zero numbers; switching the month picker updates the monthly sections.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard "src/app/(app)/dashboard"
git commit -m "feat: add Resource Dashboard page"
```

---

### Task 22: End-to-end manual verification

**Files:** none — this task only runs the app and checks behavior; no code changes.

**Interfaces:**
- Consumes: the entire app.
- Produces: confidence the full spec is met before calling the plan done.

- [ ] **Step 1: Full type-check and lint pass**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npx eslint .`
Expected: zero errors/warnings.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Role-by-role walkthrough**

Run: `npm run dev`. Using the QA Lead seeded in Task 10:

1. **Team Management**: create one QA Member and one Project Manager (note their temp passwords). Edit the QA Member's capacity to a different value; confirm the table reflects it. Deactivate and reactivate a user; confirm the row dims/undims and the dropdown label flips between "Deactivate"/"Reactivate".
2. **Project Portfolio**: create a project directly (status `To Do`, some product, progress 0). Confirm it appears with no approval badge (implicitly approved).
3. **Allocation Tool**: select the QA Member, assign them to the project just created (e.g. 20 hrs/week, start date = today). Confirm "Current Assignments" shows it with no "Pending" badge and the left-panel load bar updates.
4. **Resource Dashboard**: confirm the QA Member's row in Resource Load shows `20/<capacity>` hrs and the correct load % color (green if under 80%, amber 80–100%, red over 100% — adjust the allocation's hours to cross each threshold and confirm the bar color changes each time). Confirm the project appears in Top Product Demand with 20 hrs.
5. Sign out, sign in as the **Project Manager**: confirm the sidebar has no "Approvals" item, and that Team Management / Project Portfolio / Allocation Tool show no create/edit controls except "Propose Project" and the allocation form. Propose a new project with one tester assignment (the QA Member). Confirm it appears in Project Portfolio with a "Pending Approval" badge and a "Withdraw" button.
6. Sign out, sign in as the **QA Lead** again: go to Approvals, confirm the pending project proposal appears with its tester row. Approve it. Confirm it disappears from Approvals and its badge disappears from Project Portfolio, and its hours now count on the Resource Dashboard.
7. Sign in as the Project Manager again, use the Allocation Tool to propose a second, standalone future assignment against the now-approved project (different date range). Confirm it shows a "Pending" badge in that resource's Current Assignments and does **not** count toward the Dashboard's totals yet.
8. Sign in as the QA Lead, go to Approvals, confirm the standalone assignment proposal appears under "Future Assignment Proposals" (not mixed into the project-proposals list). Reject it. Confirm it disappears and never shows as approved anywhere.
9. Sign in as the **QA Member**: confirm the sidebar has no "Approvals" item, and every page (Team Management, Project Portfolio, Allocation Tool, Resource Dashboard) renders with no create/edit/propose/approve controls anywhere, but all data is visible (matching the "whole team, view-only" rule from the spec).

Expected: every step above matches its described outcome. If anything diverges, fix the relevant task's code (not this checklist) and re-run from the divergent step.

- [ ] **Step 4: Confirm no stray scratch files**

Run: `git status --short`
Expected: no untracked `scratch-*.ts` files (both scratch scripts from Tasks 7 were deleted in their own steps) and no unexpected modified files — only what's already committed per-task.

This task has no commit of its own — it's pure verification of everything committed in Tasks 1–21.

