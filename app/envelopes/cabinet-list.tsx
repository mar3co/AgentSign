"use client";

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
          <p className="text-base text-muted-foreground">No envelopes yet.</p>
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
                          <a
                            className="text-sm underline"
                            href={`/v1/envelopes/${env.id}/pdf`}
                          >
                            Download
                          </a>
                          <a
                            className="text-sm underline"
                            href={`/v1/envelopes/${env.id}/pdf?kind=certificate`}
                          >
                            Certificate
                          </a>
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
