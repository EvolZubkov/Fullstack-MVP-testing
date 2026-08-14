/**
 * @module server/services/test-transfer/package
 *
 * The on-disk contract of a `.tbtest` package — what one installation writes and another
 * reads back.
 *
 * The package exists because the Excel workbook is a format for CONTENT: it carries
 * questions, structure, scales, measurements and the FORMULAS of result variables, and
 * none of the jsonb that decides how the results screen reads. Carrying a test between
 * installations with it loses the outcome dictionaries, the intro block, the appearance
 * and the pass rule — silently, with no import error. See
 * `docs/plans/2026-08-11-test-transfer-without-losses.md`.
 *
 * The governing decision: **completeness by construction**. `content` is the snapshot
 * deliverable ({@link TestSnapshotContent}) serialized WHOLE — rows, not hand-picked
 * fields. A column added to `tests` travels because it is part of the row; forgetting it
 * would require deleting it from the row first. No list here needs maintaining, which is
 * exactly what failed in the workbook.
 *
 * Types live on the server, not in `shared/`: the package is assembled and consumed by the
 * server alone (the client only presses a button), and `TestSnapshotContent` is a server
 * type. This departs from the plan, which named `shared/transfer/package.ts` — moving the
 * snapshot type into `shared/` to satisfy that placement would be a refactor of an
 * unrelated module for no gain.
 */
import type { TestSnapshotContent } from "../test-snapshot";

/**
 * Version of the package format.
 *
 * Bumped when a reader written for an older version could MISREAD a newer package. A purely
 * additive field does not need a bump: an old reader ignores what it does not know, and a
 * new reader tolerates an absent key.
 */
export const TRANSFER_FORMAT_VERSION = 1;

/** Name of the manifest inside the ZIP. */
export const TRANSFER_MANIFEST_NAME = "test.json";

/** Directory holding the packed files inside the ZIP. */
export const TRANSFER_MEDIA_DIR = "media";

/**
 * One packed file, tying the address the CONTENT holds to the bytes in the package.
 *
 * The address is kept verbatim rather than rewritten to a package path (which is what the
 * SCORM packer does): on import the file is re-registered in the target's media library and
 * every occurrence of `address` is rewritten to the NEW id. Rewriting twice would lose the
 * original spelling and with it the ability to match occurrences.
 */
export interface TransferMediaEntry {
  /** Address as content spells it: `/api/media/<id>` or `/uploads/media/<file>`. */
  address: string;
  /** Path inside the ZIP, e.g. `media/<checksum>.png`. */
  path: string;
  /** SHA-256 of the bytes — the target reuses an asset it already has. */
  checksum: string;
  mimeType: string | null;
  originalName: string | null;
}

/** The manifest: everything except the bytes, which travel beside it in the ZIP. */
export interface TestTransferPackage {
  formatVersion: number;
  /** ISO timestamp of the export; informational, never used for merging. */
  exportedAt: string;
  /** Application version that wrote the package, for diagnosing a bad import. */
  appVersion: string;
  /** The test, serialized whole. */
  content: TestSnapshotContent;
  media: TransferMediaEntry[];
  /**
   * Addresses found in content that could not be resolved to bytes.
   *
   * Reported, never hidden: a package that quietly drops a picture is how the workbook's
   * losses stayed invisible. The import surfaces these to the author.
   */
  missingMedia: string[];
}
