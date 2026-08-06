/**
 * @module server/services/home/my-topics
 *
 * PRD-25: the authoring home section «Мои темы и вопросы» (FR-10). Visibility
 * comes from the EXISTING scope service (`visibleTopicScope`) — the home page
 * owns no visibility logic of its own (FR-16).
 */
import { storage } from "../../storage";
import { visibleTopicScope } from "../topic-access";
import type { Role } from "@shared/access";
import type { MyTopicItem } from "@shared/home/contract";

/** How many topics the section shows before «показать все» (FR-10). */
const MY_TOPICS_LIMIT = 6;

/**
 * Newest first by `topics.updated_at` (FR-20): the column moves both when the
 * topic itself is edited and when any of its questions is created, changed or
 * removed, so the order reflects real content work.
 */
function byUpdatedDesc(a: { updatedAt: Date }, b: { updatedAt: Date }): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

/**
 * The topics the user may see or use, newest first, capped at
 * {@link MY_TOPICS_LIMIT}. `total` reports the true number of visible topics so
 * the UI can label the «показать все» link.
 *
 * @param userId - the current user.
 * @param roles - the user's effective role set.
 */
export async function buildMyTopics(
  userId: string,
  roles: readonly Role[],
): Promise<{ items: MyTopicItem[]; total: number }> {
  const scope = await visibleTopicScope(roles, userId);
  const all = await storage.getTopics();
  const visible = all.filter((topic) => scope.all || scope.ids.has(topic.id));

  // The question count costs a query per topic, so the window is cut first.
  const window = [...visible].sort(byUpdatedDesc).slice(0, MY_TOPICS_LIMIT);

  const items = await Promise.all(
    window.map(async (topic) => {
      const questions = await storage.getQuestionsByTopic(topic.id);
      const item: MyTopicItem = {
        topicId: topic.id,
        name: topic.name,
        code: topic.code ?? null,
        questionCount: questions.length,
        updatedAt: new Date(topic.updatedAt).toISOString(),
        owned: topic.ownerId === userId,
      };
      return item;
    }),
  );

  return { items, total: visible.length };
}
