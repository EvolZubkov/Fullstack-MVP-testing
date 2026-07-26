/**
 * @module features/templates/__tests__/details-modal.test
 * @description The completeness findings of a template must be readable AFTER
 * upload: the card carries a permanent «Комплектность: Предупреждения» badge, and
 * until now the only place that ever listed the findings was the upload dialog —
 * gone the moment it closed.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailsModal } from "../details-modal";
import type { AdminTemplate } from "../use-admin-templates";

vi.mock("../use-admin-templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-admin-templates")>()),
  useTemplateDetails: () => ({ data: { usageCount: 0 } }),
}));

const template = (over: Partial<AdminTemplate> = {}): AdminTemplate =>
  ({
    id: "certification",
    name: "Сертификация (РТК)",
    description: null,
    version: "1.2.1",
    templateApiVersion: "1.0",
    status: "active",
    isBuiltin: false,
    manifest: { layouts: { content: "layouts/content.html" }, params: [] },
    validationJson: null,
    smokeTestJson: null,
    ...over,
  }) as unknown as AdminTemplate;

const renderModal = (t: AdminTemplate) =>
  render(<DetailsModal open onClose={() => {}} template={t} onOpenPreview={() => {}} />);

describe("DetailsModal — completeness findings", () => {
  it("lists the warnings behind the «Предупреждения» badge", () => {
    renderModal(
      template({
        validationJson: {
          ok: true,
          blocking: [],
          warnings: [
            { code: "THEME_ADVISORY", message: 'Тема "dark": шаблон не объявляет themes[]' },
            { code: "UNUSED_FILE", message: "Файл не используется манифестом: certification-5.zip" },
          ],
        },
      }),
    );
    expect(screen.getByText(/Замечания комплектности \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/шаблон не объявляет themes\[\]/)).toBeInTheDocument();
    expect(screen.getByText(/certification-5\.zip/)).toBeInTheDocument();
  });

  it("lists blocking issues when validation did not pass", () => {
    renderModal(
      template({
        validationJson: {
          ok: false,
          blocking: [{ code: "MANIFEST_INVALID", message: "manifest.json не разобран" }],
          warnings: [],
        },
      }),
    );
    expect(screen.getByText(/Блокирующие ошибки \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/manifest\.json не разобран/)).toBeInTheDocument();
  });

  it("says nothing when the package is clean", () => {
    renderModal(template({ validationJson: { ok: true, blocking: [], warnings: [] } }));
    expect(screen.queryByText(/Замечания комплектности/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Блокирующие ошибки/)).not.toBeInTheDocument();
  });

  it("says nothing for a template that was never validated (built-in)", () => {
    renderModal(template({ isBuiltin: true, validationJson: null }));
    expect(screen.queryByText(/Замечания комплектности/)).not.toBeInTheDocument();
  });
});
