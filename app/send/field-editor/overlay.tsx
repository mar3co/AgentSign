"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { DocumentField, FieldType } from "@/src/lib/pdf/fields";
import {
  clampToPage,
  makePlacedField,
  signerColor,
  type PlacedField,
} from "@/app/send/field-model";
import { clickToPercent, deltaToPercent } from "@/app/send/field-editor/pointer";

const TYPE_LABELS: Record<FieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  name: "Name",
  text: "Text",
  checkbox: "Checkbox",
};

const MIN_SIZE = 2;

function FieldBox({
  field,
  layerRef,
  onChange,
  onDelete,
}: {
  field: PlacedField;
  layerRef: React.RefObject<HTMLDivElement | null>;
  onChange: (f: PlacedField) => void;
  onDelete: (id: string) => void;
}) {
  const dragRef = useRef<{ x: number; y: number; field: PlacedField } | null>(
    null,
  );
  const resizeRef = useRef<{
    x: number;
    y: number;
    field: PlacedField;
  } | null>(null);
  const color = signerColor(field.signerIndex);

  function onMoveDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, field };
  }
  function onMoveMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    const rect = layerRef.current?.getBoundingClientRect();
    const dx = deltaToPercent(e.clientX - start.x, rect?.width ?? 0);
    const dy = deltaToPercent(e.clientY - start.y, rect?.height ?? 0);
    onChange(
      clampToPage({ ...start.field, x: start.field.x + dx, y: start.field.y + dy }),
    );
  }
  function onMoveUp() {
    dragRef.current = null;
  }

  function onResizeDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = { x: e.clientX, y: e.clientY, field };
  }
  function onResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    const start = resizeRef.current;
    if (!start) return;
    const rect = layerRef.current?.getBoundingClientRect();
    const dw = deltaToPercent(e.clientX - start.x, rect?.width ?? 0);
    const dh = deltaToPercent(e.clientY - start.y, rect?.height ?? 0);
    onChange(
      clampToPage({
        ...start.field,
        w: Math.max(MIN_SIZE, start.field.w + dw),
        h: Math.max(MIN_SIZE, start.field.h + dh),
      }),
    );
  }
  function onResizeUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    resizeRef.current = null;
  }

  const showRequiredToggle = field.type === "text" || field.type === "checkbox";

  return (
    <div
      className="absolute flex cursor-move select-none items-center justify-between rounded-sm border-2 px-1 text-[10px]"
      style={{
        left: field.x + "%",
        top: field.y + "%",
        width: field.w + "%",
        height: field.h + "%",
        borderColor: color,
        background: color + "1a",
      }}
      onPointerDown={onMoveDown}
      onPointerMove={onMoveMove}
      onPointerUp={onMoveUp}
    >
      <span className="truncate">{TYPE_LABELS[field.type]}</span>
      <div className="flex items-center gap-1">
        {showRequiredToggle ? (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onChange({ ...field, required: !field.required });
            }}
            className="rounded border px-1"
          >
            {field.required ? "Required" : "Optional"}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Delete field"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(field.id);
          }}
          className="rounded border px-1"
        >
          ×
        </button>
      </div>
      <div
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        className="absolute bottom-0 right-0 h-2 w-2 cursor-nwse-resize bg-current opacity-60"
      />
    </div>
  );
}

export function FieldOverlay(props: {
  pageIndex: number;
  fields: PlacedField[];
  tagFields?: DocumentField[];
  placing: { signerIndex: number; type: FieldType } | null;
  onPlace: (f: PlacedField) => void;
  onChange: (f: PlacedField) => void;
  onDelete: (id: string) => void;
}) {
  const { pageIndex, fields, tagFields, placing, onPlace, onChange, onDelete } =
    props;
  const layerRef = useRef<HTMLDivElement>(null);
  const page = pageIndex + 1;
  const pageFields = fields.filter((f) => f.page === page);

  function handlePlaceClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!placing) return;
    if (e.target !== e.currentTarget) return;
    const rect = layerRef.current?.getBoundingClientRect();
    const { x, y } = rect
      ? clickToPercent(rect, e.clientX, e.clientY)
      : { x: 0, y: 0 };
    onPlace(makePlacedField(placing.type, placing.signerIndex, page, x, y));
  }

  return (
    <div
      ref={layerRef}
      data-testid="field-layer"
      className="absolute inset-0"
      style={{ cursor: placing ? "crosshair" : undefined }}
      onClick={handlePlaceClick}
    >
      {tagFields?.map((tf, i) =>
        tf.areas
          .filter((a) => a.page === page)
          .map((area, j) => (
            <div
              key={`tag-${i}-${j}`}
              className="absolute flex items-center border border-dashed border-gray-400 bg-gray-400/10 px-1 text-[10px] text-gray-600"
              style={{
                left: area.x + "%",
                top: area.y + "%",
                width: area.w + "%",
                height: area.h + "%",
              }}
            >
              {tf.type} · from tags
            </div>
          )),
      )}
      {pageFields.map((f) => (
        <FieldBox
          key={f.id}
          field={f}
          layerRef={layerRef}
          onChange={onChange}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
