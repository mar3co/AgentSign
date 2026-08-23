"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  Bot,
  Files,
  LayoutDashboard,
  Palette,
  Search,
  Send,
  Undo2,
  Users,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";

type Props = {
  trigger: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /** Register the global ⌘K / Ctrl+K shortcut. Enable on ONE instance only. */
  hotkey?: boolean;
};

const PAGES = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/send", label: "Send a PDF", icon: Send },
  { href: "/envelopes", label: "Cabinet", icon: Archive },
  { href: "/packets", label: "Packets", icon: Files },
  { href: "/team", label: "Team", icon: Users },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/settings/branding", label: "Branding", icon: Palette },
  { href: "/docs", label: "Docs", icon: Files },
];

export function SearchDialog({
  defaultOpen = false,
  trigger,
  className,
  hotkey = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  const close = () => {
    setOpen(false);
    setSearch("");
  };

  const pages = PAGES.filter((p) =>
    p.label.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className={className}>
      <div onClick={() => setOpen(true)}>{trigger}</div>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent
          className="gap-0 overflow-hidden border-0 p-0 *:data-[slot=dialog-close]:top-1.5 *:data-[slot=dialog-close]:right-1.5 sm:max-w-lg"
          aria-describedby={undefined}
          // The always-open combobox swallows Escape before the dialog sees
          // it; catch it in the capture phase so "esc to close" stays true.
          onKeyDownCapture={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Combobox open={true}>
            <ComboboxInput
              placeholder="Search here..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-border h-12 w-full gap-2 rounded-none border-0 border-b px-3 ring-0! has-[[data-slot=input-group-control]:focus-visible]:border-inherit *:data-[align=inline-end]:hidden *:data-[align=inline-start]:p-0 *:data-[slot=input-group-control]:text-base [&_input]:p-0!"
              showTrigger={false}
            >
              <InputGroupAddon>
                <Search className="size-5" />
              </InputGroupAddon>
            </ComboboxInput>
            <ComboboxList className="border-0">
              <ComboboxEmpty>No results found.</ComboboxEmpty>
              {pages.length > 0 && (
                <ComboboxGroup className="p-4!">
                  <ComboboxLabel>Pages</ComboboxLabel>
                  {pages.map((page) => (
                    <ComboboxItem
                      key={page.href}
                      value={page.href}
                      className="cursor-pointer p-1.5! text-base"
                      onClick={() => {
                        close();
                        window.location.href = page.href;
                      }}
                    >
                      <page.icon className="text-foreground size-4.5!" />
                      <span>{page.label}</span>
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              )}
            </ComboboxList>
          </Combobox>

          <div className="bg-border h-px max-sm:hidden" />

          <div className="text-muted-foreground flex flex-wrap items-center gap-4 p-4 max-sm:hidden">
            <div className="flex flex-1 items-center gap-2">
              <kbd className="rounded border px-1 text-sm">esc</kbd>
              <span>To close</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-sm border">
                <Undo2 className="size-4" />
              </div>
              <span>To Select</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-sm border">
                <ArrowUp className="size-4" />
              </div>
              <div className="flex size-6 items-center justify-center rounded-sm border">
                <ArrowDown className="size-4" />
              </div>
              <span>To Navigate</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
