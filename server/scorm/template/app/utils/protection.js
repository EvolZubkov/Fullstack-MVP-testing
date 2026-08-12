/**
 * PRD-34 (FR-30): решение о защите экрана для рантайма ПАКЕТА.
 *
 * Периметр здесь не перечисляется: его считает ОДИН общий построитель
 * (`shared/template/protection/spec`), доступный пакету как `TBTemplate.buildProtectionSpec`.
 * Этот файл лишь собирает вход — запечённые настройки теста и обезличенную отметку —
 * и потому не может разойтись с веб-хостом.
 *
 * Имя объявляется ОДИН раз: части рантайма склеиваются плоско, и дубль имени в файле,
 * идущем позже, молча перекрыл бы эту реализацию.
 */

/**
 * Build the protection decision for one screen.
 *
 * @param {string} screen Screen key: `question` | `review` | `section-results` | `results`.
 * @returns {object|undefined} The spec, or `undefined` when the shared bundle is absent
 *   (an old template bundle) — the renderer then simply protects nothing.
 */
function buildScormProtection(screen) {
  var TB = window.TBTemplate;
  if (!TB || !TB.buildProtectionSpec) return undefined;
  // Обезличенный идентификатор (FR-17): учётка, которую отдала LMS. Пусто — знак
  // напечатает только дату и время, это решает общий форматтер (FR-18).
  var id = '';
  try {
    id = (typeof SCORM !== 'undefined' && SCORM && SCORM.getValue)
      ? (SCORM.getValue('cmi.learner_id') || '')
      : '';
  } catch (e) {
    id = '';
  }
  return TB.buildProtectionSpec({
    screen: screen,
    settings: {
      copyProtection: TEST_DATA.copyProtection !== false,
      watermark: TEST_DATA.protectionWatermark === true,
      hideOnBlur: TEST_DATA.protectionHideOnBlur === true
    },
    stamp: { id: String(id), at: new Date() },
    // FR-25: отладочный прогон запекается с protectionActive=false — автор обязан
    // сохранить возможность выделить и скопировать текст своего же вопроса.
    active: TEST_DATA.protectionActive !== false
  });
}

window.buildScormProtection = buildScormProtection;
