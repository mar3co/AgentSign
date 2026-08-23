"use client";

import { useEffect, useState } from "react";
import { LoadingList } from "@/components/loading-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DocumentsList,
  type DocumentListItem,
} from "./documents-list";

export function DocumentsClient() {
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/documents", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/documents")}`;
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!cancelled) setError(body?.error ?? "Could not load documents.");
          return;
        }
        const json = (await res.json()) as {
          documents: Array<DocumentListItem & { can_delete?: boolean }>;
        };
        if (!cancelled) {
          setDocuments(
            json.documents.map((e) => ({
              ...e,
              canDelete: Boolean(e.can_delete),
              signers: e.signers ?? [],
            })),
          );
        }
      } catch {
        if (!cancelled) setError("Could not load documents.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (documents === null) {
    return <LoadingList />;
  }

  async function onVoid(id: string) {
    const res = await fetch(`/v1/documents/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      setError("Could not void document.");
      return;
    }
    setDocuments((prev) => (prev ?? []).filter((e) => e.id !== id));
  }

  async function onSaveTemplate(id: string) {
    const res = await fetch("/v1/templates", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document_id: id }),
    });
    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent("/documents")}`;
      return;
    }
    if (res.status === 403) {
      window.location.href = "/upgrade";
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(body?.error ?? "Could not save template.");
      return;
    }
    window.location.href = "/templates";
  }

  return (
    <DocumentsList
      documents={documents}
      onVoid={onVoid}
      onSaveTemplate={onSaveTemplate}
    />
  );
}
