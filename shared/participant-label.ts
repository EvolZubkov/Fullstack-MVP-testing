/**
 * @module shared/participant-label
 * @description PRD-54 BR-54-40: how an anonymised LMS export participant is named.
 *
 * The participant's identity is the full key (an HMAC-SHA256, 256 bits), whose collision between
 * two people is out of the question. The label shows only its beginning, and a short label
 * collides early: six characters (24 bits) give 2.9 % on a thousand participants and 52 % on five
 * thousand. Eight characters (32 bits) give 0.01 % and 1.2 % on ten thousand; the account creation
 * additionally lengthens a label that another external account already carries. The analytics
 * names an unlinked passage by the same rule, so a person reads the same in both places.
 */

/** How many leading characters of the key the label shows by default. */
export const PARTICIPANT_LABEL_KEY_CHARS = 8;

/**
 * The label of an anonymised participant: «Участник» and the first `chars` characters of the key.
 *
 * @param key the participant key (`external_id`)
 * @param chars how many characters of it to show
 * @returns the label
 */
export function participantLabel(key: string, chars = PARTICIPANT_LABEL_KEY_CHARS): string {
  return `Участник ${key.slice(0, chars)}`;
}
