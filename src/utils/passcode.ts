// src/utils/passcode.ts
const KEY = 'passcode_hash';
const SALT_KEY = 'passcode_salt';

export function hasPasscode(): boolean {
  return !!localStorage.getItem(KEY);
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function setPasscode(pass: string) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passBuf = enc.encode(pass); // Uint8Array は BufferSource としてOK

  const salted = new Uint8Array(salt.byteLength + passBuf.byteLength);
  salted.set(salt, 0);
  salted.set(passBuf, salt.byteLength);

  const hashHex = await sha256(salted.buffer);
  localStorage.setItem(KEY, hashHex);
  localStorage.setItem(SALT_KEY, Array.from(salt).join(','));
}

export async function verifyPasscode(pass: string): Promise<boolean> {
  const enc = new TextEncoder();
  const saltStr = localStorage.getItem(SALT_KEY);
  const saved = localStorage.getItem(KEY);
  if (!saltStr || !saved) return false;

  const salt = new Uint8Array(saltStr.split(',').map((n) => Number(n)));
  const passBuf = enc.encode(pass);

  const salted = new Uint8Array(salt.byteLength + passBuf.byteLength);
  salted.set(salt, 0);
  salted.set(passBuf, salt.byteLength);

  const hashHex = await sha256(salted.buffer);
  return hashHex === saved;
}
