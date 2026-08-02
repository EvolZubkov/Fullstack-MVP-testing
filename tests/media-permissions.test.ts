/**
 * @module tests/media-permissions
 * @description `media.manage` gates registry management (reindex, delete). Authoring
 * roles hold it because they own the files; a learner never does.
 */
import { describe, it, expect } from "vitest";
import { ROLES, hasPermission } from "../shared/access";

describe("media.manage", () => {
  it("is held by author, developer and administrator", () => {
    expect(hasPermission([ROLES.AUTHOR], "media.manage")).toBe(true);
    expect(hasPermission([ROLES.DEVELOPER], "media.manage")).toBe(true);
    expect(hasPermission([ROLES.ADMINISTRATOR], "media.manage")).toBe(true);
  });

  it("is not held by learner or manager", () => {
    expect(hasPermission([ROLES.LEARNER], "media.manage")).toBe(false);
    expect(hasPermission([ROLES.MANAGER], "media.manage")).toBe(false);
  });
});
