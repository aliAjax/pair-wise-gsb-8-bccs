// 规则不变量快速验证（node 直接跑，非项目依赖）
import assert from 'node:assert';
import { planAllocation, validateSettlement, computeTotals, levelFromXp, levelUpsBetween, buildBackfillRevision, makeSettlement, computeLevels } from '../src/campaign/rules.js';

const A = 'c-adrian', S = 'c-seline', M = 'c-moore';

// 1) pool=600, 3人：base=200, rem=0, award=100
let p = planAllocation({ pool: 600, participantIds: [A, S, M], mvpId: A });
assert.equal(p.base, 200); assert.equal(p.remainder, 0); assert.equal(p.unassigned, 0);
assert.equal(p.award, 100); assert.equal(p.maxAward, 100);
assert.deepEqual(p.allocations.map(a => a.total), [300, 200, 200]);

// 2) pool=601：余数1 依序给第一名；池本体 201+200+200=601 全分
p = planAllocation({ pool: 601, participantIds: [A, S, M], mvpId: S });
assert.equal(p.remainder, 1);
assert.deepEqual(p.allocations.map(a => [a.remainder, a.total]), [[1, 201], [0, 300], [0, 200]]);
assert.equal(p.unassigned, 0);

// 3) pool=602，余数2 前两名；MVP 另得奖励100（base=200）
p = planAllocation({ pool: 602, participantIds: [A, S, M], mvpId: M });
assert.equal(p.base, 200); assert.equal(p.award, 100);
assert.deepEqual(p.allocations.map(a => a.total), [201, 201, 300]);

// 4) pool=604：base=201 rem=1，mvp award=100（floor(201/2)）
p = planAllocation({ pool: 604, participantIds: [A, S, M], mvpId: A });
assert.equal(p.base, 201); assert.equal(p.award, 100);
assert.deepEqual(p.allocations.map(a => a.total), [302, 201, 201]);
assert.equal(p.poolAllocated, 604); assert.equal(p.unassigned, 0);

// 5) pool=10, 3人：base=3 rem=1，award<=1（floor(3/2)=1）
p = planAllocation({ pool: 10, participantIds: [A, S, M], mvpId: A });
assert.equal(p.award, 1); assert.ok(p.award <= Math.floor(p.base / 2));

// 6) 校验失败：空出场
assert.ok(validateSettlement({ pool: 100, participantIds: [], mvpId: null }).some(e => e.code === 'CAST'));
// MVP 不在出场名单 → 冲突角色
const errs = validateSettlement({ pool: 100, participantIds: [A, S], mvpId: M });
assert.ok(errs.some(e => e.code === 'MVP' && e.conflictIds.includes(M)));
// 池非法
assert.ok(validateSettlement({ pool: 0, participantIds: [A], mvpId: A }).some(e => e.code === 'POOL'));
// 合法输入无错
assert.deepEqual(validateSettlement({ pool: 301, participantIds: [A, S, M], mvpId: S }), []);

// 7) 累计经验：按顺序
const r1 = makeSettlement({ sessionId: 1, pool: 600, participantIds: [A, S, M], mvpId: A, now: 1 });
const r2 = makeSettlement({ sessionId: 2, pool: 600, participantIds: [A, S], mvpId: S, now: 2 });
let { totals } = computeTotals([1, 2], { 1: r1, 2: r2 });
assert.deepEqual(totals, { [A]: 300 + 300, [S]: 200 + 450, [M]: 200 });

// 8) 等级阈值
assert.equal(levelFromXp(0), 1);
assert.equal(levelFromXp(299), 1);
assert.equal(levelFromXp(300), 2);
assert.equal(levelFromXp(899), 2);
assert.equal(levelFromXp(900), 3);
const ups = levelUpsBetween(200, 950);
assert.deepEqual(ups.map(u => u.level), [2, 3]);
assert.deepEqual(levelUpsBetween(300, 899), []);

// 9) 补录较早章节（冻结修订 + 重算后续）
const data = {
  sessions: [{ id: 1, date: '2024-06-08' }, { id: 2, date: '2024-06-15' }],
  settlements: { 1: r1, 2: r2 },
  revisions: [],
  levels: {},
};
// 模拟"章节1原本未结算，后来补录"：构造只有 ch2 的状态
const data2 = { ...data, settlements: { 2: r2 } };
const rec = makeSettlement({ sessionId: 1, pool: 900, participantIds: [A, S, M], mvpId: M, now: 3 });
const { revision, totals: t2, levels: lv2 } = buildBackfillRevision({ data: data2, sessionId: 1, settlement: rec, reason: '补录漏登章节', now: 999 });
assert.equal(revision.frozen, false);
assert.equal(t2[A], 300 + 300);            // ch1: base300; ch2: 300（无MVP，A 未在 ch2 当最佳）
assert.equal(t2[S], 300 + 450);            // ch1: base300; ch2: base300+mvp150
assert.equal(t2[M], 450 + 0);              // ch1: base300+mvp150；ch2 未出场
assert.ok(revision.affected.some(af => af.sessionId === 2));
// 升级重算：A=600(2级)、S=750(2级)、M=450(2级)
assert.equal(lv2[A].autoLevel, 2);
assert.equal(lv2[S].autoLevel, 2);
assert.equal(lv2[M].autoLevel, 2);

// 10) 已结算章节只能带原因修订；旧记录保留在 revision.previousSettlement
const rev2 = buildBackfillRevision({ data, sessionId: 1, settlement: rec, reason: '更正经验池', now: 1000 }).revision;
assert.equal(rev2.frozen, true);
assert.equal(rev2.previousSettlement.pool, 600);
assert.equal(rev2.settlement.pool, 900);

// 11) 升级待办 + 确认
let levels = computeLevels({ [A]: 600 }, {});
assert.equal(levels[A].pending, true);
assert.equal(levels[A].pendingUps, 1);
assert.equal(levels[A].autoLevel, 2);
levels = computeLevels({ [A]: 600 }, { [A]: 2 });
assert.equal(levels[A].pending, false);
assert.equal(levels[A].level, 2);
// 900 XP 一次跨越两个阈值 → 2 项待办
levels = computeLevels({ [A]: 900 }, {});
assert.equal(levels[A].pendingUps, 2);

// 12) 任意池值 fuzz：未分配恒为零；award<=floor(base/2)；顺序余数
for (const pool of Array.from({ length: 2000 }, (_, i) => i + 1)) {
  const n = 3;
  const q = planAllocation({ pool, participantIds: [A, S, M], mvpId: [A, S, M][pool % 3] });
  assert.equal(q.unassigned, 0, `pool=${pool}`);
  assert.ok(q.award <= Math.floor(q.base / 2));
  assert.equal(q.remainder, pool - q.base * n);
  assert.ok(q.remainder < n);
  assert.equal(q.poolAllocated, pool);
}

console.log('ALL RULE TESTS PASSED');
