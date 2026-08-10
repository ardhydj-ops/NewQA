"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadBar } from "@/components/ui/load-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMonthlyDashboard, getWeeklyDashboard } from "@/features/dashboard-action";
import { getProducts } from "@/features/product-action";
import { getQaGroups } from "@/features/qa-group-action";
import { isoWeekRange } from "@/lib/load";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

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
  const avgAvailablePercent =
    resourceLoad.length > 0
      ? resourceLoad.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / resourceLoad.length
      : 0;

  const groupStats = (qaGroups ?? []).map((group) => {
    const members = resourceLoad.filter((r) => r.profile.qa_group_id === group.id);
    const totalCapacity = members.reduce((sum, r) => sum + r.profile.capacity_hours, 0);
    const totalAllocated = members.reduce((sum, r) => sum + r.allocatedHours, 0);
    const avgAvailable =
      members.length > 0 ? members.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / members.length : 0;
    return {
      groupId: group.id,
      groupName: group.name,
      memberCount: members.length,
      totalCapacity,
      totalAllocated,
      availableCapacity: totalCapacity - totalAllocated,
      avgAvailable,
    };
  });

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
              {weekly?.totalCapacity ?? 0} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total Allocated</p>
            <p className="text-3xl font-bold tabular-nums">
              {weekly?.totalAllocated ?? 0} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
            </p>
            <LoadBar percent={allocatedPercent} />
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
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Avg Available Capacity</p>
            <p className="text-3xl font-bold tabular-nums">
              {Math.round(avgAvailablePercent)} <span className="text-sm font-normal text-muted-foreground">%</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="px-0 pt-6">
          <h2 className="mb-4 px-6 text-lg font-semibold">Capacity by QA Group</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">QA Group</TableHead>
                <TableHead className="text-right"># QAs</TableHead>
                <TableHead className="text-right">Total Capacity</TableHead>
                <TableHead className="text-right">Total Allocated</TableHead>
                <TableHead className="text-right">Available Capacity</TableHead>
                <TableHead className="pr-6 text-right">Avg Available Capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeklyLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : (
                groupStats.map((stat) => (
                  <TableRow key={stat.groupId}>
                    <TableCell className="pl-6 text-sm font-medium">{stat.groupName}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{stat.memberCount}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {stat.totalCapacity} <span className="text-muted-foreground">hrs/wk</span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {stat.totalAllocated} <span className="text-muted-foreground">hrs/wk</span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {stat.availableCapacity} <span className="text-muted-foreground">hrs/wk</span>
                    </TableCell>
                    <TableCell className="pr-6 text-right text-sm tabular-nums">
                      {Math.round(stat.avgAvailable)}%
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Resource Load</h2>
            {weeklyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="space-y-3">
                {resourceLoad.map((row) => (
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
                      {project.name}{" "}
                      <span className="text-muted-foreground">({productNameById.get(project.product_id) ?? "—"})</span>
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
