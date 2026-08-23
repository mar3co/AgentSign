"use client";

import { useMemo, useState } from "react";
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Hourglass,
  Search,
  Send,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CabinetParty = {
  name: string;
  kind: "human" | "agent";
  email: string;
  agent?: string;
  signed_at: string | null;
  attested_at: string | null;
};

export type CabinetEnvelope = {
  id: string;
  title: string;
  status: string;
  createdAt?: string;
  canDelete?: boolean;
  signers?: CabinetParty[];
};

const STATUS_BADGES: Record<string, { label: string; dot: string }> = {
  pending_sender: { label: "Waiting on you", dot: "bg-amber-500" },
  pending: { label: "Out for signing", dot: "bg-blue-500" },
  completed: { label: "Completed", dot: "bg-emerald-500" },
  declined: { label: "Declined", dot: "bg-red-500" },
  cancelled: { label: "Cancelled", dot: "bg-muted-foreground" },
  expired: { label: "Expired", dot: "bg-muted-foreground" },
  deleted: { label: "Deleted", dot: "bg-muted-foreground" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGES[status] ?? { label: status, dot: "bg-muted-foreground" };
  return (
    <Badge variant="outline" className="gap-1.5 whitespace-nowrap">
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${s.dot}`} />
      {s.label}
    </Badge>
  );
}

/* Tinted status glyph in an avatar circle, after the invoice datatable in
   shadcn studio's dashboard-shell-05. */
const STATUS_ICONS: Record<
  string,
  { icon: typeof Send; tint: string }
> = {
  pending_sender: {
    icon: Hourglass,
    tint: "bg-amber-600/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400",
  },
  pending: {
    icon: Send,
    tint: "bg-sky-600/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-400",
  },
  completed: {
    icon: Check,
    tint: "bg-green-600/10 text-green-600 dark:bg-green-400/10 dark:text-green-400",
  },
  declined: { icon: X, tint: "bg-destructive/10 text-destructive" },
  cancelled: { icon: Ban, tint: "bg-muted text-muted-foreground" },
  expired: { icon: Clock, tint: "bg-muted text-muted-foreground" },
};

export function StatusIconAvatar({ status }: { status: string }) {
  const s = STATUS_ICONS[status] ?? {
    icon: Clock,
    tint: "bg-muted text-muted-foreground",
  };
  return (
    <Avatar className="after:border-none">
      <AvatarFallback className={s.tint}>
        <s.icon aria-hidden className="size-4" />
      </AvatarFallback>
    </Avatar>
  );
}

export function partyLine(p: CabinetParty): string {
  const who = p.kind === "agent" ? (p.agent ?? p.name) : p.name;
  const state = p.signed_at ? "signed" : p.attested_at ? "attested" : "waiting";
  return `${who} · ${p.kind} · ${state}`;
}

export function formatSentDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function DocumentCell({ env }: { env: CabinetEnvelope }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-medium">{env.title}</span>
      {env.signers && env.signers.length > 0 ? (
        <ul className="text-muted-foreground text-sm font-normal">
          {env.signers.map((p, i) => (
            <li key={`${env.id}-${p.email}-${i}`} className="truncate">
              {partyLine(p)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* Compact rows for the dashboard's recent-documents card: same cells, none of
   the filter or pagination chrome. */
export function EnvelopeMiniTable({
  envelopes,
  limit = 5,
}: {
  envelopes: CabinetEnvelope[];
  limit?: number;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="h-12">
          <TableHead className="text-muted-foreground w-14 first:pl-4" />
          <TableHead className="text-muted-foreground">Document</TableHead>
          <TableHead className="text-muted-foreground w-36">Status</TableHead>
          <TableHead className="text-muted-foreground w-32 last:pr-4">
            Sent
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {envelopes.slice(0, limit).map((env) => (
          <TableRow key={env.id}>
            <TableCell className="h-14 first:pl-4">
              <StatusIconAvatar status={env.status} />
            </TableCell>
            <TableCell className="h-14 max-w-0">
              <DocumentCell env={env} />
            </TableCell>
            <TableCell className="h-14">
              <StatusBadge status={env.status} />
            </TableCell>
            <TableCell className="text-muted-foreground h-14 whitespace-nowrap last:pr-4">
              {formatSentDate(env.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const PAGE_SIZES = [5, 10, 25, 50];

/** Page numbers around the current page, with ellipsis flags. */
function pageWindow(current: number, total: number) {
  const span = 3;
  let start = Math.max(1, current - 1);
  const end = Math.min(total, start + span - 1);
  start = Math.max(1, end - span + 1);
  const pages: number[] = [];
  for (let p = start; p <= end; p += 1) pages.push(p);
  return { pages, leftEllipsis: start > 1, rightEllipsis: end < total };
}

export function CabinetList({
  envelopes,
  onVoid,
  onSavePacket,
}: {
  envelopes: CabinetEnvelope[];
  onVoid?: (id: string) => void;
  onSavePacket?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const statuses = useMemo(
    () => [...new Set(envelopes.map((e) => e.status))],
    [envelopes],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return envelopes.filter((env) => {
      if (status !== "all" && env.status !== status) return false;
      if (!q) return true;
      if (env.title.toLowerCase().includes(q)) return true;
      return (env.signers ?? []).some(
        (p) =>
          p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
      );
    });
  }, [envelopes, query, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageIndex, pageCount - 1);
  const rows = filtered.slice(page * pageSize, page * pageSize + pageSize);
  const { pages, leftEllipsis, rightEllipsis } = pageWindow(page + 1, pageCount);

  if (envelopes.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={Send}
          title="No envelopes yet"
          description="Send a PDF and it shows up here with where it stands."
        >
          <LinkButton href="/send" size="sm">
            Send a PDF
          </LinkButton>
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card className="w-full gap-0 py-0">
      <div className="border-b">
        <div className="flex gap-4 p-4 max-lg:flex-col md:p-6 lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Label
              htmlFor="cabinet-page-size"
              className="text-muted-foreground font-normal max-sm:sr-only"
            >
              Show
            </Label>
            <Select
              items={PAGE_SIZES.map((s) => ({ label: String(s), value: String(s) }))}
              value={String(pageSize)}
              onValueChange={(value: string | null) => {
                if (!value) return;
                setPageSize(Number(value));
                setPageIndex(0);
              }}
            >
              <SelectTrigger id="cabinet-page-size" className="w-fit whitespace-nowrap">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-4 lg:justify-end">
            <div className="w-full max-w-2xs">
              <Label htmlFor="cabinet-search" className="sr-only">
                Search documents
              </Label>
              <InputGroup>
                <InputGroupAddon>
                  <Search aria-hidden className="size-4" />
                </InputGroupAddon>
                <InputGroupInput
                  id="cabinet-search"
                  type="text"
                  placeholder="Search documents"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPageIndex(0);
                  }}
                />
              </InputGroup>
            </div>
            <div className="w-full max-w-2xs">
              <Label htmlFor="cabinet-status" className="sr-only">
                Status
              </Label>
              <Select
                items={[
                  { label: "All statuses", value: "all" },
                  ...statuses.map((s) => ({
                    label: STATUS_BADGES[s]?.label ?? s,
                    value: s,
                  })),
                ]}
                value={status}
                onValueChange={(value: string | null) => {
                  setStatus(value ?? "all");
                  setPageIndex(0);
                }}
              >
                <SelectTrigger id="cabinet-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">All statuses</SelectItem>
                    {statuses.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_BADGES[s]?.label ?? s}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="h-14 border-t">
              <TableHead className="text-muted-foreground w-14 first:pl-4" />
              <TableHead className="text-muted-foreground">Document</TableHead>
              <TableHead className="text-muted-foreground w-36">Status</TableHead>
              <TableHead className="text-muted-foreground w-32">Sent</TableHead>
              <TableHead className="text-muted-foreground w-64 text-right last:pr-4">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No documents match.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((env) => (
                <TableRow key={env.id}>
                  <TableCell className="h-14 first:pl-4">
                    <StatusIconAvatar status={env.status} />
                  </TableCell>
                  <TableCell className="h-14 max-w-0">
                    <DocumentCell env={env} />
                  </TableCell>
                  <TableCell className="h-14">
                    <StatusBadge status={env.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground h-14 whitespace-nowrap">
                    {formatSentDate(env.createdAt)}
                  </TableCell>
                  <TableCell className="h-14 text-right last:pr-4">
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {env.status === "completed" ? (
                        <>
                          <LinkButton
                            href={`/v1/envelopes/${env.id}/pdf`}
                            variant="outline"
                            size="sm"
                          >
                            Download
                          </LinkButton>
                          <LinkButton
                            href={`/v1/envelopes/${env.id}/pdf?kind=certificate`}
                            variant="outline"
                            size="sm"
                          >
                            Certificate
                          </LinkButton>
                        </>
                      ) : null}
                      {env.status === "completed" && env.canDelete ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onSavePacket?.(env.id)}
                        >
                          Save as packet
                        </Button>
                      ) : null}
                      {env.canDelete ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button type="button" variant="outline" size="sm" />
                            }
                          >
                            Void
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Void “{env.title}”?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Signing links stop working and the envelope
                                cannot be reopened.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogClose
                                render={<Button type="button" variant="outline" />}
                              >
                                Keep envelope
                              </AlertDialogClose>
                              <AlertDialogClose
                                render={
                                  <Button type="button" variant="destructive" />
                                }
                                onClick={() => onVoid?.(env.id)}
                              >
                                Void envelope
                              </AlertDialogClose>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-4 max-sm:flex-col md:px-6">
        <p className="text-muted-foreground text-sm whitespace-nowrap" aria-live="polite">
          Showing{" "}
          <span>
            {filtered.length === 0 ? 0 : page * pageSize + 1} to{" "}
            {Math.min((page + 1) * pageSize, filtered.length)}
          </span>{" "}
          of <span>{filtered.length} documents</span>
        </p>
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPageIndex(page - 1)}
            disabled={page === 0}
            aria-label="Go to previous page"
          >
            <ChevronLeft aria-hidden />
            Previous
          </Button>
          {leftEllipsis ? (
            <span className="text-muted-foreground px-1">…</span>
          ) : null}
          {pages.map((p) => {
            const isActive = p === page + 1;
            return (
              <Button
                key={p}
                size="icon"
                className={
                  isActive
                    ? undefined
                    : "bg-primary/10 text-primary hover:bg-primary/20"
                }
                variant={isActive ? "default" : "ghost"}
                onClick={() => setPageIndex(p - 1)}
                aria-current={isActive ? "page" : undefined}
              >
                {p}
              </Button>
            );
          })}
          {rightEllipsis ? (
            <span className="text-muted-foreground px-1">…</span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPageIndex(page + 1)}
            disabled={page + 1 >= pageCount}
            aria-label="Go to next page"
          >
            Next
            <ChevronRight aria-hidden />
          </Button>
        </nav>
      </div>
    </Card>
  );
}
