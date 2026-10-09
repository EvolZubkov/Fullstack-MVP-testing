/**
 * @module components/__tests__/drawer-stack.test
 *
 * Стек ящиков: Escape закрывает ТОЛЬКО верхний.
 *
 * Обработчик клавиши висит на документе, поэтому два открытых ящика слышали его
 * оба и закрывались вместе. Для вложенного сценария (PRD-52: редактор вопроса
 * поверх ящика теста) это означало потерю сразу двух вещей — правки и места в
 * списке, куда человек собирался вернуться.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Drawer } from '@skillum/ui-kit';

afterEach(cleanup);

describe('Drawer · стек', () => {
  it('Escape закрывает только верхний ящик', () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    render(
      <>
        <Drawer open onClose={onCloseOuter} title="Тест">внешний</Drawer>
        <Drawer open onClose={onCloseInner} title="Вопрос">внутренний</Drawer>
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it('после закрытия верхнего Escape достаётся нижнему', () => {
    const onCloseOuter = vi.fn();
    const { rerender } = render(
      <>
        <Drawer open onClose={onCloseOuter} title="Тест">внешний</Drawer>
        <Drawer open onClose={vi.fn()} title="Вопрос">внутренний</Drawer>
      </>,
    );

    rerender(
      <>
        <Drawer open onClose={onCloseOuter} title="Тест">внешний</Drawer>
        <Drawer open={false} onClose={vi.fn()} title="Вопрос">внутренний</Drawer>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCloseOuter).toHaveBeenCalledTimes(1);
  });

  it('одиночный ящик закрывается как прежде', () => {
    const onClose = vi.fn();
    render(<Drawer open onClose={onClose} title="Тест">один</Drawer>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ящик с выключенным закрытием по Escape не перехватывает клавишу у нижнего', () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    render(
      <>
        <Drawer open onClose={onCloseOuter} title="Тест">внешний</Drawer>
        <Drawer open onClose={onCloseInner} closeOnEsc={false} title="Вопрос">внутренний</Drawer>
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCloseInner).not.toHaveBeenCalled();
    expect(onCloseOuter).toHaveBeenCalledTimes(1);
  });
});
