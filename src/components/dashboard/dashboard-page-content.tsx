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
