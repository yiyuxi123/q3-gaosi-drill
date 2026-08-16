const CREDENTIAL_PREFIX = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = 120_000;
const KEY_LENGTH_BITS = 256;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function derivePasswordBytes(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前浏览器不支持安全密码存储，请升级浏览器后重试');
  }
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    KEY_LENGTH_BITS
  );
  return new Uint8Array(bits);
}

export async function createPasswordCredential(password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePasswordBytes(password, salt, PBKDF2_ITERATIONS);
  return [
    CREDENTIAL_PREFIX,
    String(PBKDF2_ITERATIONS),
    bytesToBase64(salt),
    bytesToBase64(derived)
  ].join('$');
}

export async function verifyPasswordCredential(
  password: string,
  credential: string
): Promise<boolean> {
  const [prefix, rawIterations, rawSalt, rawExpected, ...extra] = credential.split('$');
  const iterations = Number(rawIterations);
  if (
    prefix !== CREDENTIAL_PREFIX
    || extra.length > 0
    || !Number.isInteger(iterations)
    || iterations < 10_000
    || iterations > 1_000_000
    || !rawSalt
    || !rawExpected
  ) return false;

  try {
    const salt = base64ToBytes(rawSalt);
    const expected = base64ToBytes(rawExpected);
    const actual = await derivePasswordBytes(password, salt, iterations);
    if (actual.length !== expected.length) return false;

    let difference = 0;
    for (let index = 0; index < actual.length; index += 1) {
      difference |= actual[index] ^ expected[index];
    }
    return difference === 0;
  } catch {
    return false;
  }
}
