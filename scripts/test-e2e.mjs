// 端到端：模拟 localStorage，验证结算→冻结→补录→重算→刷新重载的一致性。
import assert from 'node:assert';
import { createSeed, migrate } from '../src/campaign/data.js';import { audit, saveState, loadState } from '../src/campaign/storage.js';
import { makeSettlement, buildBackfillRevision, computeTotals, computeLevels, validateSettlement } from '../src/campaign/rules.js';

// --- 假 localStorage / structuredClone（Node 20 自带 structuredClone）---
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

let { data } = loadState();
assert.equal(data.sessions.length, 3);
assert.equal(audit(data).filter(i => i.severity === 'error').length, 0);

const order = [...data.sessions].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
const [s1, s2, s3] = order;
const [A, S, M] = data.characters.map(c => c.id);

// --- 结算第三章（最新）：600 池 ---
let errs = validateSettlement({ pool: 600, participantIds: [A, S, M], mvpId: A });
assert.deepEqual(errs, []);
data.settlements[s3.id] = makeSettlement({ sessionId: s3.id, pool: 600, participantIds: [A, S, M], mvpId: A, now: 1 });
saveState(data);

// --- 校验失败保留草稿：MVP 不在出场名单，须列出差额/冲突角色 ---
errs = validateSettlement({ pool: 600, participantIds: [A, S], mvpId: M });
assert.ok(errs.some(e => e.code === 'MVP' && e.conflictIds.includes(M)));
data.drafts[s2.id] = { pool: 600, participantIds: [A, S], mvpId: M, errors: errs };
saveState(data);

// --- 结算第二章 ---
delete data.drafts[s2.id];
data.settlements[s2.id] = makeSettlement({ sessionId: s2.id, pool: 300, participantIds: [A, S], mvpId: S, now: 2 });
saveState(data);

// 累计：ch2(A=150,S=225) + ch3(A=300,S=200,M=200)
let { totals } = computeTotals([s1.id, s2.id, s3.id], data.settlements);
assert.deepEqual(totals, { [A]: 450, [S]: 425, [M]: 200 });

// --- 刷新：重新载入，章节、分配、累计经验一致 ---
let reloaded = loadState().data;
let { totals: rt } = computeTotals([s1.id, s2.id, s3.id], reloaded.settlements);
assert.deepEqual(rt, totals);
assert.ok(reloaded.settlements[s3.id].frozen);
assert.equal(reloaded.drafts[s2.id], undefined);

// --- 补录第一章（更早章节，此前未结算）：900 池，重算后续 ---
const rec = makeSettlement({ sessionId: s1.id, pool: 900, participantIds: [A, S, M], mvpId: M, now: 3 });
const { revision, totals: t2, levels } = buildBackfillRevision({
  data: reloaded, sessionId: s1.id, settlement: rec, reason: '补录漏登的第一章经验', now: 4,
});
assert.equal(revision.frozen, false);
reloaded.settlements[s1.id] = rec;
reloaded.revisions.push(revision);
saveState(reloaded);

// ch1: A300 S300 M450 → 合计 A750 S725 M650
assert.deepEqual(t2, { [A]: 750, [S]: 725, [M]: 650 });
assert.equal(levels[A].autoLevel, 2);
assert.equal(levels[S].autoLevel, 2);
assert.equal(levels[M].autoLevel, 2);
// 受影响章节包含 ch2 与 ch3
assert.deepEqual(revision.affected.map(a => a.sessionId).sort(), [s1.id, s2.id, s3.id].sort());

// --- 冻结章节再修订（ch3 600→601，原因必填），旧记录保留 ---
const before = structuredClone(reloaded.settlements[s3.id]);
const rec2 = makeSettlement({ sessionId: s3.id, pool: 601, participantIds: [A, S, M], mvpId: A, now: 5 });
const r2 = buildBackfillRevision({ data: reloaded, sessionId: s3.id, settlement: rec2, reason: 'GM 更正经验池', now: 6 }).revision;
assert.equal(r2.frozen, true);
assert.equal(r2.previousSettlement.pool, 600);
assert.equal(r2.settlement.pool, 601);
assert.deepEqual(r2.previousSettlement.allocations, before.allocations);
reloaded.settlements[s3.id] = rec2;
reloaded.revisions.push(r2);
saveState(reloaded);

// --- 再次刷新：修订链 2 条，累计为最终值 ---
let final2 = loadState();
assert.equal(final2.data.revisions.length, 2);
assert.equal(audit(final2.data).filter(i => i.severity === 'error').length, 0);
// ch1 A300 S300 M450 + ch2 A150 S225 + ch3(601池) A301 S200 M200
const { totals: ft } = computeTotals([s1.id, s2.id, s3.id], final2.data.settlements);
assert.deepEqual(ft, { [A]: 751, [S]: 725, [M]: 650 });

// 修订链可查：旧 ch3 分配仍是 600 池时的 300/200/200
const oldCh3 = final2.data.revisions.find(r => r.sessionId === s3.id).previousSettlement;
assert.deepEqual(oldCh3.allocations.map(a => a.total), [300, 200, 200]);
// 新 ch3（601）余数仅给第一名：301/200/200
assert.deepEqual(final2.data.settlements[s3.id].allocations.map(a => a.total), [301, 200, 200]);

// --- 篡改存储：分配明细改坏，审计必须发现 ---
const tampered = structuredClone(final2.data);
tampered.settlements[s3.id].allocations[0].total = 9999;
const issues = audit(tampered);
assert.ok(issues.some(i => i.code === 'ALLOC_MISMATCH'));
assert.throws(() => saveState(tampered), /一致性/);

// --- 补录未冻结的较早章节（后续已结算）：无原因 → 拒绝并存草稿；有原因 → 修订+重算 ---
const { campaignReducer } = await import('../src/campaign/store.js');
{
  const fresh = migrate(createSeed());
  const ord = [...fresh.sessions].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let st = { data: fresh, issues: [], lastMessage: '' };

  // 只结算最末章
  st = campaignReducer(st, { type: 'SETTLE', sessionId: ord[2].id, pool: 600, participantIds: [A, S, M], mvpId: A, now: 1 });
  assert.ok(st.data.settlements[ord[2].id].frozen);
  assert.equal(st.settleErrors, null);

  // 结算中间章但不给原因 → 拒绝，草稿保留，错误含 REASON
  st = campaignReducer(st, { type: 'SETTLE', sessionId: ord[1].id, pool: 300, participantIds: [A, S], mvpId: S, reason: '', now: 2 });
  assert.ok(st.settleErrors.errors.some(e => e.code === 'REASON'));
  assert.ok(st.data.drafts[ord[1].id]);
  assert.equal(st.data.settlements[ord[1].id], undefined);

  // 带原因补录 → 成功，生成修订（frozen=false 但属补录）并重算
  st = campaignReducer(st, { type: 'SETTLE', sessionId: ord[1].id, pool: 300, participantIds: [A, S], mvpId: S, reason: '补录漏登', now: 3 });
  assert.equal(st.settleErrors, null);
  assert.ok(st.data.settlements[ord[1].id]);
  assert.equal(st.data.drafts[ord[1].id], undefined);
  assert.equal(st.data.revisions.length, 1);
  assert.equal(st.data.revisions[0].reason, '补录漏登');
  assert.equal(st.data.revisions[0].frozen, false);
  // 后续章节（末章）在 affected 中
  assert.ok(st.data.revisions[0].affected.some(a => a.sessionId === ord[2].id));
  saveState(st.data);
}

// --- 旧版数据（无 id 角色 / 旧 key）迁移 ---
const legacy = {
  name: '旧战役', system: 'X',
  sessions: [{ id: 7, date: '2024-01-01', title: 't', tag: '主线' }],
  characters: [{ name: '甲', role: '', player: '', color: '#fff' }, { name: '乙', role: '', player: '', color: '#eee' }],
};
const mig = migrate(legacy);
assert.equal(mig.version, 2);
assert.ok(mig.characters.every(c => c.id));
assert.equal(audit(mig).filter(i => i.severity === 'error').length, 0);

console.log('ALL E2E TESTS PASSED');
