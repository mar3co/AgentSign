"use client";

import { useState, type FormEvent } from "react";
import { Palette } from "lucide-react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UploadDropzone } from "@/components/upload-dropzone";

export type BrandingFormProps = {
  entitled: boolean;
  displayName?: string | null;
  hasLogo?: boolean;
  canEdit?: boolean;
};

export function BrandingForm({
  entitled,
  displayName = null,
  hasLogo = false,
  canEdit = false,
}: BrandingFormProps) {
  const [logoOn, setLogoOn] = useState(hasLogo);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!entitled) {
    return (
      <UpgradeGate
        icon={Palette}
        title="Make envelopes look like yours"
        description="Pro adds your shop name and logo to invite mail and the signing page."
      />
    );
  }

  if (!canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardDescription>This cabinet&apos;s name and logo.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {displayName ? (
            <p className="text-base">{displayName}</p>
          ) : (
            <p className="text-base text-muted-foreground">No display name.</p>
          )}
          <p className="text-sm text-muted-foreground">
            {logoOn ? "Logo uploaded." : "No logo."}
          </p>
        </CardContent>
      </Card>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    const data = new FormData(e.currentTarget);
    const logo = data.get("logo");
    if (logo instanceof File && logo.size === 0) data.delete("logo");
    try {
      const res = await fetch("/v1/branding", {
        method: "PUT",
        credentials: "include",
        body: data,
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/settings/branding")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not save branding.");
        return;
      }
      const json = (await res.json()) as {
        display_name: string | null;
        has_logo: boolean;
      };
      setLogoOn(json.has_logo);
      setSaved(true);
    } catch {
      setError("Could not save branding.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveLogo() {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const res = await fetch("/v1/branding/logo", {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/settings/branding")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not remove logo.");
        return;
      }
      setLogoOn(false);
      setSaved(true);
    } catch {
      setError("Could not remove logo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Shown on invite mail and the signing page. Not on the sealed PDF.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="display_name">Display name</Label>
            <Input
              id="display_name"
              name="display_name"
              maxLength={80}
              defaultValue={displayName ?? ""}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="logo">Logo</Label>
            <UploadDropzone
              id="logo"
              name="logo"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              prompt="Drag & Drop or Choose a logo to upload"
              hint="PNG or JPEG."
            />
            {logoOn ? (
              <p className="text-sm text-muted-foreground">A logo is already saved.</p>
            ) : null}
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {saved ? (
            <Alert>
              <AlertDescription>Saved.</AlertDescription>
            </Alert>
          ) : null}
          <Button className="self-start" type="submit" disabled={busy}>
            Save
          </Button>
          {logoOn ? (
            <Button
              className="self-start"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onRemoveLogo}
            >
              Remove logo
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
