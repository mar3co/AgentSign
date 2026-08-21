import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type AuthorizeAgent = {
  id: string;
  slug: string;
  name: string;
};

export function AuthorizeForm({
  clientName,
  clientId,
  redirectUri,
  state,
  codeChallenge,
  resource,
  agents,
}: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  resource: string;
  agents: AuthorizeAgent[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {clientName} wants to use your AgentSign account.
        </CardTitle>
        <CardDescription>
          Send, status, and download. Attest only for agents you allow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" action="/oauth/authorize" className="flex flex-col gap-3">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <input type="hidden" name="resource" value={resource} />
          {agents.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Allow attest as…</legend>
              <input type="hidden" name="agent_ids[]" value="" />
              {agents.map((agent) => (
                <label
                  key={agent.id}
                  className="flex items-start gap-3 text-base leading-snug"
                >
                  <input
                    type="checkbox"
                    name="agent_ids[]"
                    value={agent.id}
                    defaultChecked
                    className="mt-1 size-4"
                  />
                  <span>
                    {agent.slug}
                    <span className="ml-2 text-sm text-muted-foreground">
                      {agent.name}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <Button className="h-11 w-full text-base" type="submit">
            Allow
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
