/**
 * @module server/services/media/asset-access
 *
 * The delivery rule of the media library (spec §6.1). A file goes out when at least one
 * ground holds:
 *
 *  1. the requester owns the asset, or is an administrator/superadmin;
 *  2. the asset is `shared` and the requester holds an authoring role — access "to the
 *     library", for reuse;
 *  3. the asset is used in content the requester may reach. This is the ONLY ground that
 *     lets a learner receive a picture: they hold neither ownership nor an authoring role.
 *
 * Ground 3 costs a query per picture, so the decision is cached in process memory keyed by
 * (asset, user). {@link clearAssetAccessCache} is called whenever the usage index is
 * rewritten — a stale positive would outlive the content that justified it.
 */
import { hasAuthoringRole, type Role } from "@shared/access";
import type { MediaAsset } from "@shared/schema";
import { storage } from "../../storage";
import { isAdminOrSuper } from "../test-access";

/**
 * How long a resolved decision may be trusted.
 *
 * Both directions of staleness matter, and they are not symmetric in cost. A stale
 * refusal hides a learner's own picture; a stale grant keeps serving a file to someone
 * whose access was just revoked. Index writes clear the cache, but granting or revoking
 * a test assignment does not touch `media_usages` at all — so nothing but time bounds
 * those two cases. A minute keeps the hot path cheap while making both windows short.
 */
const DECISION_TTL_MS = 60_000;

/**
 * Upper bound on remembered decisions. The cache is cleared on index writes, but a
 * service that serves many learners and edits no content would otherwise grow without
 * limit until restart. On overflow the whole map is dropped rather than evicted one by
 * one: the entries are cheap to recompute and an exact LRU is not worth the code here.
 */
const DECISION_CACHE_LIMIT = 5000;

/** Resolved decisions, keyed `<assetId>:<userId>`. */
const cache = new Map<string, { allowed: boolean; expiresAt: number }>();

/** Drops every cached decision. Call after any write to `media_usages`. */
export function clearAssetAccessCache(): void {
  cache.clear();
}

/**
 * Test ids the asset's usages belong to.
 *
 * Every kind resolves its own test from the entity itself. An earlier draft let the
 * caller pass the test id as a hint, which could not work: the delivery route knows the
 * asset and the user, and nothing else — the hint would always be absent and a learner
 * would never receive a content page's picture.
 *
 * A `question` reaches tests through its topic's sections, because the same question can
 * live in several tests.
 */
async function testIdsForUsages(assetId: string): Promise<string[]> {
  const usages = await storage.getMediaUsagesByAsset(assetId);
  const ids = new Set<string>();
  for (const usage of usages) {
    switch (usage.entityType) {
      case "question": {
        const question = await storage.getQuestion(usage.entityId);
        if (!question) break;
        for (const section of await storage.getTestSectionsByTopic(question.topicId)) {
          ids.add(section.testId);
        }
        break;
      }
      case "content_page": {
        const page = await storage.getContentPage(usage.entityId);
        if (page) ids.add(page.testId);
        break;
      }
      case "snapshot": {
        const snapshot = await storage.getSnapshot(usage.entityId);
        if (snapshot) ids.add(snapshot.testId);
        break;
      }
      case "test_design":
      case "test_feedback":
        // Keyed by the test itself: the entity id IS the test id.
        ids.add(usage.entityId);
        break;
      default:
        // `topic_feedback` and `scale_feedback` are declared in the enum for the
        // feedback-attachment work (PRD-32) but nothing writes them yet. Resolving
        // them now would be dead code guessing at a shape that work has not chosen.
        break;
    }
  }
  return [...ids];
}

/** Decides whether `userId` may receive `asset`. */
export async function canDeliverAsset(
  asset: MediaAsset,
  userId: string,
  roles: readonly Role[],
): Promise<boolean> {
  if (asset.ownerId && asset.ownerId === userId) return true;
  if (isAdminOrSuper(roles)) return true;
  if (asset.visibility === "shared" && hasAuthoringRole(roles)) return true;

  const key = `${asset.id}:${userId}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  let allowed = false;
  for (const testId of await testIdsForUsages(asset.id)) {
    if (await storage.isTestAssignedToUser(testId, userId)) {
      allowed = true;
      break;
    }
  }
  if (cache.size >= DECISION_CACHE_LIMIT) cache.clear();
  cache.set(key, { allowed, expiresAt: Date.now() + DECISION_TTL_MS });
  return allowed;
}
