/**
 * @module server/storage/analytics-repository
 * @description PRD-56 FR-33: чтение прохождений ОБОИХ источников одной выборкой.
 *
 * Веб-попытки (`attempts`) и строки LMS (`scorm_attempts`) живут в разных таблицах, но экран
 * показывает их одним списком, сортирует по одной оси и догружает порциями при прокрутке
 * (FR-01c). Значит отбор, порядок и порция обязаны считаться ЗАПРОСОМ: слияние двух прочитанных
 * целиком таблиц в памяти даёт неверные порции, как только источников становится два.
 *
 * Репозиторий отдаёт сырые строки — приведение к наблюдению живёт в сервисе, потому что зависит
 * от правил оценивания, а не от хранения.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";

import { db } from "../db";
import {
  attempts, groups, scormAnswers, scormAttempts, scormPackages, tests, userGroups, users,
  type Attempt, type ScormAttempt,
} from "@shared/schema";
import { ORG_FIELDS, type OrgField } from "@shared/org-fields";
import { splitGroupFilter } from "@shared/analytics/no-group";

/** Колонка профиля и колонка прохождения для каждого оргполя. */
const ORG_COLUMNS = {
  organization: { profile: users.organization, passage: scormAttempts.lmsUserOrg },
  unit: { profile: users.unit, passage: scormAttempts.lmsUserUnit },
  position: { profile: users.position, passage: scormAttempts.lmsUserPosition },
} as const;

/**
 * Значение оргполя прохождения из LMS: своё, иначе профиль связанного пользователя (PRD-56
 * OQ-04). Пустая строка у прохождения — не значение: выгрузка пишет пустую клетку, и она не
 * должна заслонять профиль. То же правило, что в нормализации сервиса.
 */
function lmsOrgValue(field: OrgField) {
  const { profile, passage } = ORG_COLUMNS[field];
  return sql`coalesce(
    nullif(btrim(${passage}), ''),
    (select ${profile} from ${users} where ${users.id} = ${scormAttempts.userId})
  )`;
}

/** Значение оргполя веб-попытки: только профиль — веб своих оргполей не пишет. */
function webOrgValue(field: OrgField) {
  const { profile } = ORG_COLUMNS[field];
  return sql`(select ${profile} from ${users} where ${users.id} = ${attempts.userId})`;
}

/** Откуда приехало прохождение. Совпадает с `ObservationSource` сервиса. */
export type ObservationSourceName = "web" | "telemetry" | "import";

/** Исход прохождения. Совпадает с `ObservationOutcome` сервиса. */
export type ObservationOutcomeName = "passed" | "failed" | "completed" | "incomplete";

/** Условия отбора. Пустой объект — всё, что есть. */
export interface ObservationQuery {
  /** Тесты выборки. `undefined` — без ограничения по тесту. */
  testIds?: string[];
  groupIds?: string[];
  sources?: ObservationSourceName[];
  outcomes?: ObservationOutcomeName[];
  /**
   * Варианты выдачи (PRD-17 `formId`) и версии публикации (`snapshot_id`).
   *
   * Условия осмысленны внутри ОДНОГО теста: у разных тестов и варианты, и версии свои, и
   * отбор по ним поверх нескольких тестов ничего не значит. Ограничение стережёт экран, а
   * не запрос: сюда уже приходят выбранные идентификаторы.
   */
  formIds?: string[];
  snapshotIds?: string[];
  /**
   * План оргструктуры: значения организации, подразделения, должности — ТОЧНЫЕ написания, как
   * они лежат в базе. Сервис заранее переводит выбранное в все его написания
   * (`shared/org-fields`), поэтому запрос сравнивает строки как есть и не зависит от локали
   * базы: `lower()` кириллицы при `LC_CTYPE=C` не понижает, и отбор разошёлся бы с фильтром.
   *
   * Присутствие поля — уже условие: пустой список значит «таких значений нет ни у кого», и
   * выборка обязана вернуть ноль строк, а не снять условие.
   */
  orgValues?: Partial<Record<OrgField, string[]>>;
  /**
   * Прохождения, отобранные поимённо, — обоих источников вперемешку: идентификаторы веб-попыток
   * и строк LMS не пересекаются.
   *
   * Так приходят условия, которые запросом не выразить: «ошиблись на вопросе» требует правил
   * оценивания (`test-answer-facts`), и сервис заранее переводит его в список прохождений.
   * Присутствие поля — уже условие: пустой список значит «ни одно не подошло».
   */
  attemptIds?: string[];
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  /** Ни одна строка подойти не может: доступных тестов нет вовсе. */
  impossible?: boolean;
  /**
   * Чем упорядочить выборку. Умолчание — дата начала по убыванию.
   *
   * Сортировка обязана быть здесь, а не в компоненте: строки приходят порциями, и разложить
   * по столбцу можно лишь то, что уже пришло, — «худший результат» на второй странице так
   * не найти никогда.
   */
  sort?: ObservationSort;
  dir?: "asc" | "desc";
}

/** Столбцы реестра, по которым он сортируется. Совпадают с колонками экрана. */
export type ObservationSort =
  | "participant" | "test" | "date" | "attempt" | "result" | "outcome" | "source" | "group";

/**
 * PRD-56 FR-02: номер каждой попытки участника по тесту — производной таблицей.
 *
 * Номер — свойство прохождения, а не выборки: он считается по ВСЕМ прохождениям человека по
 * тесту в обоих источниках, поэтому таблица строится без условий отбора и подключается к
 * выборке по идентификатору. Правило то же, что у `selectAttemptOrder`, по которому номер
 * рисуется в колонке: участник — учётная запись, а у строки из LMS без неё — псевдоним
 * импорта; тест строки из LMS — её собственный `test_id`; прохождение без даты начала или без
 * участника номера не получает. Прохождения одной секунды упорядочивает идентификатор в
 * побайтовом сравнении — так же, как их упорядочивает маршрут реестра.
 *
 * Строится только при сортировке по попытке: окно по всем прохождениям инсталляции — цена,
 * которую незачем платить за сортировку по дате.
 */
function attemptNumbers() {
  const lmsParticipant = sql<string>`coalesce(${scormAttempts.userId}, ${scormAttempts.participantKey})`;
  const pool = unionAll(
    db.select({
      id: attempts.id,
      participant: sql<string>`${attempts.userId}`.as("participant"),
      testId: sql<string>`${attempts.testId}`.as("test_id"),
      startedAt: attempts.startedAt,
    }).from(attempts),
    db.select({
      id: scormAttempts.id,
      participant: lmsParticipant.as("participant"),
      testId: sql<string>`${scormAttempts.testId}`.as("test_id"),
      startedAt: sql<Date>`${scormAttempts.startedAt}`.as("started_at"),
    }).from(scormAttempts).where(and(
      sql`${scormAttempts.testId} is not null`,
      sql`${scormAttempts.startedAt} is not null`,
      sql`${lmsParticipant} is not null`,
    )),
  ).as("attempt_pool");
  return db.select({
    id: pool.id,
    n: sql<number>`row_number() over (
      partition by ${pool.participant}, ${pool.testId}
      order by ${pool.startedAt}, ${pool.id} collate "C"
    )`.as("attempt_n"),
  }).from(pool).as("attempt_numbers");
}

export interface ObservationRows {
  web: Attempt[];
  lms: ScormAttempt[];
  /** Порядок строк выборки: сервис раскладывает по нему нормализованные наблюдения. */
  order: Array<{ id: string; source: ObservationSourceName }>;
  /** Сколько прохождений подошло под условия — независимо от лимита. */
  total: number;
}

/**
 * Исход, вычисленный в SQL.
 *
 * Повторяет правило сервиса, и иначе нельзя: фильтр по исходу обязан работать ДО лимита, иначе
 * порция вернёт меньше строк, чем обещала, а общее число перестанет отвечать на «сколько всего».
 * Что оба выражения дают одно и то же, стережёт интеграционный тест.
 *
 * @param finished завершённость прохождения — у источников она видна по-разному
 * @param adaptive адаптивное прохождение: его судят подтверждённые уровни, а не доля баллов,
 *   поэтому вердикт у него есть и без достижимых баллов и без порога у теста
 * @param possiblePoints единицы оценивания строки
 * @param passed записанный вердикт
 */
function outcomeSql(
  finished: unknown,
  adaptive: unknown,
  possiblePoints: unknown,
  passed: unknown,
) {
  /** Вердикт как таковой: он же хвост общего правила. */
  const verdict = sql`case
    when ${passed} is null then 'completed'
    when ${passed} then 'passed'
    else 'failed'
  end`;

  return sql<string>`case
    when not ${finished} then 'incomplete'
    when ${adaptive} then ${verdict}
    when coalesce(${possiblePoints}, 0) <= 0 then 'completed'
    when coalesce(${tests.overallPassRuleJson} ->> 'type', 'none') = 'none' then 'completed'
    else ${verdict}
  end`;
}

export class AnalyticsRepository {
  /**
   * Страница прохождений обоих источников.
   *
   * Порядок устойчив: дата начала по убыванию, затем идентификатор — у прохождений одной
   * секунды иначе нет определённого места, и при догрузке строки терялись бы или двоились.
   */
  async selectObservations(query: ObservationQuery): Promise<ObservationRows> {
    /** `false`, когда ни одна строка источника подойти не может. */
    const NOTHING = sql`false`;

    /**
     * Участник состоит в одной из групп отбора.
     *
     * «Группа» в реестре значит то же, что во всём продукте, — членство человека
     * (`user_groups`). У импортированной строки к этому добавляется метка группы, которую
     * проставил импорт (PRD-54): участник там может быть не заведён вовсе.
     */
    const inGroups = (userIdColumn: unknown, ids: string[]) => sql`exists (
      select 1 from ${userGroups}
      where ${userGroups.userId} = ${userIdColumn}
        and ${userGroups.groupId} in ${ids}
    )`;
    const { testIds, groupIds, sources, outcomes, formIds, snapshotIds, attemptIds } = query;
    /**
     * «Без группы» (`NO_GROUP_ID`) — участник не состоит ни в одной группе. Выбирается вместе с
     * обычными группами, условия соединяются через «или».
     */
    const groupFilter = splitGroupFilter(groupIds);
    const inNoGroup = (userIdColumn: unknown) => sql`not exists (
      select 1 from ${userGroups} where ${userGroups.userId} = ${userIdColumn}
    )`;

    /** Поимённый отбор: пустой список — ни одной строки, а не снятое условие. */
    const inAttemptIds = (column: typeof attempts.id | typeof scormAttempts.id) =>
      (attemptIds!.length ? inArray(column, attemptIds!) : NOTHING);

    /**
     * Прохождение выдано одним из отобранных вариантов.
     *
     * У веб-попытки состав формы лежит в `variant_json.sections[].formId`, у прохождения из
     * LMS — в `forms_json` (PRD-56 FR-19a: пакет сообщает его телеметрией). Разделов с
     * наборами форм у теста бывает несколько, поэтому подходит СОВПАДЕНИЕ ХОТЬ ПО ОДНОМУ —
     * как строка среза по варианту, в которую прохождение попадает каждым своим вариантом.
     */
    const webInForms = (ids: string[]) => sql`exists (
      select 1 from jsonb_array_elements(coalesce(${attempts.variantJson} -> 'sections', '[]'::jsonb)) as section
      where section ->> 'formId' in ${ids}
    )`;
    const lmsInForms = (ids: string[]) => sql`exists (
      select 1 from jsonb_each_text(coalesce(${scormAttempts.formsJson}, '{}'::jsonb)) as form(key, value)
      where form.value in ${ids}
    )`;

    // Единицы оценивания: достижимые баллы, а где их не записали — сам факт посчитанного
    // процента. Правило повторяет `gradedUnits` сервиса; у теста без проходного балла оба
    // признака не считаются, и это делает ветка `overall_pass_rule_json` внутри `outcomeSql`.
    const webGraded = sql`coalesce(
      (${attempts.resultJson} ->> 'totalPossiblePoints')::numeric,
      case when (${attempts.resultJson} ->> 'overallPercent') is not null then 1 else 0 end)`;
    // Прохождение состоялось, если посчитан результат, даже когда отметка завершения не
    // проставлена: такие строки в базе есть, и правило сервиса их не теряет — запрос тоже
    // не должен, иначе фильтр «завершено» отбирает не то, что показывает экран.
    const webFinished = sql`(${attempts.finishedAt} is not null or ${attempts.resultJson} is not null)`;
    const webOutcome = outcomeSql(
      webFinished,
      sql`(${attempts.resultJson} ->> 'mode') = 'adaptive'`,
      webGraded,
      sql`(${attempts.resultJson} ->> 'overallPassed')::boolean`,
    );
    // Оценённость строки из LMS видна по проценту, когда баллов нет: телеметрия не всегда
    // сообщает `max_points`. То же правило, что в нормализации сервиса.
    const lmsGraded = sql`coalesce(${scormAttempts.maxPoints},
      case when ${scormAttempts.resultPercent} is not null then 1 else 0 end)`;
    // Телеметрия заводит строку при СТАРТЕ и обновляет по ходу, поэтому признак завершения у
    // неё один — отметка времени; режим прохождения она не сообщает вовсе, и адаптивных
    // разрезов у этого источника нет (то же, что в нормализации сервиса).
    const lmsOutcome = outcomeSql(
      sql`${scormAttempts.finishedAt} is not null`,
      sql`false`,
      lmsGraded,
      scormAttempts.resultPassed,
    );

    /**
     * Условия оргструктуры источника: поле за полем через И, значения одного поля через ИЛИ.
     * Пустой список — «ни у кого нет», а не «условия нет».
     */
    const orgConditions = (valueOf: (field: OrgField) => ReturnType<typeof sql>) =>
      ORG_FIELDS.flatMap(field => {
        const values = query.orgValues?.[field];
        if (!values) return [];
        return [values.length ? inArray(valueOf(field), values) : NOTHING];
      });

    const webWhere = and(
      ...orgConditions(webOrgValue),
      ...(testIds ? [inArray(attempts.testId, testIds)] : []),
      ...(query.from ? [gte(attempts.startedAt, query.from)] : []),
      ...(query.to ? [lte(attempts.startedAt, query.to)] : []),
      ...(outcomes?.length ? [inArray(webOutcome, outcomes)] : []),
      ...(groupIds?.length
        ? [or(
            ...(groupFilter.groups.length ? [inGroups(attempts.userId, groupFilter.groups)] : []),
            ...(groupFilter.none ? [inNoGroup(attempts.userId)] : []),
          )!]
        : []),
      ...(formIds?.length ? [webInForms(formIds)] : []),
      ...(snapshotIds?.length ? [inArray(attempts.snapshotId, snapshotIds)] : []),
      ...(attemptIds ? [inAttemptIds(attempts.id)] : []),
      ...(sources?.length && !sources.includes("web") ? [NOTHING] : []),
      ...(query.impossible ? [NOTHING] : []),
    );

    const lmsOrigins = (sources?.length ? sources : ["telemetry", "import"]).filter(
      (s): s is "telemetry" | "import" => s !== "web",
    );
    /**
     * Тест строки из LMS. `scorm_attempts.test_id` — источник истины, но у части старых строк
     * телеметрии его нет: их тест известен только через пакет. Тот же порядок, что в
     * `attemptTestId`, иначе выборка по тесту молча теряет такие прохождения.
     */
    const lmsTestId = sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`;

    const lmsWhere = and(
      ...orgConditions(lmsOrgValue),
      ...(testIds ? [inArray(lmsTestId, testIds)] : []),
      ...(query.from ? [gte(scormAttempts.startedAt, query.from)] : []),
      ...(query.to ? [lte(scormAttempts.startedAt, query.to)] : []),
      ...(groupIds?.length
        ? [or(
            ...(groupFilter.groups.length
              ? [inArray(scormAttempts.groupId, groupFilter.groups), inGroups(scormAttempts.userId, groupFilter.groups)]
              : []),
            // У прохождения из LMS «без группы» — нет и группы загрузки.
            ...(groupFilter.none ? [and(isNull(scormAttempts.groupId), inNoGroup(scormAttempts.userId))!] : []),
          )!]
        : []),
      ...(outcomes?.length ? [inArray(lmsOutcome, outcomes)] : []),
      ...(formIds?.length ? [lmsInForms(formIds)] : []),
      ...(snapshotIds?.length ? [inArray(scormAttempts.snapshotId, snapshotIds)] : []),
      ...(attemptIds ? [inAttemptIds(scormAttempts.id)] : []),
      ...(lmsOrigins.length ? [inArray(scormAttempts.origin, lmsOrigins)] : [NOTHING]),
      ...(query.impossible ? [NOTHING] : []),
    );

    /**
     * Подписи и величины, по которым реестр сортируется, — в обоих источниках по одному
     * правилу, иначе половина выборки встанет не туда.
     *
     * Участник: у веб-попытки это имя учётной записи, у строки из LMS — имя, пришедшее из
     * отчёта, а где и его нет — псевдоним (то же правило, что рисует подпись на экране).
     * Процент: у веба он лежит в итоге попытки, у LMS — своей колонкой.
     */
    // `nullif` не украшение: безымянная строка — это «участник неизвестен», и по алфавиту она
    // не стоит нигде. Пустая строка встала бы в начало возрастающей сортировки, заняв место
    // перед реальными людьми; NULL уходит в конец вместе с прочими «нет данных».
    const webParticipant = sql`nullif(${users.name}, '')`;
    const lmsParticipant = sql`nullif(coalesce(${scormAttempts.lmsUserName}, ${scormAttempts.participantKey}), '')`;
    const webPercent = sql`(${attempts.resultJson} ->> 'overallPercent')::numeric`;
    const lmsPercent = scormAttempts.resultPercent;

    /**
     * Ключ сортировки едет ОТДЕЛЬНОЙ колонкой объединения, а не выражением над номером.
     *
     * Сослаться на колонку union можно только её номером, но номер — это ссылка, а не
     * значение: `(3 is null)` PostgreSQL понимает как условие над числом три и запрос
     * отвергает. Поэтому выбранная величина и признак её отсутствия считаются в каждой ветке
     * заранее, и порядок задаётся уже по ним.
     */
    const sortOf = (of: Record<ObservationSort, unknown>) => of[query.sort ?? "date"];
    const numbered = query.sort === "attempt" ? attemptNumbers() : null;
    /**
     * Группа как ВЕЛИЧИНА СОРТИРОВКИ — первая по алфавиту из тех, что показывает колонка: у
     * веб-попытки это членство участника (групп бывает несколько), у строки из LMS — метка
     * группы из выгрузки, а без неё — членство. «Без группы» уходит в конец вместе с прочими
     * «нет данных». Правило то же, что у `groupsOfPage` маршрута реестра.
     */
    const firstMembership = (userIdColumn: unknown) => sql`(
      select min(${groups.name}) from ${userGroups}
      join ${groups} on ${groups.id} = ${userGroups.groupId}
      where ${userGroups.userId} = ${userIdColumn}
    )`;
    const lmsGroupName = sql`case
      when ${scormAttempts.groupId} is not null
        then (select ${groups.name} from ${groups} where ${groups.id} = ${scormAttempts.groupId})
      else ${firstMembership(scormAttempts.userId)}
    end`;
    /**
     * Процент как ВЕЛИЧИНА СОРТИРОВКИ подчиняется тому же правилу, что колонка на экране:
     * результата нет у незавершённого прохождения; у теста без проходного балла ноль процентов
     * не результат, а отсутствие оценивания (PRD-29 §6.7); и там, где оценивать было нечего,
     * его тоже нет. Все три случая уходят в конец вместе с прочими «нет данных» — те же три
     * условия, по которым процент становится прочерком в колонке «Результат».
     *
     * Без этого сортировка спорила бы с тем, что видно: наверху вставали бы строки, у которых
     * в колонке «Результат» стоит прочерк.
     */
    const gradedPercent = (percent: unknown, finished: unknown, graded: unknown) => sql`case
      when not ${finished} then null
      when coalesce(${tests.overallPassRuleJson} ->> 'type', 'none') = 'none' then null
      when coalesce(${graded}, 0) <= 0 then null
      else ${percent}
    end`;
    /**
     * Ключ сортировки считается СВОИМИ выражениями, а не теми, что стоят в выборке.
     *
     * Выражение выборки несёт псевдоним, и подстановка его же во второе место даёт ссылку на
     * псевдоним — а ссылаться на псевдоним внутри того же SELECT нельзя: запрос падает на
     * «column "participant" does not exist».
     */
    const webSortKey = sortOf({
      date: attempts.startedAt,
      attempt: numbered ? numbered.n : sql`null`,
      group: firstMembership(attempts.userId),
      participant: sql`nullif(${users.name}, '')`,
      test: sql`coalesce(${tests.title}, '')`,
      result: gradedPercent(
        sql`(${attempts.resultJson} ->> 'overallPercent')::numeric`,
        webFinished,
        webGraded,
      ),
      outcome: outcomeSql(
        webFinished,
        sql`(${attempts.resultJson} ->> 'mode') = 'adaptive'`,
        webGraded,
        sql`(${attempts.resultJson} ->> 'overallPassed')::boolean`,
      ),
      source: sql`'web'`,
    });
    const lmsSortKey = sortOf({
      date: scormAttempts.startedAt,
      attempt: numbered ? numbered.n : sql`null`,
      group: lmsGroupName,
      participant: sql`nullif(coalesce(${scormAttempts.lmsUserName}, ${scormAttempts.participantKey}), '')`,
      test: sql`coalesce(${tests.title}, '')`,
      result: gradedPercent(
        scormAttempts.resultPercent,
        sql`${scormAttempts.finishedAt} is not null`,
        lmsGraded,
      ),
      outcome: outcomeSql(
        sql`${scormAttempts.finishedAt} is not null`,
        sql`false`,
        lmsGraded,
        scormAttempts.resultPassed,
      ),
      source: scormAttempts.origin,
    });

    const webKeysBase = db
      .select({
        id: attempts.id,
        source: sql<string>`'web'`.as("source"),
        startedAt: attempts.startedAt,
        participant: webParticipant.as("participant"),
        testTitle: sql`coalesce(${tests.title}, '')`.as("test_title"),
        percent: webPercent.as("percent"),
        outcome: webOutcome.as("outcome"),
        sortEmpty: sql`(${webSortKey} is null)`.as("sort_empty"),
        sortKey: sql`${webSortKey}`.as("sort_key"),
      })
      .from(attempts)
      .leftJoin(tests, eq(tests.id, attempts.testId))
      .leftJoin(users, eq(users.id, attempts.userId))
      .$dynamic();
    const webKeys = (numbered
      ? webKeysBase.leftJoin(numbered, eq(numbered.id, attempts.id))
      : webKeysBase).where(webWhere);

    const lmsKeysBase = db
      .select({
        id: scormAttempts.id,
        source: scormAttempts.origin,
        startedAt: scormAttempts.startedAt,
        participant: lmsParticipant.as("participant"),
        testTitle: sql`coalesce(${tests.title}, '')`.as("test_title"),
        percent: lmsPercent,
        outcome: lmsOutcome.as("outcome"),
        sortEmpty: sql`(${lmsSortKey} is null)`.as("sort_empty"),
        sortKey: sql`${lmsSortKey}`.as("sort_key"),
      })
      .from(scormAttempts)
      .leftJoin(scormPackages, eq(scormPackages.id, scormAttempts.packageId))
      .leftJoin(tests, eq(tests.id, sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`))
      .$dynamic();
    const lmsKeys = (numbered
      ? lmsKeysBase.leftJoin(numbered, eq(numbered.id, scormAttempts.id))
      : lmsKeysBase).where(lmsWhere);

    /**
     * Порядок задан НОМЕРАМИ колонок: сослаться на колонку объединения иначе нельзя — своей
     * таблицы у неё нет. Восьмая колонка — признак «величины нет», девятая — сама величина.
     *
     * Первым ключом идёт признак пустоты, и всегда по возрастанию: строки без величины
     * оказываются в конце при любом направлении, иначе сортировка по результату начиналась бы
     * с прочерков. Последним — идентификатор: у прохождений одной секунды (или с одинаковым
     * результатом) иначе нет определённого места, и при догрузке порциями строки терялись бы
     * или двоились.
     */
    const direction = query.dir === "asc" ? "asc" : "desc";
    /**
     * Объединение заворачивается в подзапрос, и порядок задаётся по ИМЕНАМ его колонок.
     *
     * Ссылаться номерами тоже можно, но номер — это ссылка, а не значение: условие над ним
     * PostgreSQL отвергает, а `nulls last` при этом молча теряется. Имя колонки подзапроса
     * снимает оба ограничения разом и переживает добавление новой колонки в выборку.
     */
    const union = unionAll(webKeys, lmsKeys).as("observations");
    const ordered = db
      .select({ id: union.id, source: union.source })
      .from(union)
      .orderBy(
        // Первый ключ — «величины нет», всегда по возрастанию: такие строки уходят в конец при
        // ЛЮБОМ направлении, иначе сортировка по результату начинается с прочерков.
        asc(union.sortEmpty),
        direction === "asc" ? asc(union.sortKey) : desc(union.sortKey),
        // Последний — идентификатор: у прохождений одной секунды (или с равным результатом)
        // иначе нет определённого места, и при догрузке порциями строки терялись бы.
        desc(union.id),
      );
    const limited = query.limit === undefined ? ordered : ordered.limit(query.limit);
    const keysQuery: PromiseLike<Array<{ id: string; source: string }>> =
      query.offset ? limited.offset(query.offset) : limited;

    const [keys, webTotal, lmsTotal] = await Promise.all([
      keysQuery,
      countOf(db.select({ n: sql<number>`count(*)::int` }).from(attempts)
        .leftJoin(tests, eq(tests.id, attempts.testId)).where(webWhere)),
      countOf(db.select({ n: sql<number>`count(*)::int` }).from(scormAttempts)
        .leftJoin(scormPackages, eq(scormPackages.id, scormAttempts.packageId))
        .leftJoin(tests, eq(tests.id, sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`))
        .where(lmsWhere)),
    ]);

    const webIds = keys.filter(k => k.source === "web").map(k => k.id);
    const lmsIds = keys.filter(k => k.source !== "web").map(k => k.id);
    const [web, lms] = await Promise.all([
      webIds.length ? db.select().from(attempts).where(inArray(attempts.id, webIds)) : [],
      lmsIds.length
        ? db.select().from(scormAttempts).where(inArray(scormAttempts.id, lmsIds))
        : [],
    ]);

    return {
      web,
      lms,
      order: keys.map(k => ({ id: k.id, source: k.source as ObservationSourceName })),
      total: webTotal + lmsTotal,
    };
  }

  /**
   * Все хранящиеся написания оргполей — профили и прохождения (план оргструктуры).
   *
   * Сырые, без свёртки: сервис сам решает, какие из них относятся к выбранному значению, по
   * правилу `shared/org-fields`, и отдаёт запросу точный список. Различных значений у поля
   * единицы и десятки, а не тысячи — это цена одного запроса на поле, не таблицы целиком.
   */
  async selectOrgSpellings(): Promise<Record<OrgField, string[]>> {
    const out = {} as Record<OrgField, string[]>;
    for (const field of ORG_FIELDS) {
      const { profile, passage } = ORG_COLUMNS[field];
      const [fromProfiles, fromPassages] = await Promise.all([
        db.selectDistinct({ value: profile }).from(users).where(sql`${profile} is not null`),
        // Обрезано так же, как в `lmsOrgValue`: сравнивается обрезанное значение прохождения,
        // и написание с пробелами по краям иначе не совпало бы само с собой.
        db.selectDistinct({ value: sql<string>`btrim(${passage})` }).from(scormAttempts)
          .where(sql`nullif(btrim(${passage}), '') is not null`),
      ]);
      out[field] = [...new Set([...fromProfiles, ...fromPassages]
        .map(row => row.value)
        .filter((value): value is string => typeof value === "string"))];
    }
    return out;
  }

  /**
   * Ответы прохождений теста, пришедших из LMS.
   *
   * Тест строки телеметрии берётся с тем же запасным путём, что и в выборке прохождений:
   * `scorm_attempts.test_id` — источник истины, но у части старых записей его нет, и тест
   * известен только через пакет. Без этого статистика вопроса молча теряет ровно те
   * прохождения, ради которых пакет и собирали.
   */
  async selectAnswersForTest(testId: string): Promise<TestAnswerRow[]> {
    const rows = await db
      .select({
        questionId: scormAnswers.questionId,
        attemptId: scormAnswers.attemptId,
        result: scormAnswers.result,
        latencyMs: scormAnswers.latencyMs,
        points: scormAnswers.points,
        maxPoints: scormAnswers.maxPoints,
        userAnswer: scormAnswers.userAnswerJson,
        origin: scormAttempts.origin,
      })
      .from(scormAnswers)
      .innerJoin(scormAttempts, eq(scormAttempts.id, scormAnswers.attemptId))
      .leftJoin(scormPackages, eq(scormPackages.id, scormAttempts.packageId))
      .where(eq(sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`, testId));

    return rows.map(row => ({
      questionId: row.questionId,
      attemptId: row.attemptId,
      result: (row.result ?? "incorrect") as TestAnswerRow["result"],
      latencyMs: row.latencyMs ?? null,
      points: row.points ?? null,
      maxPoints: row.maxPoints ?? null,
      userAnswer: row.userAnswer,
      origin: (row.origin ?? "telemetry") as ObservationSourceName,
    }));
  }

  /**
   * PRD-66 FR-06: ответы НАЗВАННЫХ прохождений из LMS — сырьё матрицы «респондент × задание».
   *
   * Отличается от {@link selectAnswersForTest} тем, по чему отбирает: тот читает ВСЕ ответы
   * теста, а психометрика считает по выборке, которую уже задали фильтр экрана и срез. Читать
   * весь тест и отсеивать лишнее в памяти значило бы тянуть из базы то, что заведомо не нужно,
   * и — хуже — рисковать разойтись с выборкой прохождений на её же данных.
   *
   * Строка несёт `topic_id`: по нему ответ находит свой вариант выдачи в карте прохождения.
   */
  async selectAnswersForAttempts(attemptIds: string[]): Promise<TestAnswerRow[]> {
    if (attemptIds.length === 0) return [];
    const rows = await db
      .select({
        questionId: scormAnswers.questionId,
        attemptId: scormAnswers.attemptId,
        result: scormAnswers.result,
        latencyMs: scormAnswers.latencyMs,
        points: scormAnswers.points,
        maxPoints: scormAnswers.maxPoints,
        userAnswer: scormAnswers.userAnswerJson,
        topicId: scormAnswers.topicId,
        origin: scormAttempts.origin,
      })
      .from(scormAnswers)
      .innerJoin(scormAttempts, eq(scormAttempts.id, scormAnswers.attemptId))
      .where(inArray(scormAnswers.attemptId, attemptIds));

    return rows.map(row => ({
      questionId: row.questionId,
      attemptId: row.attemptId,
      result: (row.result ?? "incorrect") as TestAnswerRow["result"],
      latencyMs: row.latencyMs ?? null,
      points: row.points ?? null,
      maxPoints: row.maxPoints ?? null,
      userAnswer: row.userAnswer,
      topicId: row.topicId ?? null,
      origin: (row.origin ?? "telemetry") as ObservationSourceName,
    }));
  }

  /**
   * PRD-66 FR-08: членство НАЗВАННЫХ участников в группах, одним запросом.
   *
   * Группа — ось разбиения выборки, и спрашивать её по участнику отдельно значит выдать запрос
   * на каждого человека в выборке: на тысяче прохождений это тысяча обращений к базе ради
   * признака, который читается одним.
   */
  /**
   * PRD-56 FR-02: КАКАЯ ЭТО ПОПЫТКА участника по этому тесту.
   *
   * Номер нельзя посчитать по странице реестра: на ней видны не все попытки человека, и
   * вторая строка сверху вполне может быть его четвёртым заходом. Поэтому спрашиваются ВСЕ
   * прохождения участников страницы по тестам страницы — узкий набор, но полный по каждому
   * человеку.
   *
   * Оба источника идут одной выборкой и сортируются вместе: попытка в вебе и попытка в LMS —
   * попытки ОДНОГО человека, и нумеровать их порознь значило бы выдать две «первые».
   *
   * Участник опознаётся как в наблюдениях: учётной записью, а при её отсутствии —
   * псевдонимом импорта. Строка без того и другого не нумеруется вовсе: сказать, какая это
   * попытка и чья, не из чего.
   */
  async selectAttemptOrder(
    testIds: string[],
    userIds: string[],
    participantKeys: string[],
  ): Promise<Array<{ id: string; testId: string | null; participantId: string; startedAt: Date | null }>> {
    if (testIds.length === 0 || (userIds.length === 0 && participantKeys.length === 0)) return [];

    const web = userIds.length === 0 ? [] : await db
      .select({
        id: attempts.id,
        testId: attempts.testId,
        participantId: attempts.userId,
        startedAt: attempts.startedAt,
      })
      .from(attempts)
      .where(and(inArray(attempts.testId, testIds), inArray(attempts.userId, userIds)));

    const lms = await db
      .select({
        id: scormAttempts.id,
        testId: scormAttempts.testId,
        userId: scormAttempts.userId,
        participantKey: scormAttempts.participantKey,
        startedAt: scormAttempts.startedAt,
      })
      .from(scormAttempts)
      .where(and(
        inArray(scormAttempts.testId, testIds),
        or(
          userIds.length ? inArray(scormAttempts.userId, userIds) : sql`false`,
          participantKeys.length ? inArray(scormAttempts.participantKey, participantKeys) : sql`false`,
        ),
      ));

    type OrderRow = { id: string; testId: string | null; participantId: string; startedAt: Date | null };
    const all: Array<OrderRow | null> = [
      ...web.map(row => (row.participantId
        ? { id: row.id, testId: row.testId, participantId: row.participantId, startedAt: row.startedAt }
        : null)),
      ...lms.map(row => {
        const participantId = row.userId ?? row.participantKey;
        return participantId
          ? { id: row.id, testId: row.testId, participantId, startedAt: row.startedAt }
          : null;
      }),
    ];
    return all.filter((row): row is OrderRow => row !== null);
  }

  async selectGroupsOfUsers(userIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (userIds.length === 0) return out;
    const rows = await db
      .select({ userId: userGroups.userId, groupId: userGroups.groupId })
      .from(userGroups)
      .where(inArray(userGroups.userId, userIds));
    for (const row of rows) {
      const list = out.get(row.userId);
      if (list) list.push(row.groupId);
      else out.set(row.userId, [row.groupId]);
    }
    return out;
  }

  /**
   * PRD-56 FR-21: значения шкал прохождений теста — ОБА источника одной выборкой.
   *
   * Хранятся они по-разному: веб пишет `result_json.scaleResults` записью с сырым значением и
   * подписью уровня, LMS — `scales_json` картой «ключ -> число». Здесь обе формы приводятся к
   * числу: подпись уровня не читается ни у одного источника, потому что импорт её не хранит
   * вовсе, и считать уровень по-разному для двух источников значило бы получить два разных
   * распределения на одних данных.
   *
   * Запасной путь к тесту через пакет — тот же, что в остальных выборках.
   */
  async selectScaleValuesForTest(testId: string): Promise<ScaleValuesRow[]> {
    const [webRows, lmsRows] = await Promise.all([
      db
        .select({ id: attempts.id, resultJson: attempts.resultJson })
        .from(attempts)
        .where(and(eq(attempts.testId, testId), sql`${attempts.resultJson} is not null`)),
      db
        .select({
          id: scormAttempts.id,
          origin: scormAttempts.origin,
          scalesJson: scormAttempts.scalesJson,
        })
        .from(scormAttempts)
        .leftJoin(scormPackages, eq(scormPackages.id, scormAttempts.packageId))
        .where(and(
          eq(sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`, testId),
          sql`${scormAttempts.finishedAt} is not null`,
        )),
    ]);

    const out: ScaleValuesRow[] = [];
    for (const row of webRows) {
      const stored = (row.resultJson as { scaleResults?: Record<string, unknown> } | null)
        ?.scaleResults;
      out.push({ attemptId: row.id, source: "web", values: numbersOf(stored, "raw") });
    }
    for (const row of lmsRows) {
      out.push({
        attemptId: row.id,
        source: (row.origin ?? "telemetry") as ObservationSourceName,
        values: numbersOf(row.scalesJson as Record<string, unknown> | null),
      });
    }
    return out;
  }
}

/** Ответ на вопрос, записанный прохождением из LMS. */
export interface TestAnswerRow {
  questionId: string;
  /** Прохождение ответа: по нему считаются доли ПРОХОЖДЕНИЙ, а не ответов (FR-14a). */
  attemptId: string;
  /** `neutral` — измерительный ответ: ему нечего было оценивать (PRD-54). */
  result: "correct" | "incorrect" | "neutral";
  /** Время на вопрос; `null` — не измерялось (PRD-55). */
  latencyMs: number | null;
  /** Баллы ответа; `null` — пакет их не сообщил либо оценивать было нечего. */
  points: number | null;
  maxPoints: number | null;
  /**
   * Сам ответ, как его дал участник (PRD-56 FR-22). Нужен разбросу ответов измерительного
   * задания: у него нет эталона, и рассказать о нём можно только тем, ЧТО выбирали.
   */
  userAnswer: unknown;
  /** Тема задания: по ней ответ находит свой вариант выдачи. `null` у старых строк. */
  topicId?: string | null;
  origin: ObservationSourceName;
}

/** Значения шкал ОДНОГО прохождения, приведённые к числу. */
export interface ScaleValuesRow {
  attemptId: string;
  source: ObservationSourceName;
  /** «Ключ шкалы -> значение». Шкала без посчитанного значения ключа не получает. */
  values: Record<string, number>;
}

/**
 * Достать числа из записи значений.
 *
 * @param stored карта «ключ -> значение» либо «ключ -> запись со значением»
 * @param field поле записи, в котором лежит число; без него значение читается напрямую
 */
function numbersOf(stored: unknown, field?: string): Record<string, number> {
  if (!stored || typeof stored !== "object") return {};

  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(stored as Record<string, unknown>)) {
    const value = field !== undefined && raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)[field]
      : raw;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** Развернуть запрос-счётчик в число. */
async function countOf(query: PromiseLike<Array<{ n: number }>>): Promise<number> {
  const rows = await query;
  return rows[0]?.n ?? 0;
}
