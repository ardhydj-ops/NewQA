"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { SignOutButton } from "@/components/sign-out-button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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
              <ChangePasswordDialog />
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
