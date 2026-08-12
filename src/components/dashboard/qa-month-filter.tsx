"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/profile";

type QaMonthFilterProps = {
  profiles: Profile[];
  selectedQaIds: string[];
  onChange: (ids: string[]) => void;
};

export function QaMonthFilter({ profiles, selectedQaIds, onChange }: QaMonthFilterProps) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    onChange(
      selectedQaIds.includes(id)
        ? selectedQaIds.filter((existingId) => existingId !== id)
        : [...selectedQaIds, id],
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-56 justify-between font-normal"
        >
          <span className={cn("truncate", selectedQaIds.length === 0 && "text-muted-foreground")}>
            {selectedQaIds.length === 0
              ? "Filter by QA"
              : `${selectedQaIds.length} QA${selectedQaIds.length === 1 ? "" : "s"} selected`}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search testers..." />
          <CommandList>
            <CommandEmpty>No testers found.</CommandEmpty>
            <CommandGroup>
              {profiles.map((profile) => (
                <CommandItem key={profile.id} value={profile.name} onSelect={() => toggle(profile.id)}>
                  <Check
                    className={cn("size-4", selectedQaIds.includes(profile.id) ? "opacity-100" : "opacity-0")}
                  />
                  {profile.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
