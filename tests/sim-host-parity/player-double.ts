/**
 * @module tests/sim-host-parity/player-double
 * @description «Сценарий в ИС», техдолг №4: двойник плеера сценария — ОДИН для веба и пакета
 * (записка `docs/handoff/HANDOFF-2026-10-08-sim-host-parity.md`, 9.5).
 *
 * Плеер у хостов общий (`shared/sim/player`), его поведение — не предмет паритета. Предмет — что
 * хост делает с результатом прогона. Поэтому двойник:
 *
 * - записывает, С ЧЕМ хост его смонтировал (уровень L5: ограничение времени сценария, подпись
 *   кнопки, показ подробностей, подпись над заданием);
 * - по команде теста отдаёт результат так же, как настоящий плеер: `onFinish` при конце прогона,
 *   `onClose` — когда участник закрыл окно результата.
 *
 * Результат команды строит настоящий движок (`tests/helpers/sim-runs.ts`): `/finish` веба
 * переигрывает протокол, и самодельный объект оценился бы иначе, чем передан.
 */
import type { SimResult } from "@shared/sim/contract";

/** How a host mounted the player — level L5 of the snapshot. */
export interface PlayerMount {
  limitSeconds: number | null;
  closeLabel: string | null;
  showDetails: boolean | null;
  caption: string | null;
}

interface Mounted {
  options: {
    scenario?: { settings?: { limitSeconds?: number } };
    onFinish?: (r: SimResult) => void;
    onClose?: (r: SimResult) => void;
    showDetails?: boolean;
    closeLabel?: string;
    caption?: string;
  };
  destroyed: boolean;
}

export class PlayerDouble {
  /** Every mount, in order — a host that mounts twice for one run is itself a finding. */
  readonly mounts: PlayerMount[] = [];
  private current: Mounted | null = null;

  /** Stands in for `mountPlayer(host, options)`; bound, so it can be handed out as a function. */
  readonly mount = (_host: unknown, options: Mounted["options"]) => {
    const m: Mounted = { options, destroyed: false };
    this.current = m;
    this.mounts.push({
      limitSeconds: options.scenario?.settings?.limitSeconds ?? null,
      closeLabel: options.closeLabel ?? null,
      showDetails: typeof options.showDetails === "boolean" ? options.showDetails : null,
      caption: options.caption ?? null,
    });
    return {
      run: null as never,
      destroy: () => {
        m.destroyed = true;
        if (this.current === m) this.current = null;
      },
    };
  };

  /** The host's window is gone (a reload): whatever was mounted in it is gone too. */
  reset(): void {
    this.current = null;
  }

  /** Whether a run is mounted and waiting for the test's command. */
  get active(): boolean {
    return this.current !== null && !this.current.destroyed;
  }

  /** The run ends with `result` (the player's `onFinish`); the result dialog stays open. */
  finish(result: SimResult): void {
    if (!this.current) throw new Error("player double: nothing mounted");
    this.current.options.onFinish?.(result);
  }

  /** The participant closes the result dialog (the player's `onClose`). */
  close(result: SimResult): void {
    if (!this.current) throw new Error("player double: nothing mounted");
    this.current.options.onClose?.(result);
  }
}
