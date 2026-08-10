"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type NameEntity = { id: string; name: string };

type NameEntityCardProps = {
  title: string;
  itemNoun: string;
  queryKey: string;
  getItems: () => Promise<NameEntity[]>;
  createItem: (input: unknown) => Promise<{ success: true }>;
  updateItem: (id: string, input: unknown) => Promise<{ success: true }>;
  deleteItem: (id: string) => Promise<{ success: true }>;
};

export function NameEntityCard({
  title,
  itemNoun,
  queryKey,
  getItems,
  createItem,
  updateItem,
  deleteItem,
}: NameEntityCardProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<NameEntity | null>(null);
  const [deletingItem, setDeletingItem] = useState<NameEntity | null>(null);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: () => getItems(),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: [queryKey] });
  }

  const createMutation = useMutation({
    mutationFn: () => createItem({ name }),
    onSuccess: () => {
      toast.success(`${itemNoun} added`);
      invalidate();
      setName("");
      setAddOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateItem(editingItem!.id, { name }),
    onSuccess: () => {
      toast.success(`${itemNoun} updated`);
      invalidate();
      setEditingItem(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteItem(id),
    onSuccess: () => {
      toast.success(`${itemNoun} deleted`);
      invalidate();
      setDeletingItem(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function openAdd() {
    setName("");
    setAddOpen(true);
  }

  function openEdit(item: NameEntity) {
    setName(item.name);
    setEditingItem(item);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <Plus className="size-4" />
          Add
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Name</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !data || data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                  No {itemNoun.toLowerCase()}s yet.
                </TableCell>
              </TableRow>
            ) : (
              data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="pl-6 text-sm font-medium">{item.name}</TableCell>
                  <TableCell className="pr-6 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(item)}>
                          <Pencil className="size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setDeletingItem(item)}
                          className="text-rose-600 focus:text-rose-600"
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add {itemNoun}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor={`${queryKey}-add-name`}>Name</Label>
              <Input id={`${queryKey}-add-name`} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingItem !== null}
        onOpenChange={(o) => {
          if (!o) setEditingItem(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit {itemNoun}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              updateMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor={`${queryKey}-edit-name`}>Name</Label>
              <Input id={`${queryKey}-edit-name`} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingItem !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingItem(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {itemNoun.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes &ldquo;{deletingItem?.name}&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingItem) deleteMutation.mutate(deletingItem.id);
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
