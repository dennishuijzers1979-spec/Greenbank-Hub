import { promises as fs } from "node:fs";
import path from "node:path";

const STORAGE_ROOT =
  process.env.DOCUMENT_STORAGE_ROOT ??
  path.join(process.cwd(), "data", "documents");

export type StoredDocument = {
  storagePath: string;
  sizeBytes: number;
};

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function persistDocument(args: {
  dossierId: string;
  documentId: string;
  filename: string;
  contentBase64: string;
}): Promise<StoredDocument> {
  const dir = path.join(STORAGE_ROOT, args.dossierId);
  await ensureDir(dir);
  const safeName = args.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(dir, `${args.documentId}-${safeName}`);
  const buf = Buffer.from(args.contentBase64, "base64");
  await fs.writeFile(filePath, buf);
  return {
    storagePath: path.relative(process.cwd(), filePath),
    sizeBytes: buf.length,
  };
}

export async function readDocument(storagePath: string): Promise<Buffer> {
  const abs = path.isAbsolute(storagePath)
    ? storagePath
    : path.join(process.cwd(), storagePath);
  return fs.readFile(abs);
}

export async function deleteDocument(storagePath: string): Promise<void> {
  if (!storagePath || storagePath.startsWith("mock://")) return;
  const abs = path.isAbsolute(storagePath)
    ? storagePath
    : path.join(process.cwd(), storagePath);
  try {
    await fs.unlink(abs);
  } catch {
    // best-effort — file may have been removed already
  }
}
