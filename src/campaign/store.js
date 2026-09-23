// 状态层：把数据 / 规则 / 存储串起来。UI 只 dispatch action，不直接改数据。
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import {
  buildBackfillRevision, computeLevels, computeTotals, levelUpsBetween,
  makeSettlement, validateSettlement,
} from './rules.js';
import { loadState, saveState } from './storage.js';

// 章节顺序：先按游戏日期，再按 id（补录较早章节即落到时间线较早位置）
export function sessionOrder(sessions) {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

export function campaignReducer(state, action) {
  return reducer(state, action);
}

function init() {
  const { data, issues } = loadState();
  return { data, issues, lastMessage: '' };
}

function reducer(state, action) {
  const d = state.data;
  switch (action.type) {
    case 'ADD_SESSION': {
      const s = { ...action.session, id: action.id, color: action.session.color || '#d8a153' };
      return { ...state, data: { ...d, sessions: [...d.sessions, s] }, lastMessage: '新章节已加入时间线' };
    }
    case 'SAVE_DRAFT': {
      return {
        ...state,
        data: { ...d, drafts: { ...d.drafts, [action.sessionId]: { ...action.draft, updatedAt: action.now } } },
        lastMessage: '草稿已保留（未通过结算校验）',
      };
    }
    case 'DELETE_DRAFT': {
      const drafts = { ...d.drafts };
      delete drafts[action.sessionId];
      return { ...state, data: { ...d, drafts }, lastMessage: '草稿已删除' };
    }
    // 结算：
    //  - 新章节且其后没有已结算章节 → 直接结算并冻结
    //  - 已结算章节（冻结）→ 只能带原因修订
    //  - 未结算但其后已有结算（补录较早章节）→ 同样带原因、生成修订并重算后续
    case 'SETTLE': {
      const { sessionId, pool, participantIds, mvpId, reason } = action;
      const order = sessionOrder(d.sessions);
      const idx = order.findIndex((s) => s.id === sessionId);
      const frozen = Boolean(d.settlements[sessionId]);
      const backfill = order.slice(idx + 1).some((s) => d.settlements[s.id]);

      const guardErrors = validateSettlement({ pool, participantIds, mvpId });
      if ((frozen || backfill) && !String(reason || '').trim()) {
        guardErrors.push({ code: 'REASON', message: '补录 / 修订较早章节必须填写原因' });
      }
      if (guardErrors.length) {
        const draft = { pool, participantIds, mvpId, reason, errors: guardErrors, chapterTitle: action.chapterTitle, updatedAt: action.now };
        return {
          ...state,
          data: { ...d, drafts: { ...d.drafts, [sessionId]: draft } },
          lastMessage: '',
          settleErrors: { sessionId, errors: guardErrors },
        };
      }
      const settlement = makeSettlement({ sessionId, pool, participantIds, mvpId, now: action.now });
      if (!frozen && !backfill) {
        return {
          ...state,
          data: { ...d, settlements: { ...d.settlements, [sessionId]: settlement }, drafts: dropDraft(d.drafts, sessionId) },
          settleErrors: null,
          lastMessage: '章节已结算并冻结',
        };
      }
      // 补录 / 修订：生成带原因修订，重算后续累计经验与升级状态；旧记录保留
      const { revision, recordsAfter } = buildBackfillRevision({ data: d, sessionId, settlement, reason, now: action.now });
      return {
        ...state,
        data: {
          ...d,
          settlements: { ...recordsAfter, [sessionId]: settlement },
          revisions: [...d.revisions, revision],
          drafts: dropDraft(d.drafts, sessionId),
        },
        settleErrors: null,
        lastMessage: frozen
          ? '已结算章节已冻结，本次变更作为带原因修订保存，后续累计经验已重算'
          : '补录较早章节已作为带原因修订保存，后续累计经验与升级状态已重算',
      };
    }
    case 'CONFIRM_LEVEL': {
      return {
        ...state,
        data: { ...d, levels: { ...d.levels, [action.characterId]: action.level } },
        lastMessage: `${action.characterName} 升级至 ${action.level} 级已确认`,
      };
    }
    default:
      return state;
  }
}

function dropDraft(drafts, sid) {
  const next = { ...drafts };
  delete next[sid];
  return next;
}

export function useCampaign() {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const { data, issues, lastMessage, settleErrors } = state;

  // 持久化：reducer 只产生符合不变量的数据；保存前仍做一次一致性校验兜底
  useEffect(() => {
    saveState(data);
  }, [data]);

  const order = useMemo(() => sessionOrder(data.sessions), [data.sessions]);
  const derived = useMemo(() => {
    const { totals, perChapter } = computeTotals(order.map((s) => s.id), data.settlements);
    const levels = computeLevels(totals, data.levels);

    // 每章结算时引发的升级（相对该角色在该章之前的累计经验）
    const levelUpsByChapter = {};
    for (const sid of order.map((s) => s.id)) {
      const rec = data.settlements[sid];
      if (!rec) continue;
      const idx = order.findIndex((s) => s.id === sid);
      const prevIds = order.slice(0, idx).map((s) => s.id);
      const prevTotals = {};
      for (const p of prevIds) {
        const pr = data.settlements[p];
        if (pr) for (const a of pr.allocations) prevTotals[a.characterId] = (prevTotals[a.characterId] || 0) + a.total;
      }
      const ups = [];
      for (const a of rec.allocations) {
        const before = prevTotals[a.characterId] || 0;
        const after = before + a.total;
        for (const u of levelUpsBetween(before, after)) {
          ups.push({ characterId: a.characterId, ...u, confirmed: (data.levels[a.characterId] || 1) >= u.level });
        }
      }
      levelUpsByChapter[sid] = ups;
    }
    return { totals, perChapter, levels, levelUpsByChapter };
  }, [data, order]);

  const settle = useCallback((args) => dispatch({ type: 'SETTLE', now: Date.now(), ...args }), []);
  const saveDraft = useCallback((sessionId, draft) => dispatch({ type: 'SAVE_DRAFT', sessionId, draft, now: Date.now() }), []);
  const deleteDraft = useCallback((sessionId) => dispatch({ type: 'DELETE_DRAFT', sessionId }), []);
  const addSession = useCallback((session) => dispatch({ type: 'ADD_SESSION', session, id: Date.now() }), []);
  const confirmLevel = useCallback((characterId, characterName, level) =>
    dispatch({ type: 'CONFIRM_LEVEL', characterId, characterName, level }), []);

  // 修订链按章节分组（旧记录仍可查）
  const map = {};
  for (const rev of data.revisions) (map[rev.sessionId] ||= []).push(rev);
  const revisionsByChapter = map;

  return {
    data, order, derived, issues,
    lastMessage, settleErrors,
    settle, saveDraft, deleteDraft, addSession, confirmLevel,
    revisionsByChapter,
  };
}
