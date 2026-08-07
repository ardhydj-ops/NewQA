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
