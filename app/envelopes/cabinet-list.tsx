"use client";

import { Send } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGES[status] ?? { label: status, dot: "bg-muted-foreground" };
  return (
    <Badge variant="outline" className="gap-1.5 whitespace-nowrap">
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${s.dot}`} />
      {s.label}
    </Badge>
  );
}

function partyLine(p: CabinetParty): string {
  const who = p.kind === "agent" ? (p.agent ?? p.name) : p.name;
  const state = p.signed_at ? "signed" : p.attested_at ? "attested" : "waiting";
  return `${who} · ${p.kind} · ${state}`;
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
  return (
    <Card>
      <CardContent>
        {envelopes.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No envelopes yet"
            description="Send a PDF and it shows up here with where it stands."
          >
            <LinkButton href="/">Send a PDF</LinkButton>
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="w-40">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {envelopes.map((env) => (
                <TableRow key={env.id}>
                  <TableCell className="font-medium whitespace-normal">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span>{env.title}</span>
                      {env.signers && env.signers.length > 0 ? (
                        <ul className="text-sm font-normal text-muted-foreground">
                          {env.signers.map((p, i) => (
                            <li key={`${env.id}-${p.email}-${i}`}>{partyLine(p)}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={env.status} />
                  </TableCell>
                  <TableCell className="text-right">
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
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onVoid?.(env.id)}
                        >
                          Void
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
