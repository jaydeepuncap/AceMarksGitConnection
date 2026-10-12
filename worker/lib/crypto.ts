/**
 * Web Crypto helpers (no Node.js APIs): credential encryption, HMAC
 * verification, constant-time comparison and Git blob hashing.
 *
 * Credential encryption
 *   Algorithm : AES-256-GCM, random 96-bit IV per value
 *   Key       : ENCRYPTION_KEY secret (base64, 32 bytes)
 *   AAD       : a caller-supplied context such as "shopify-offline:{shop}"; a
 *               ciphertext moved to another shop's row or field fails to decrypt
 *   Format    : v1.<keyId>.<iv b64url>.<ciphertext b64url>
 *               keyId = first 8 hex chars of SHA-256(key), so rotation can keep
 *               ENCRYPTION_KEY_PREVIOUS around for decryption only.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

// ---------------------------------------------------------------------------
// Hashing / HMAC
// ---------------------------------------------------------------------------
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

const hmacKeyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = hmacKeyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    hmacKeyCache.set(secret, key);
  }
  return key;
}

export async function hmacSha256(secret: string, data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), bytes));
}

/** Constant-time comparison of two strings (length leak only). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

/**
 * Git blob object ID: SHA-1("blob <len>\0" + content). Used to prove that bytes
 * fetched from GitHub are exactly the blob recorded in the selected commit.
 */
export async function gitBlobSha(content: Uint8Array): Promise<string> {
  const header = encoder.encode(`blob ${content.byteLength}\0`);
  const buf = new Uint8Array(header.byteLength + content.byteLength);
  buf.set(header, 0);
  buf.set(content, header.byteLength);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-1', buf)));
}

// ---------------------------------------------------------------------------
// AES-GCM credential encryption
// ---------------------------------------------------------------------------
interface KeyMaterial {
  id: string;
  key: CryptoKey;
}

const aesKeyCache = new Map<string, Promise<KeyMaterial>>();

function loadAesKey(b64: string): Promise<KeyMaterial> {
  let entry = aesKeyCache.get(b64);
  if (!entry) {
    entry = (async () => {
      const raw = base64ToBytes(b64);
      if (raw.byteLength !== 32) {
        throw new Error('Encryption key must be 32 bytes (base64-encoded)');
      }
      const id = (await sha256Hex(raw)).slice(0, 8);
      const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      return { id, key };
    })();
    aesKeyCache.set(b64, entry);
    entry.catch(() => aesKeyCache.delete(b64));
  }
  return entry;
}

export interface EncryptionKeys {
  ENCRYPTION_KEY: string;
  ENCRYPTION_KEY_PREVIOUS?: string;
}

export async function encryptSecret(keys: EncryptionKeys, plaintext: string, aad: string): Promise<string> {
  const { id, key } = await loadAesKey(keys.ENCRYPTION_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  );
  return `v1.${id}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(keys: EncryptionKeys, payload: string, aad: string): Promise<string> {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unsupported ciphertext format');
  const [, keyId, ivPart, ctPart] = parts as [string, string, string, string];

  const candidates = [keys.ENCRYPTION_KEY, keys.ENCRYPTION_KEY_PREVIOUS].filter(
    (k): k is string => typeof k === 'string' && k.length > 0,
  );
  for (const candidate of candidates) {
    const material = await loadAesKey(candidate);
    if (material.id !== keyId) continue;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(ivPart), additionalData: encoder.encode(aad) },
      material.key,
      base64UrlToBytes(ctPart),
    );
    return decoder.decode(plaintext);
  }
  throw new Error('No encryption key matches this ciphertext (was ENCRYPTION_KEY rotated?)');
}

/** True when the value was encrypted with a key other than the current ENCRYPTION_KEY. */
export async function needsReencryption(keys: EncryptionKeys, payload: string): Promise<boolean> {
  const { id } = await loadAesKey(keys.ENCRYPTION_KEY);
  return payload.split('.')[1] !== id;
}
