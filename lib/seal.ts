// Authenticated encryption for every token this server issues. Nothing is stored
// server-side: auth codes, access/refresh tokens, client registrations and OAuth
// state are all AES-256-GCM sealed blobs that only this deployment can open.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type Sealed =
  | { typ: "client"; redirect_uris: string[]; name?: string }
  | {
      typ: "state";
      cid: string;
      redirect_uri: string;
      state?: string;
      challenge: string;
      exp: number;
    }
  | {
      typ: "code";
      cid: string;
      redirect_uri: string;
      challenge: string;
      ya: string;
      yr: string;
      yexp: number;
      guid: string;
      exp: number;
    }
  | { typ: "access"; ya: string; guid: string; cid: string; exp: number }
  | { typ: "refresh"; yr: string; guid: string; cid: string };

function key(): Buffer {
  const secret = process.env.TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("TOKEN_SECRET must be set to a random string of at least 32 characters");
  }
  return createHash("sha256").update(secret).digest();
}

export function seal(payload: Sealed): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Open a sealed blob of the expected type; returns null if tampered, wrong type, or expired. */
export function open<T extends Sealed["typ"]>(
  token: string | null | undefined,
  typ: T,
): Extract<Sealed, { typ: T }> | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const p = JSON.parse(json) as Sealed;
    if (p.typ !== typ) return null;
    if ("exp" in p && p.exp < Date.now() / 1000) return null;
    return p as Extract<Sealed, { typ: T }>;
  } catch {
    return null;
  }
}

export const now = () => Math.floor(Date.now() / 1000);
