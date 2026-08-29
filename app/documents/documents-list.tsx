"use client";

import { useMemo } from "react";
import {
  columnFilteringFeature,
  columnSizingFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_equals,
  flexRender,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type Row,
} from "@tanstack/react-table";
import {
  Ban,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
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
import { cn } from "@/lib/utils";

export type DocumentParty = {
  name: string;
  kind: "human" | "agent";
  email: string;
  agent?: string;
  signed_at: string | null;
  attested_at: string | null;
};

export type DocumentListItem = {
  id: string;
  title: string;
  status: string;
  createdAt?: string;
  canDelete?: boolean;
  signers?: DocumentParty[];
};

/* v9 is feature-modular: only the features the list uses get compiled in,
   along with their row models and the filter fns referenced by string key.
   Built statically, as the docs recommend, so the set is stable across renders. */
const listFeatures = tableFeatures({
  columnFilteringFeature,
  columnSizingFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { equals: filterFn_equals },
  // "auto" resolution picks from these by sampled value shape; unregistered
  // picks fall back to basic with a console warning.
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
});

type ListFeatures = typeof listFeatures;

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
const STATUS_ICONS: Record<string, { icon: typeof Send; tint: string }> = {
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

export function partyLine(p: DocumentParty): string {
  const who = p.kind === "agent" ? (p.agent ?? p.name) : p.name;
  const state = p.signed_at ? "signed" : p.attested_at ? "attested" : "waiting";
  return `${who} · ${p.kind} · ${state}`;
}

export function formatSentDate(iso?: string, timeZone?: string | null): string {
  if (!iso) return "—";
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "2-digit",
  };
  if (timeZone) opts.timeZone = timeZone;
  return new Date(iso).toLocaleDateString("en-US", opts);
}

function DocumentCell({ doc }: { doc: DocumentListItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-medium">{doc.title}</span>
      {doc.signers && doc.signers.length > 0 ? (
        <ul className="text-muted-foreground text-sm font-normal">
          {doc.signers.map((p, i) => (
            <li key={`${doc.id}-${p.email}-${i}`} className="truncate">
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
export function DocumentMiniTable({
  documents,
  limit = 5,
  timeZone,
}: {
  documents: DocumentListItem[];
  limit?: number;
  timeZone?: string | null;
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
        {documents.slice(0, limit).map((doc) => (
          <TableRow key={doc.id}>
            <TableCell className="h-14 first:pl-4">
              <StatusIconAvatar status={doc.status} />
            </TableCell>
            <TableCell className="h-14 max-w-0">
              <DocumentCell doc={doc} />
            </TableCell>
            <TableCell className="h-14">
              <StatusBadge status={doc.status} />
            </TableCell>
            <TableCell className="text-muted-foreground h-14 whitespace-nowrap last:pr-4">
              {formatSentDate(doc.createdAt, timeZone)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ActionsCell({
  doc,
  onVoid,
  onSaveTemplate,
}: {
  doc: DocumentListItem;
  onVoid?: (id: string) => void;
  onSaveTemplate?: (id: string) => void;
}) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {doc.status === "completed" ? (
        <>
          <LinkButton
            href={`/v1/documents/${doc.id}/pdf`}
            variant="outline"
            size="sm"
          >
            Download
          </LinkButton>
          <LinkButton
            href={`/v1/documents/${doc.id}/pdf?kind=certificate`}
            variant="outline"
            size="sm"
          >
            Certificate
          </LinkButton>
        </>
      ) : null}
      {doc.status === "completed" && doc.canDelete ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onSaveTemplate?.(doc.id)}
        >
          Save as template
        </Button>
      ) : null}
      {doc.canDelete ? (
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button type="button" variant="outline" size="sm" />}
          >
            Void
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Void “{doc.title}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Signing links stop working and the document cannot be reopened.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose
                render={<Button type="button" variant="outline" />}
              >
                Keep document
              </AlertDialogClose>
              <AlertDialogClose
                render={<Button type="button" variant="destructive" />}
                onClick={() => onVoid?.(doc.id)}
              >
                Void document
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </span>
  );
}

/** Match against the title and every signer's name and email. */
function matchesDocument(
  row: Row<ListFeatures, DocumentListItem>,
  _columnId: string,
  value: string,
): boolean {
  const q = String(value).trim().toLowerCase();
  if (!q) return true;
  const doc = row.original;
  if (doc.title.toLowerCase().includes(q)) return true;
  return (doc.signers ?? []).some(
    (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
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

export function DocumentsList({
  documents,
  onVoid,
  onSaveTemplate,
  timeZone,
}: {
  documents: DocumentListItem[];
  onVoid?: (id: string) => void;
  onSaveTemplate?: (id: string) => void;
  timeZone?: string | null;
}) {
  const columns = useMemo<ColumnDef<ListFeatures, DocumentListItem>[]>(
    () => [
      {
        id: "icon",
        header: () => null,
        cell: ({ row }) => <StatusIconAvatar status={row.original.status} />,
        enableSorting: false,
        size: 56,
      },
      {
        accessorKey: "title",
        header: "Document",
        cell: ({ row }) => <DocumentCell doc={row.original} />,
        size: 380,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        filterFn: "equals",
        size: 144,
      },
      {
        id: "createdAt",
        accessorFn: (doc) => doc.createdAt ?? "",
        header: "Sent",
        cell: ({ row }) => (
          <span className="text-muted-foreground whitespace-nowrap">
            {formatSentDate(row.original.createdAt, timeZone)}
          </span>
        ),
        size: 128,
      },
      {
        id: "actions",
        header: () => "Actions",
        cell: ({ row }) => (
          <ActionsCell
            doc={row.original}
            onVoid={onVoid}
            onSaveTemplate={onSaveTemplate}
          />
        ),
        enableSorting: false,
        size: 256,
      },
    ],
    [onVoid, onSaveTemplate, timeZone],
  );

  // v9's store owns the table state; we seed it and read back table.state.
  const table = useTable({
    features: listFeatures,
    data: documents,
    columns,
    initialState: {
      sorting: [{ id: "createdAt", desc: true }],
      pagination: { pageIndex: 0, pageSize: 10 },
    },
    globalFilterFn: matchesDocument,
    enableSortingRemoval: false,
    autoResetPageIndex: true,
  });

  const statuses = useMemo(
    () => [...new Set(documents.map((e) => e.status))],
    [documents],
  );
  const statusFilter =
    (table.getColumn("status")?.getFilterValue() as string | undefined) ?? "all";

  const filteredCount = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.state.pagination;
  const pageCount = table.getPageCount();
  const { pages, leftEllipsis, rightEllipsis } = pageWindow(
    pageIndex + 1,
    Math.max(1, pageCount),
  );

  if (documents.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={Send}
          title="No documents yet"
          description="Send a document and it shows up here with where it stands."
        >
          <LinkButton href="/send" size="sm">
            Send a document
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
              htmlFor="documents-page-size"
              className="text-muted-foreground font-normal max-sm:sr-only"
            >
              Show
            </Label>
            <Select
              items={PAGE_SIZES.map((s) => ({ label: String(s), value: String(s) }))}
              value={String(pageSize)}
              onValueChange={(value: string | null) => {
                if (value) table.setPageSize(Number(value));
              }}
            >
              <SelectTrigger id="documents-page-size" className="w-fit whitespace-nowrap">
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
              <Label htmlFor="documents-search" className="sr-only">
                Search documents
              </Label>
              <InputGroup>
                <InputGroupAddon>
                  <Search aria-hidden className="size-4" />
                </InputGroupAddon>
                <InputGroupInput
                  id="documents-search"
                  type="text"
                  placeholder="Search documents"
                  value={(table.state.globalFilter as string | undefined) ?? ""}
                  onChange={(e) => table.setGlobalFilter(e.target.value)}
                />
              </InputGroup>
            </div>
            <div className="w-full max-w-2xs">
              <Label htmlFor="documents-status" className="sr-only">
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
                value={statusFilter}
                onValueChange={(value: string | null) => {
                  table
                    .getColumn("status")
                    ?.setFilterValue(value === "all" || value === null ? undefined : value);
                }}
              >
                <SelectTrigger id="documents-status" className="w-full">
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
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="h-14 border-t">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: `${header.getSize()}px` }}
                    className="text-muted-foreground first:pl-4 last:pr-4 last:text-right"
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <div
                        className={cn(
                          "flex h-full cursor-pointer items-center gap-2 select-none",
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            header.column.getToggleSortingHandler()?.(e);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {{
                          asc: (
                            <ChevronUp
                              aria-hidden
                              className="size-4 shrink-0 opacity-60"
                            />
                          ),
                          desc: (
                            <ChevronDown
                              aria-hidden
                              className="size-4 shrink-0 opacity-60"
                            />
                          ),
                        }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No documents match.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "h-14 first:pl-4 last:pr-4 last:text-right",
                        cell.column.id === "title" && "max-w-0",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
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
            {filteredCount === 0 ? 0 : pageIndex * pageSize + 1} to{" "}
            {Math.min((pageIndex + 1) * pageSize, filteredCount)}
          </span>{" "}
          of <span>{filteredCount} documents</span>
        </p>
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Go to previous page"
          >
            <ChevronLeft aria-hidden />
            Previous
          </Button>
          {leftEllipsis ? (
            <span className="text-muted-foreground px-1">…</span>
          ) : null}
          {pages.map((p) => {
            const isActive = p === pageIndex + 1;
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
                onClick={() => table.setPageIndex(p - 1)}
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
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
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
