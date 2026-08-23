import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/** The full-page card shown when a portal page needs a Pro plan. */
export function UpgradeGate({
  icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={icon}
          title={title}
          titleBadge={<Badge variant="secondary">Pro</Badge>}
          description={description}
        >
          <LinkButton href="/upgrade" size="sm">
            Upgrade
          </LinkButton>
        </EmptyState>
      </CardContent>
    </Card>
  );
}
