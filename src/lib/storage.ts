export type BlobStore = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
};

export type ObjectKind = "original" | "sealed" | "certificate" | "source";

export function objectKey(documentId: string, kind: ObjectKind): string {
  return kind === "source"
    ? `${documentId}/source.md`
    : `${documentId}/${kind}.pdf`;
}

export function appearanceKey(documentId: string, signerId: string): string {
  return `${documentId}/appearance/${signerId}.png`;
}

export function fieldAppearanceKey(
  documentId: string,
  signerId: string,
  fieldName: string,
): string {
  return `${documentId}/appearance/${signerId}/${encodeURIComponent(fieldName)}.png`;
}

export { createFsStore } from "./storage/fs.js";
export {
  createSupabaseStore,
  type SupabaseStorageClient,
} from "./storage/supabase.js";
