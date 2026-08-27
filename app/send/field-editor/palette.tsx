"use client";

import { fieldTypes, type FieldType } from "@/src/lib/pdf/fields";
import { signerColor } from "@/app/send/field-model";

const TYPE_LABELS: Record<FieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  name: "Name",
  text: "Text",
  checkbox: "Checkbox",
};

export function FieldPalette(props: {
  signers: { name: string; email: string }[];
  activeSigner: number;
  onSignerChange: (index: number) => void;
  activeType: FieldType | null;
  onTypeChange: (type: FieldType | null) => void;
  whiteoutActive: boolean;
  onWhiteoutChange: (active: boolean) => void;
}) {
  const {
    signers,
    activeSigner,
    onSignerChange,
    activeType,
    onTypeChange,
    whiteoutActive,
    onWhiteoutChange,
  } = props;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {signers.map((signer, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={activeSigner === i}
            onClick={() => onSignerChange(i)}
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm data-[active=true]:border-foreground"
            data-active={activeSigner === i}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: signerColor(i) }}
            />
            {signer.name.trim() || `Signer ${i + 1}`}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {fieldTypes.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={activeType === type}
            onClick={() => {
              if (activeType !== type) onWhiteoutChange(false);
              onTypeChange(activeType === type ? null : type);
            }}
            className="rounded-md border px-2.5 py-1 text-sm data-[active=true]:border-foreground data-[active=true]:bg-muted"
            data-active={activeType === type}
          >
            {TYPE_LABELS[type]}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={whiteoutActive}
          onClick={() => {
            if (!whiteoutActive) onTypeChange(null);
            onWhiteoutChange(!whiteoutActive);
          }}
          className="rounded-md border px-2.5 py-1 text-sm data-[active=true]:border-foreground data-[active=true]:bg-muted"
          data-active={whiteoutActive}
        >
          Whiteout
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Covers content with white; typed text uses a standard font.
      </p>
    </div>
  );
}
