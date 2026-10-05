import type { Portfolio } from "../shared/types";
import { portfolioSchema } from "../shared/schema";
/*
 * End-to-end encrypted portfolio sync.
 *
 * PBKDF2-SHA256 (600k iterations) turns username + password into 64 bytes:
 *   - the first 32 become the auth token sent to the API (it locates the vault),
 *   - the last 32 become an AES-GCM key that never leaves this browser.
 * The API stores only { v, iv, data } ciphertext. A forgotten password cannot be
 * recovered by anyone, including the site owner.
 */
export const PBKDF2_ITERATIONS = 600_000;
export type SyncCredentials = {
  username: string;
  /** Hex auth token: proves knowledge of the password without revealing it. */
  token: string;
  /** Base64 AES-256-GCM key bytes, kept in this browser only. */
  key: string;
};
export type VaultEnvelope = { v: 1; iv: string; data: string };
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export const normalizeUsername = (username: string) =>
  username.trim().toLowerCase();
/** Returns a message for invalid input, or null when the credentials can be used. */
export function credentialProblem(username: string, password: string) {
  if (!/^[a-z0-9._-]{3,40}$/.test(normalizeUsername(username)))
    return "Use 3–40 letters, numbers, dots, dashes or underscores for the username.";
  if (password.length < 10) return "Use a password of at least 10 characters.";
  if (password.length > 200) return "Use a password under 200 characters.";
  return null;
}
export function toBase64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
export function fromBase64(text: string) {
  const raw = atob(text),
    bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function deriveCredentials(
  username: string,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<SyncCredentials> {
  const user = normalizeUsername(username),
    problem = credentialProblem(user, password);
  if (problem) throw new Error(problem);
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: encoder.encode(`pulse-sync:v1:${user}`),
        iterations,
      },
      base,
      512,
    ),
  );
  return {
    username: user,
    token: hex(bits.subarray(0, 32)),
    key: toBase64(bits.subarray(32, 64)),
  };
}
const aesKey = (credentials: SyncCredentials) =>
  crypto.subtle.importKey(
    "raw",
    fromBase64(credentials.key),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
// Binds ciphertext to its account, so an envelope cannot be replayed into another one.
const context = (credentials: SyncCredentials) =>
  encoder.encode(`pulse-vault:v1:${credentials.username}`);
export async function encryptPortfolio(
  credentials: SyncCredentials,
  portfolio: Portfolio,
): Promise<VaultEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: context(credentials) },
    await aesKey(credentials),
    encoder.encode(JSON.stringify({ portfolio, savedAt: new Date().toISOString() })),
  );
  return { v: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}
export async function decryptPortfolio(
  credentials: SyncCredentials,
  envelope: VaultEnvelope,
): Promise<Portfolio> {
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(envelope.iv),
        additionalData: context(credentials),
      },
      await aesKey(credentials),
      fromBase64(envelope.data),
    );
  } catch {
    throw new Error(
      "The synced portfolio could not be decrypted with this password.",
    );
  }
  const parsed = portfolioSchema.safeParse(
    JSON.parse(decoder.decode(plain)).portfolio,
  );
  if (!parsed.success)
    throw new Error("The synced portfolio is not in a format Pulse understands.");
  return parsed.data;
}
