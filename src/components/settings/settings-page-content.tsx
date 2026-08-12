"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NameEntityCard } from "@/components/settings/name-entity-card";
import { getSettings, updateSettings } from "@/features/settings-action";
import { createProduct, deleteProduct, getProducts, updateProduct } from "@/features/product-action";
import { createQaGroup, deleteQaGroup, getQaGroups, updateQaGroup } from "@/features/qa-group-action";

export function SettingsPageContent() {
  const [maxParallelProjects, setMaxParallelProjects] = useState<string | null>(null);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState<boolean | null>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });

  if (data && maxParallelProjects === null) {
    setMaxParallelProjects(String(data.max_parallel_projects));
  }
  if (data && emailNotificationsEnabled === null) {
    setEmailNotificationsEnabled(data.email_notifications_enabled);
  }

  const mutation = useMutation({
    mutationFn: () =>
      updateSettings({
        max_parallel_projects: Number(maxParallelProjects),
        email_notifications_enabled: emailNotificationsEnabled ?? false,
      }),
    onSuccess: () => {
      toast.success("Settings updated");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Global limits and defaults for the QA Resource Manager.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
            className="max-w-xs space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="max_parallel">Max Parallel Projects per QA</Label>
              <Input
                id="max_parallel"
                type="number"
                min={1}
                step={1}
                value={maxParallelProjects ?? ""}
                onChange={(e) => setMaxParallelProjects(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                A QA can&apos;t be assigned to more than this many overlapping projects/activities at once.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="email_notifications"
                checked={emailNotificationsEnabled ?? false}
                onCheckedChange={(checked) => setEmailNotificationsEnabled(checked === true)}
              />
              <Label htmlFor="email_notifications">Email Notifications</Label>
            </div>
            <Button
              type="submit"
              disabled={mutation.isPending || maxParallelProjects === null || emailNotificationsEnabled === null}
            >
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <NameEntityCard
        title="QA Groups"
        itemNoun="QA Group"
        queryKey="qa-groups"
        getItems={getQaGroups}
        createItem={createQaGroup}
        updateItem={updateQaGroup}
        deleteItem={deleteQaGroup}
      />

      <NameEntityCard
        title="Products"
        itemNoun="Product"
        queryKey="products"
        getItems={getProducts}
        createItem={createProduct}
        updateItem={updateProduct}
        deleteItem={deleteProduct}
      />
    </div>
  );
}
