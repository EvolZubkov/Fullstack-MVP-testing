/**
 * @module features/tests/editor/test-editor
 * @description Wide Drawer container for the test editor. Holds the tabs
 * "Состав", "Настройки", "Оформление", "Структура", the global save footer
 * and the unsaved-changes confirmation dialog. Implementation is added in
 * phase 4A.
 */

export type TestEditorProps = {
  testId?: string;
  open: boolean;
  onClose: () => void;
};

/**
 * Wide Drawer hosting all editor sections. In phase 0 the component renders
 * nothing; the actual layout, tabs and footer arrive in phase 4A.
 */
export function TestEditor(_props: TestEditorProps): JSX.Element | null {
  return null;
}
