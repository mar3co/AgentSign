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
    <>
      <p className="text-base">
        {clientName} wants to use your AgentSign account.
      </p>
      <p className="text-sm text-muted-foreground">
        Send, status, and download. Attest only for agents you allow.
      </p>
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
        <button
          type="submit"
          className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground"
        >
          Allow
        </button>
      </form>
    </>
  );
}
