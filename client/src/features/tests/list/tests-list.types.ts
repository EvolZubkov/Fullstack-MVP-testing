/**
 * @module features/tests/list/tests-list.types
 * @description Shared types for the explorer-tree tests list page (PRD-7 §5.5,
 * wireframe `docs/wireframes/approved/prd7-tests-list.html`).
 *
 * The page renders tests grouped into folders with a flat row stream produced
 * by {@link buildTreeRows}. Search mode collapses the tree into a plain list
 * with breadcrumb per row (state `s-search`).
 */

export type TestListStatus = "draft" | "published" | "archived";

export type TestListMode = "standard" | "adaptive";

export type TestListFlowMode =
  | "linear_flat"
  | "linear_by_topics"
  | "router_by_topics";

/**
 * Flat record describing one row of the test list. Derived from
 * `GET /api/tests` (which itself returns `TestWithSections[]`) — we keep this
 * type independent so the list page does not depend on the heavy
 * `TestWithSections` shape.
 */
export type TestListEntry = {
  id: string;
  title: string;
  status: TestListStatus;
  mode: TestListMode;
  flowMode: TestListFlowMode;
  folderId: string | null;
  /** Test owner (PRD-13). `ownerName` is resolved server-side for display. */
  ownerId: string | null;
  ownerName: string | null;
  topicCount: number;
  questionCount: number;
  assignmentCount: number;
  /** Used for the `updated_desc` / `created_desc` sort options. */
  updatedAt?: string | Date | null;
  createdAt?: string | Date | null;
};

export type FolderEntry = {
  id: string;
  name: string;
  parentId: string | null;
};

/** Row produced by the tree builder. The page renders these in order. */
export type TreeRow =
  | { kind: "root"; testsCount: number }
  | {
      kind: "folder";
      id: string;
      name: string;
      depth: number;
      parentId: string | null;
      testsCount: number;
      expanded: boolean;
    }
  | {
      kind: "test";
      id: string;
      entry: TestListEntry;
      depth: number;
      parentId: string | null;
    };

/** Row produced by {@link buildSearchRows}. */
export type SearchRow = {
  kind: "search-result";
  id: string;
  entry: TestListEntry;
  /** Breadcrumb shown under the test name; `null` for root-level tests. */
  folderName: string | null;
};

export type SortKey = "created_desc" | "updated_desc" | "title_asc";
