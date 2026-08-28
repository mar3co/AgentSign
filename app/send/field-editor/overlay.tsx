"use client";

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { DocumentField, FieldType } from "@/src/lib/pdf/fields";
import {
  clampToPage,
  makePlacedField,
  signerColor,
  type PlacedField,
} from "@/app/send/field-model";
import { clampPatch, makePatch, type PatchBox } from "@/app/send/patch-model";
import {
  clickToPercent,
  commitDragRect,
  deltaToPercent,
  percentRectFromDrag,
} from "@/app/send/field-editor/pointer";

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

function PatchBoxView({
  patch,
  onChange,
  onDelete,
}: {
  patch: PatchBox;
  onChange: (p: PatchBox) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(patch.text);
  const [fontSize, setFontSize] = useState(patch.fontSize);

  function commit() {
    const size = Math.min(48, Math.max(6, fontSize || 6));
    onChange({ ...patch, text, fontSize: size });
    setEditing(false);
  }

  function commitOnEnter(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commit();
  }

  return (
    <div
      className="absolute flex items-center justify-center overflow-hidden border border-gray-300 bg-white text-[10px] text-gray-800"
      style={{
        left: patch.x + "%",
        top: patch.y + "%",
        width: patch.w + "%",
        height: patch.h + "%",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (editing) return;
        setText(patch.text);
        setFontSize(patch.fontSize);
        setEditing(true);
      }}
    >
      {editing ? (
        <div
          className="flex w-full flex-col gap-1 p-1"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            // Only commit when focus leaves the editor entirely, not when
            // it moves between the text and size inputs.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              commit();
            }
          }}
        >
          <input
            aria-label="Patch text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={commitOnEnter}
            className="w-full rounded border px-1 text-[10px]"
          />
          <input
            aria-label="Patch text size"
            type="number"
            min={6}
            max={48}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            onKeyDown={commitOnEnter}
            className="w-full rounded border px-1 text-[10px]"
          />
        </div>
      ) : (
        <span className="w-full truncate px-1 text-left">{patch.text}</span>
      )}
      <button
        type="button"
        aria-label="Delete patch"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(patch.id);
        }}
        className="absolute right-0 top-0 rounded border bg-white px-1 text-[10px] leading-none"
      >
        ×
      </button>
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
  patches: PatchBox[];
  drawingPatch: boolean;
  onPatchAdd: (p: PatchBox) => void;
  onPatchChange: (p: PatchBox) => void;
  onPatchDelete: (id: string) => void;
}) {
  const {
    pageIndex,
    fields,
    tagFields,
    placing,
    onPlace,
    onChange,
    onDelete,
    patches,
    drawingPatch,
    onPatchAdd,
    onPatchChange,
    onPatchDelete,
  } = props;
  const layerRef = useRef<HTMLDivElement>(null);
  const patchDragRef = useRef<{ x: number; y: number } | null>(null);
  const [patchPreview, setPatchPreview] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const page = pageIndex + 1;
  const pageFields = fields.filter((f) => f.page === page);
  const pagePatches = patches.filter((p) => p.page === page);

  function handlePlaceClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!placing) return;
    if (e.target !== e.currentTarget) return;
    const rect = layerRef.current?.getBoundingClientRect();
    const { x, y } = rect
      ? clickToPercent(rect, e.clientX, e.clientY)
      : { x: 0, y: 0 };
    onPlace(makePlacedField(placing.type, placing.signerIndex, page, x, y));
  }

  function onPatchPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drawingPatch) return;
    if (e.target !== e.currentTarget) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    patchDragRef.current = { x: e.clientX, y: e.clientY };
    setPatchPreview({ x: 0, y: 0, w: 0, h: 0 });
  }

  function onPatchPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = patchDragRef.current;
    if (!start) return;
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPatchPreview(
      percentRectFromDrag(rect, start.x, start.y, e.clientX, e.clientY),
    );
  }

  function onPatchPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const start = patchDragRef.current;
    patchDragRef.current = null;
    setPatchPreview(null);
    if (!start) return;
    const rect = layerRef.current?.getBoundingClientRect();
    const dragRect = rect
      ? commitDragRect(rect, start.x, start.y, e.clientX, e.clientY)
      : null;
    if (!dragRect) return;
    onPatchAdd(
      clampPatch(makePatch(page, dragRect.x, dragRect.y, dragRect.w, dragRect.h)),
    );
  }

  return (
    <div
      ref={layerRef}
      data-testid="field-layer"
      className="absolute inset-0"
      style={{ cursor: placing || drawingPatch ? "crosshair" : undefined }}
      onClick={handlePlaceClick}
      onPointerDown={onPatchPointerDown}
      onPointerMove={onPatchPointerMove}
      onPointerUp={onPatchPointerUp}
    >
      {pagePatches.map((p) => (
        <PatchBoxView
          key={p.id}
          patch={p}
          onChange={onPatchChange}
          onDelete={onPatchDelete}
        />
      ))}
      {/* Above patches: a whiteout can't remove a tag field, so its
          indicator must stay visible even when covered. */}
      {tagFields?.map((tf, i) =>
        tf.areas
          .filter((a) => a.page === page)
          .map((area, j) => (
            <div
              key={`tag-${i}-${j}`}
              className="pointer-events-none absolute flex items-center border border-dashed border-gray-400 bg-gray-400/10 px-1 text-[10px] text-gray-600"
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
      {patchPreview ? (
        <div
          className="pointer-events-none absolute border border-dashed border-gray-400 bg-white/60"
          style={{
            left: patchPreview.x + "%",
            top: patchPreview.y + "%",
            width: patchPreview.w + "%",
            height: patchPreview.h + "%",
          }}
        />
      ) : null}
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
