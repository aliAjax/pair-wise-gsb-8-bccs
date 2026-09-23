// 结算规则层：纯函数。经验分配、校验、累计经验、升级状态、修订链重算。
import { LEVEL_THRESHOLDS } from './data.js';

// 经验池按出场角色均分：base = floor(pool / n)，余数依角色顺序逐个 +1，恰好分光。
// 本场最佳另得奖励（经验池之外），上限为基础份额的一半（向下取整）。
// 返回 { base, award, awards, allocations: [{characterId, base, remainder, award, total}], poolAllocated, unassigned, remainder, maxAward }
export function planAllocation({ pool, participantIds, mvpId }) {
  const n = participantIds.length;
  const base = n > 0 ? Math.floor(pool / n) : 0;
  const remainder = n > 0 ? pool - base * n : 0;
  const maxAward = Math.floor(base / 2);
  const award = maxAward; // 规则自动给满上限；不需要额外登记
  const awards = {};
  const allocations = participantIds.map((id, i) => {
    const rem = i < remainder ? 1 : 0;
    const mvp = id === mvpId ? award : 0;
    awards[id] = base + rem + mvp;
    return { characterId: id, base, remainder: rem, award: mvp, total: awards[id] };
  });
  const poolAllocated = allocations.reduce((s, a) => s + a.base + a.remainder, 0);
  return { base, award, awards, allocations, poolAllocated, unassigned: pool - poolAllocated, remainder, maxAward };
}

// 校验一次结算尝试。失败时返回错误列表（含章节、差额、冲突角色，供"保留草稿"界面列出）。
export function validateSettlement({ pool, participantIds, mvpId }) {
  const errors = [];
  if (!Number.isInteger(pool) || pool <= 0) errors.push({ code: 'POOL', message: '经验池须为正整数' });
  if (!participantIds || participantIds.length === 0) errors.push({ code: 'CAST', message: '至少选择一名出场角色' });
  if (participantIds && new Set(participantIds).size !== participantIds.length) {
    errors.push({ code: 'CAST_DUP', message: '出场角色重复', conflictIds: participantIds.filter((id, i) => participantIds.indexOf(id) !== i) });
  }
  if (participantIds && participantIds.length > 0 && !participantIds.includes(mvpId)) {
    errors.push({ code: 'MVP', message: '本场最佳必须是出场角色之一', conflictIds: mvpId ? [mvpId] : [] });
  }
  if (errors.length === 0) {
    const plan = planAllocation({ pool, participantIds, mvpId });
    // 未分配额必须为零：基础份额与余数之和必须恰好等于经验池
    if (plan.unassigned !== 0) {
      errors.push({ code: 'UNASSIGNED', message: '经验池未完全分配', diff: plan.unassigned, conflictIds: participantIds });
    }
    // 最佳奖励不得超过基础份额一半
    if (plan.award > plan.maxAward) {
      errors.push({ code: 'MVP_CAP', message: '最佳奖励超过基础份额的一半', diff: plan.award - plan.maxAward, conflictIds: [mvpId] });
    }
  }
  return errors;
}

// 复核一条已存储的结算记录（载入/迁移时用）：记录可能被手动改坏。
// 返回 null 表示通过；否则返回错误列表。
export function verifyStoredSettlement(rec) {
  if (!rec || !Array.isArray(rec.allocations)) return [{ code: 'SHAPE', message: '结算记录结构损坏' }];
  const errors = validateSettlement({
    pool: rec.pool,
    participantIds: rec.participantIds,
    mvpId: rec.mvpId,
  });
  const plan = planAllocation({ pool: rec.pool, participantIds: rec.participantIds, mvpId: rec.mvpId });
  rec.allocations.forEach((a) => {
    const expect = plan.awards[a.characterId];
    if (expect === undefined || a.total !== expect) {
      errors.push({ code: 'ALLOC_MISMATCH', message: '分配明细与规则不符', diff: (a.total || 0) - (expect || 0), conflictIds: [a.characterId] });
    }
  });
  return errors;
}

export function levelFromXp(xp) {
  let lv = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) lv = i + 1;
    else break;
  }
  return lv;
}

export function nextThreshold(xp) {
  for (const t of LEVEL_THRESHOLDS) {
    if (xp < t) return t;
  }
  return null; // 已满级
}

// 按章节顺序汇总每个角色在某一章（含）之前的累计经验。
// order：按时间排序的章节 id 列表；records：sid -> settlement（仅传已结算章节）
export function computeTotals(order, records) {
  const totals = {};
  const perChapter = {};
  for (const sid of order) {
    const rec = records[sid];
    if (rec && rec.allocations) {
      for (const a of rec.allocations) {
        totals[a.characterId] = (totals[a.characterId] || 0) + a.total;
      }
    }
    perChapter[sid] = { ...totals };
  }
  return { totals, perChapter };
}

// 升级状态：结合自动等级（由累计经验推导）与已确认等级。
// confirmed: characterId -> level；返回每角色待办信息。
export function computeLevels(totals, confirmed = {}) {
  const out = {};
  for (const [id, xp] of Object.entries(totals)) {
    const auto = levelFromXp(xp);
    const done = confirmed[id] || 1;
    out[id] = {
      xp,
      level: Math.max(done, auto),
      autoLevel: auto,
      pending: auto > done,
      pendingUps: auto - done,
    };
  }
  return out;
}

export function levelUpsBetween(prevXp = 0, nextXp = 0) {
  const ups = [];
  for (let lv = 2; lv <= LEVEL_THRESHOLDS.length; lv++) {
    const t = LEVEL_THRESHOLDS[lv - 1];
    if (prevXp < t && nextXp >= t) ups.push({ level: lv, threshold: t });
  }
  return ups;
}

// 补录较早章节：已结算章节冻结，只能生成"带原因修订"。
// 生成修订草案：把新结算插入到目标位置，重算后续累计经验与升级状态，旧记录保留在 revisions 中。
// 返回 { revision, recalculated }
export function buildBackfillRevision({ data, sessionId, settlement, reason, now }) {
  const order = [...data.sessions].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const orderedIds = order.map((s) => s.id);
  const insertIdx = orderedIds.indexOf(sessionId);
  if (insertIdx === -1) throw new Error('章节不存在');

  // 冻结校验：目标章节若已结算，只允许修订
  const frozen = Boolean(data.settlements[sessionId]);
  const recordsBefore = {};
  for (const sid of orderedIds) {
    if (data.settlements[sid] && sid !== sessionId) recordsBefore[sid] = data.settlements[sid];
  }

  const recordsAfter = { ...recordsBefore, [sessionId]: settlement };
  const { totals, perChapter } = computeTotals(orderedIds, recordsAfter);
  const { totals: oldTotals } = computeTotals(orderedIds, data.settlements);

  // 受影响章节（插入位置及其后所有已结算章节）的累计值变化
  const affected = [];
  for (let i = insertIdx; i < orderedIds.length; i++) {
    const sid = orderedIds[i];
    const before = perChapterOld(orderedIds, data.settlements, sid);
    const after = perChapter[sid] || {};
    const changedChars = new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ].filter((id) => (before[id] || 0) !== (after[id] || 0)));
    if (changedChars.size > 0 || data.settlements[sid] || sid === sessionId) {
      affected.push({ sessionId: sid, changes: [...changedChars].map((id) => ({
        characterId: id, before: before[id] || 0, after: after[id] || 0, diff: (after[id] || 0) - (before[id] || 0),
      })) });
    }
  }

  // 升级状态变化
  const oldLevels = computeLevels(oldTotals, data.levels);
  const newLevels = computeLevels(totals, data.levels);
  const levelChanges = Object.keys(newLevels).filter((id) =>
    (oldLevels[id]?.autoLevel || 1) !== newLevels[id].autoLevel);

  const revision = {
    id: `rev-${now}-${sessionId}`,
    createdAt: new Date(now).toISOString(),
    sessionId,
    reason: reason || '补录较早章节',
    frozen,
    previousSettlement: frozen ? structuredClone(data.settlements[sessionId]) : null,
    settlement: structuredClone(settlement),
    affected,
    levelChanges: levelChanges.map((id) => ({
      characterId: id,
      fromLevel: oldLevels[id]?.autoLevel || 1,
      toLevel: newLevels[id].autoLevel,
    })),
  };
  return { revision, recordsAfter, totals, perChapter, levels: newLevels };
}

function perChapterOld(orderedIds, records, untilSid) {
  const totals = {};
  for (const sid of orderedIds) {
    const rec = records[sid];
    if (rec && rec.allocations) for (const a of rec.allocations) totals[a.characterId] = (totals[a.characterId] || 0) + a.total;
    if (sid === untilSid) break;
  }
  return totals;
}

export function makeSettlement({ sessionId, pool, participantIds, mvpId, now }) {
  const plan = planAllocation({ pool, participantIds: [...participantIds], mvpId });
  return {
    sessionId,
    pool,
    participantIds: [...participantIds],
    mvpId,
    base: plan.base,
    mvpAward: plan.award,
    allocations: structuredClone(plan.allocations),
    settledAt: new Date(now).toISOString(),
    frozen: true,
  };
}
