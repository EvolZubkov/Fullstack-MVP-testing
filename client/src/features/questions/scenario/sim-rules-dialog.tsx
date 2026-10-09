/**
 * @module features/questions/scenario/sim-rules-dialog
 * @description «Сценарий в ИС» в обычном разделе (техдолг №5): окно правил, которое открывает
 * «Пройти» на обложке вопроса-сценария (эскиз sim-scenario-learner.html, состояние section-rules).
 *
 * Текст правил собирает общий `simRules` — тот же, что печатает окно в пакете: лимит времени,
 * ненулевые штрафы, подсказки и досрочный выход, и ничего сверх того, что правда для этого
 * сценария в этом тесте. «Старт» сам просит полный экран: браузер даёт его только из щелчка.
 */
import { Maximize2 } from "lucide-react";
import { Button, ModalDialog } from "@skillum/ui-kit";
import type { Scenario } from "@shared/sim/contract";
import type { SimPenalties } from "@shared/sim/scoring";
import { simRules } from "@shared/sim/cover";
import { requestScenarioFullscreen } from "./scenario-run";

export interface SimRulesDialogProps {
  open: boolean;
  scenario: Scenario;
  /** Действующие штрафы вопроса в этом тесте; `null` — неизвестны, строки о балле не будет. */
  penalties: SimPenalties | null;
  onCancel: () => void;
  /** «Старт»: полный экран уже запрошен, хосту остаётся смонтировать плеер. */
  onStart: () => void;
}

/**
 * Окно правил сценария.
 *
 * @param props сценарий, штрафы и обработчики «Отмена» / «Старт»
 * @returns модальное окно ДС
 */
export function SimRulesDialog({ open, scenario, penalties, onCancel, onStart }: SimRulesDialogProps) {
  const rules = simRules(scenario, penalties);
  return (
    <ModalDialog
      open={open}
      onClose={onCancel}
      size="m"
      title={rules.title}
      description={rules.description || undefined}
      hideCloseButton
      footer={(
        <>
          <Button variant="secondary" size="m" onClick={onCancel} data-testid="sim-rules-cancel">Отмена</Button>
          <Button
            variant="primary"
            size="m"
            leadingIcon={<Maximize2 size={16} />}
            onClick={() => {
              requestScenarioFullscreen();
              onStart();
            }}
            data-testid="sim-rules-start"
          >
            Старт
          </Button>
        </>
      )}
    >
      <ul className="ou-list--bulleted tb-sim-rules" data-testid="sim-rules">
        {rules.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </ModalDialog>
  );
}
