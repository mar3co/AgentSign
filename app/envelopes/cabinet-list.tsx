"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type CabinetEnvelope = {
  id: string;
  title: string;
  status: string;
  canDelete?: boolean;
};

export function CabinetList({
  envelopes,
  onVoid,
}: {
  envelopes: CabinetEnvelope[];
  onVoid?: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cabinet</CardTitle>
        <CardDescription>
          Envelopes you sent or signed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {envelopes.length === 0 ? (
          <p className="text-base text-muted-foreground">No envelopes yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {envelopes.map((env) => (
              <li
                key={env.id}
                className="flex items-baseline justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
              >
                <span className="text-base font-medium">{env.title}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {env.status}
                  </span>
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
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
