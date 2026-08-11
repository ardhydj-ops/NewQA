"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadBar } from "@/components/ui/load-bar";
import { MonthCalendar } from "@/components/dashboard/month-calendar";
import { ProductDemandPieChart } from "@/components/dashboard/product-demand-pie-chart";
import { QaProjectsDialog } from "@/components/dashboard/qa-projects-dialog";
import { getProjectsForMonth, getWeeklyDashboard } from "@/features/dashboard-action";
import { getProducts } from "@/features/product-action";
import { getQaGroups } from "@/features/qa-group-action";
import { isoWeekRange } from "@/lib/load";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function DashboardPageContent() {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [year, setYear] = useState(today.getUTCFullYear());
  const [monthIndex0, setMonthIndex0] = useState(today.getUTCMonth());
  const [selectedQa, setSelectedQa] = useState<{ id: string; name: string } | null>(null);

  const { data: weekly, isLoading: weeklyLoading } = useQuery({
    queryKey: ["weekly-dashboard", weekStart],
    queryFn: () => getWeeklyDashboard(weekStart),
  });

  const { data: monthProjects, isLoading: monthLoading } = useQuery({
    queryKey: ["projects-for-month", year, monthIndex0],
    queryFn: () => getProjectsForMonth(year, monthIndex0),
  });

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  const monthValue = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;

  const resourceLoad = weekly?.resourceLoad ?? [];
  const allocatedPercent =
    weekly && weekly.totalCapacity > 0 ? (weekly.totalAllocated / weekly.totalCapacity) * 100 : 0;

  const groupSections = (qaGroups ?? []).map((group) => {
    const members = resourceLoad.filter((r) => r.profile.qa_group_id === group.id);
    const totalCapacity = members.reduce((sum, r) => sum + r.profile.capacity_days, 0);
    const totalAllocated = members.reduce((sum, r) => sum + r.allocatedDays, 0);
    const avgAvailable =
      members.length > 0 ? members.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / members.length : 0;
    return { id: group.id, name: group.name, members, totalCapacity, totalAllocated, avgAvailable };
  });
  const unassignedMembers = resourceLoad.filter((r) => r.profile.qa_group_id === null);
  if (unassignedMembers.length > 0) {
    const totalCapacity = unassignedMembers.reduce((sum, r) => sum + r.profile.capacity_days, 0);
    const totalAllocated = unassignedMembers.reduce((sum, r) => sum + r.allocatedDays, 0);
    const avgAvailable =
      unassignedMembers.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / unassignedMembers.length;
    groupSections.push({
      id: "unassigned",
      name: "Unassigned",
      members: unassignedMembers,
      totalCapacity,
      totalAllocated,
      avgAvailable,
    });
  }

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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total QA Capacity</p>
            <p className="text-3xl font-bold tabular-nums">
              {weekly?.totalCapacity ?? 0} <span className="text-sm font-normal text-muted-foreground">days/wk</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total Allocated</p>
            <p className="text-3xl font-bold tabular-nums">
              {roundHalf(weekly?.totalAllocated ?? 0)} <span className="text-sm font-normal text-muted-foreground">days/wk</span>
            </p>
            <LoadBar percent={allocatedPercent} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Available Capacity</p>
            <p className="text-3xl font-bold tabular-nums">
              {roundHalf(weekly?.availableCapacity ?? 0)}{" "}
              <span className="text-sm font-normal text-muted-foreground">days/wk</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total Number of Testers</p>
            <p className="text-3xl font-bold tabular-nums">{resourceLoad.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-5 pt-6">
            <h2 className="text-lg font-semibold">Capacity by QA Group</h2>
            {weeklyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              groupSections.map((group) => (
                <div key={group.id} className="space-y-2">
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">
                    {group.name} — {group.members.length} QA{group.members.length === 1 ? "" : "s"} ·{" "}
                    {roundHalf(group.totalAllocated)}/{group.totalCapacity} days · {Math.round(group.avgAvailable)}% avail
                  </h3>
                  <div className="space-y-2">
                    {group.members.map((row) => (
                      <div key={row.profile.id} className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedQa({ id: row.profile.id, name: row.profile.name })}
                          className="w-32 truncate text-left text-sm font-medium hover:underline"
                        >
                          {row.profile.name}
                        </button>
                        <span className="w-24 text-xs text-muted-foreground">
                          {roundHalf(row.allocatedDays)}/{row.profile.capacity_days} days
                        </span>
                        <LoadBar percent={row.loadPercent} className="flex-1" />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Product Demand</h2>
            {weeklyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <ProductDemandPieChart data={weekly?.demandByProduct ?? []} productNameById={productNameById} />
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

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-semibold">Ongoing Projects This Month</h2>
          {monthLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <MonthCalendar year={year} monthIndex0={monthIndex0} projects={monthProjects ?? []} />
          )}
        </CardContent>
      </Card>

      {selectedQa && (
        <QaProjectsDialog
          userId={selectedQa.id}
          userName={selectedQa.name}
          weekStart={weekStart}
          open
          onOpenChange={(o) => {
            if (!o) setSelectedQa(null);
          }}
        />
      )}
    </div>
  );
}
