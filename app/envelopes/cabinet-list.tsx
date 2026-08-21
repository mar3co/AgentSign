"use client";

import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CabinetEnvelope = {
  id: string;
  title: string;
  status: string;
  canDelete?: boolean;
};

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
      <CardHeader>
        <CardTitle>Cabinet</CardTitle>
        <CardDescription>Envelopes you sent or signed.</CardDescription>
      </CardHeader>
      <CardContent>
        {envelopes.length === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-base text-muted-foreground">No envelopes yet.</p>
            <LinkButton href="/" className="h-11 w-full text-base sm:w-auto">
              Send a PDF
            </LinkButton>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {envelopes.map((env) => (
                <TableRow key={env.id}>
                  <TableCell className="font-medium whitespace-normal">
                    {env.title}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{env.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {env.status === "completed" ? (
                        <>
                          <LinkButton
                            href={`/v1/envelopes/${env.id}/pdf`}
                            variant="outline"
                            className="h-8 text-sm"
                          >
                            Download
                          </LinkButton>
                          <LinkButton
                            href={`/v1/envelopes/${env.id}/pdf?kind=certificate`}
                            variant="outline"
                            className="h-8 text-sm"
                          >
                            Certificate
                          </LinkButton>
                        </>
                      ) : null}
                      {env.status === "completed" && env.canDelete ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 text-sm"
                          onClick={() => onSavePacket?.(env.id)}
                        >
                          Save as packet
                        </Button>
                      ) : null}
                      {env.canDelete ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 text-sm"
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
