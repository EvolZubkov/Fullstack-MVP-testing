/**
 * @module shared/topics/recommendations
 *
 * TD-02 r.3: recommended courses/events are a projection of a topic's rich
 * feedback (`topics.feedback_json`), NOT the legacy topic_courses/topic_events
 * tables. These pure mappers are the single derivation point shared by delivery
 * (attempts grading, SCORM export, snapshot capture) and the topics API, so the
 * mapping cannot drift. Kept out of `server/storage` so storage-module mocks in
 * tests do not stub them out.
 */

import type { FeedbackContent, Topic, TopicCourse, TopicEvent } from "../schema";

/**
 * Recommended courses for a topic = its feedback `links` (title + url). Ids are
 * synthetic (index-based); consumers use only title/url.
 */
export function topicCoursesFromFeedback(topic: Topic | undefined | null): TopicCourse[] {
  if (!topic) return [];
  const fb = (topic.feedbackJson ?? null) as FeedbackContent | null;
  return (fb?.links ?? []).map((l, i) => ({
    id: `${topic.id}:link:${i}`,
    topicId: topic.id,
    title: l.title,
    url: l.url,
  }));
}

/**
 * Recommended events for a topic = its feedback `events` (title; the event URL,
 * when present, is not part of the legacy TopicEvent shape).
 */
export function topicEventsFromFeedback(topic: Topic | undefined | null): TopicEvent[] {
  if (!topic) return [];
  const fb = (topic.feedbackJson ?? null) as FeedbackContent | null;
  return (fb?.events ?? []).map((e, i) => ({
    id: `${topic.id}:event:${i}`,
    topicId: topic.id,
    title: e.title,
  }));
}
