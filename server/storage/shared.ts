/**
 * @module server/storage/shared
 * @description Cross-cutting helpers shared by the domain repositories and the
 * `DatabaseStorage` facade (`server/storage.ts`). Kept free of table/domain
 * specifics so any repository can depend on it without introducing cross-domain
 * coupling.
 */

/**
 * Copy ONLY the whitelisted keys that are actually present (`null` is a valid
 * value, `undefined` is skipped). Used by the `update*` methods so a broad
 * `Partial<Row>` cannot mass-assign columns the caller must not touch
 * (passwordHash, emailHash, ownership/audit fields, foreign keys, …).
 */
export function pickDefined<T, K extends keyof T>(src: Partial<T>, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) {
    const v = src[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
