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
import type { ProductRow } from "@/lib/product";

type ProductMultiSelectProps = {
  products: ProductRow[];
  selectedProductIds: string[];
  onChange: (ids: string[]) => void;
};

export function ProductMultiSelect({ products, selectedProductIds, onChange }: ProductMultiSelectProps) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    onChange(
      selectedProductIds.includes(id)
        ? selectedProductIds.filter((existingId) => existingId !== id)
        : [...selectedProductIds, id],
    );
  }

  const selectedNames = products
    .filter((product) => selectedProductIds.includes(product.id))
    .map((product) => product.name);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", selectedNames.length === 0 && "text-muted-foreground")}>
            {selectedNames.length === 0 ? "Select products..." : selectedNames.join(", ")}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search products..." />
          <CommandList>
            <CommandEmpty>No products found.</CommandEmpty>
            <CommandGroup>
              {products.map((product) => (
                <CommandItem key={product.id} value={product.name} onSelect={() => toggle(product.id)}>
                  <Check
                    className={cn("size-4", selectedProductIds.includes(product.id) ? "opacity-100" : "opacity-0")}
                  />
                  {product.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
