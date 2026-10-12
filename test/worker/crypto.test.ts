import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, gitBlobSha, needsReencryption } from '../../worker/lib/crypto';
import { TEST_ENCRYPTION_KEY } from '../helpers/env';

const keys = { ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };
const other = Buffer.alloc(32, 9).toString('base64');

describe('credential encryption', () => {
  it('round-trips and never stores plaintext', async () => {
    const ct = await encryptSecret(keys, 'shpat_secret_value', 'shopify-offline-access:a.myshopify.com');
    expect(ct).toMatch(/^v1\.[0-9a-f]{8}\./);
    expect(ct).not.toContain('shpat_secret_value');
    expect(await decryptSecret(keys, ct, 'shopify-offline-access:a.myshopify.com')).toBe('shpat_secret_value');
  });

  it('binds ciphertext to its context (AAD): another shop cannot decrypt it', async () => {
    const ct = await encryptSecret(keys, 'token', 'shopify-offline-access:a.myshopify.com');
    await expect(decryptSecret(keys, ct, 'shopify-offline-access:b.myshopify.com')).rejects.toThrow();
  });

  it('decrypts with ENCRYPTION_KEY_PREVIOUS during key rotation', async () => {
    const ct = await encryptSecret({ ENCRYPTION_KEY: other }, 'token', 'ctx');
    const rotated = { ENCRYPTION_KEY: TEST_ENCRYPTION_KEY, ENCRYPTION_KEY_PREVIOUS: other };
    expect(await decryptSecret(rotated, ct, 'ctx')).toBe('token');
    expect(await needsReencryption(rotated, ct)).toBe(true);
    await expect(decryptSecret(keys, ct, 'ctx')).rejects.toThrow(/No encryption key/);
  });

  it('rejects keys that are not 32 bytes', async () => {
    await expect(encryptSecret({ ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }, 'x', 'c')).rejects.toThrow(
      /32 bytes/,
    );
  });
});

describe('gitBlobSha', () => {
  it('matches git hash-object', async () => {
    expect(await gitBlobSha(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha(new TextEncoder().encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});
