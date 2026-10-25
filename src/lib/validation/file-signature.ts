/** Vérifie que les premiers octets correspondent au type annoncé (anti-contournement du MIME déclaré). */
const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((x, i) => b[offset + i] === x);

export function matchesSignature(mime: string, head: Uint8Array): boolean {
  switch (mime) {
    case "image/png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8);
    case "application/pdf":
      return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
    case "text/plain":
    case "text/csv": {
      if (head.includes(0)) return false; // binaire
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(head.slice(0, 4096));
      } catch {
        // une coupure au milieu d'un caractère multi-octets est tolérée
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(head.slice(0, 4093)); } catch { return false; }
      }
      return !/^\s*(<!doctype html|<html|<script|<svg|<\?xml)/i.test(text) && !/<script[\s>]/i.test(text);
    }
    default:
      return false;
  }
}
