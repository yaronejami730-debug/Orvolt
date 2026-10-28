/**
 * Lit le corps d'une requête avec une limite stricte (le Content-Length n'est pas fiable, `req.text()` ne borne rien).
 * Renvoie null dès que la limite est dépassée (le flux est alors annulé).
 */
export async function readBodyLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
