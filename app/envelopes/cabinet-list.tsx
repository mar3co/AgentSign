"use client";

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
};

export function CabinetList({ envelopes }: { envelopes: CabinetEnvelope[] }) {
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
                <span className="shrink-0 text-sm text-muted-foreground">
                  {env.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
