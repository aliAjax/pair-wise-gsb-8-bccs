// 存储层：localStorage 读写 + 载入时一致性校验。不含 UI、不改结算规则。
import { createSeed, migrate } from './data.js';
import { verifyStoredSettlement } from './rules.js';

const KEY = 'campaign-log-v2';

// 检查存储数据的内部一致性；返回 { data, issues }
export function loadState() {
  let data;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    data = raw ? migrate(raw) : createSeed();
  } catch {
    data = createSeed();
  }
  const issues = audit(data);
  return { data, issues };
}

export function saveState(data) {
  // 保存前再做一次不变量校验，避免把不一致状态写入存储
  const issues = audit(data);
  if (issues.some((i) => i.severity === 'error')) {
    throw new Error('数据未通过一致性校验，已阻止写入');
  }
  localStorage.setItem(KEY, JSON.stringify(data));
}

// 一致性审计：引用完整性、结算不变量、修订链连续性
export function audit(data) {
  const issues = [];
  const charIds = new Set(data.characters.map((c) => c.id));
  const sessionIds = new Set(data.sessions.map((s) => s.id));

  for (const [sid, rec] of Object.entries(data.settlements)) {
    const sessionId = Number(sid);
    if (!sessionIds.has(sessionId)) { issues.push({ severity: 'error', code: 'ORPHAN_SETTLEMENT', sessionId }); continue; }
    if (rec.sessionId !== sessionId) issues.push({ severity: 'error', code: 'SID_MISMATCH', sessionId });
    const errs = verifyStoredSettlement(rec);
    for (const e of errs) issues.push({ severity: 'error', ...e, sessionId });
    if (!rec.frozen) issues.push({ severity: 'warn', code: 'NOT_FROZEN', sessionId });
  }
  for (const sid of Object.keys(data.drafts)) {
    if (!sessionIds.has(Number(sid))) issues.push({ severity: 'warn', code: 'ORPHAN_DRAFT', sessionId: Number(sid) });
  }
  // 修订链引用必须可解析
  for (const rev of data.revisions) {
    if (!sessionIds.has(rev.sessionId)) issues.push({ severity: 'error', code: 'ORPHAN_REVISION', revisionId: rev.id, sessionId: rev.sessionId });
    const errs = verifyStoredSettlement(rev.settlement);
    if (errs.length) issues.push({ severity: 'error', code: 'REV_BAD_SETTLEMENT', revisionId: rev.id, errs });
  }
  for (const id of Object.keys(data.levels)) {
    if (!charIds.has(id)) issues.push({ severity: 'warn', code: 'ORPHAN_LEVEL', characterId: id });
  }
  return issues;
}
