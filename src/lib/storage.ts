export type BlobStore = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
};

export type ObjectKind = "original" | "sealed" | "certificate";

export function objectKey(envelopeId: string, kind: ObjectKind): string {
  return `${envelopeId}/${kind}.pdf`;
}

export function appearanceKey(envelopeId: string, signerId: string): string {
  return `${envelopeId}/appearance/${signerId}.png`;
}

export { createFsStore } from "./storage/fs.js";
export {
  createSupabaseStore,
  type SupabaseStorageClient,
} from "./storage/supabase.js";
