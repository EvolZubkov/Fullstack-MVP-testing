/**
 * @module features/tests/editor/image-upload-limit
 * @description The ONE size limit of an image the author uploads in the test editor: a page
 * image, a card picture of the router hub and a design image without a limit of its own.
 *
 * 1000 KB is the ceiling the test stand lets through today: its nginx keeps the default
 * `client_max_body_size 1m` for the WHOLE request, and the multipart envelope takes part of it
 * (a 1000 KB body passes, 1100 KB is refused with 413 before the application sees it). The server
 * itself accepts far more (`server/middleware/upload.ts`). Raise this number together with the
 * proxy's limit, not before it — otherwise the author gets a 413 page instead of a clear message.
 *
 * Before this module every control carried its own `512`, chosen once without a recorded reason
 * and copied from one control to the next.
 */

/** Largest image the editor accepts, in kilobytes. */
export const IMAGE_UPLOAD_MAX_KB = 1000;

/** Image formats the editor accepts, as the file picker's `accept`. */
export const IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/svg+xml,image/webp";

/** A size limit as the author reads it: «1000 КБ», «5 МБ». */
export function formatUploadLimit(kb: number): string {
  return kb < 1024 ? `${kb} КБ` : `${Math.round(kb / 1024)} МБ`;
}

/** The hint under an image field: formats and the limit. */
export function imageUploadHint(kb: number = IMAGE_UPLOAD_MAX_KB): string {
  return `PNG, JPEG, SVG или WebP; до ${formatUploadLimit(kb)}.`;
}
