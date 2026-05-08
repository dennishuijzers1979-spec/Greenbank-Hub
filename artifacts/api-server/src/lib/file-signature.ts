/**
 * Magic-byte / signature validation for uploaded documents.
 * Cross-checks extension, declared MIME type and the actual file
 * content. Blocks mismatches.
 */

export type SignatureCheckResult = {
  ok: boolean;
  reason?: string;
};

const PDF_MAGIC = Buffer.from("%PDF-");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // xlsx & docx
const ZIP_EMPTY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP_SPANNED = Buffer.from([0x50, 0x4b, 0x07, 0x08]);
const OLE_MAGIC = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]); // legacy .doc/.xls

const EXT_TO_MIMES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
  ],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/octet-stream",
  ],
  doc: ["application/msword", "application/octet-stream"],
  csv: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
};

function startsWith(buf: Buffer, magic: Buffer): boolean {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

function isLikelyCsv(buf: Buffer): boolean {
  // CSV has no signature — heuristic: printable ASCII / UTF-8 with at least
  // one delimiter in the first 4 KB.
  const head = buf.subarray(0, Math.min(buf.length, 4096));
  let printable = 0;
  let total = 0;
  let hasDelim = false;
  for (const b of head) {
    total++;
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126) || b >= 0xc0) {
      printable++;
    }
    if (b === 0x2c || b === 0x3b || b === 0x09) hasDelim = true;
  }
  return total > 0 && printable / total > 0.95 && hasDelim;
}

function extOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function validateFileSignature(args: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): SignatureCheckResult {
  const { filename, mimeType, buffer } = args;
  const ext = extOf(filename);
  if (!ext) {
    return { ok: false, reason: "Bestandsextensie ontbreekt." };
  }

  const allowedMimes = EXT_TO_MIMES[ext];
  if (!allowedMimes) {
    return { ok: false, reason: `Extensie .${ext} wordt niet ondersteund.` };
  }
  if (!allowedMimes.includes(mimeType)) {
    return {
      ok: false,
      reason: `MIME-type '${mimeType}' past niet bij extensie .${ext}.`,
    };
  }

  if (buffer.length === 0) {
    return { ok: false, reason: "Bestand is leeg." };
  }

  switch (ext) {
    case "pdf":
      if (!startsWith(buffer, PDF_MAGIC)) {
        return { ok: false, reason: "PDF-signature niet gevonden." };
      }
      return { ok: true };
    case "png":
      if (!startsWith(buffer, PNG_MAGIC)) {
        return { ok: false, reason: "PNG-signature niet gevonden." };
      }
      return { ok: true };
    case "jpg":
    case "jpeg":
      if (!startsWith(buffer, JPG_MAGIC)) {
        return { ok: false, reason: "JPEG-signature niet gevonden." };
      }
      return { ok: true };
    case "xlsx":
    case "docx":
      if (
        !startsWith(buffer, ZIP_MAGIC) &&
        !startsWith(buffer, ZIP_EMPTY) &&
        !startsWith(buffer, ZIP_SPANNED)
      ) {
        return {
          ok: false,
          reason: `${ext.toUpperCase()}-bestand heeft geen geldige ZIP-container.`,
        };
      }
      return { ok: true };
    case "xls":
    case "doc":
      if (!startsWith(buffer, OLE_MAGIC)) {
        return {
          ok: false,
          reason: `${ext.toUpperCase()}-bestand heeft geen geldige OLE-signature.`,
        };
      }
      return { ok: true };
    case "csv":
      if (!isLikelyCsv(buffer)) {
        return { ok: false, reason: "CSV-inhoud is niet leesbaar als tekst." };
      }
      return { ok: true };
  }

  return { ok: false, reason: "Onbekend bestandstype." };
}
