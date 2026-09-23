// 数据层：战役数据形状、初始数据、版本迁移。不包含任何结算规则。

export const LEVEL_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

export const CHARACTERS = [
  { id: 'c-adrian', name: '艾德里安', role: '圣骑士', player: '林默', color: '#d8a153' },
  { id: 'c-seline', name: '瑟琳', role: '游侠', player: '安然', color: '#93b7a6' },
  { id: 'c-moore', name: '莫尔', role: '术士', player: '周岳', color: '#b9a6d1' },
];

export function createSeed() {
  return {
    version: 2,
    name: '暮光边境',
    system: 'D&D 5E',
    sessions: [
      { id: 1, date: '2024-06-08', title: '第一章：灰港的钟声', summary: '队伍抵达灰港，在失落的钟楼发现了神秘符文。', tag: '主线', color: '#d8a153' },
      { id: 2, date: '2024-06-15', title: '第二章：雾中来客', summary: '与流浪法师伊琳结盟，追踪海雾中的脚印。', tag: '主线', color: '#93b7a6' },
      { id: 3, date: '2024-06-22', title: '支线：深林采药', summary: '帮助村民寻找月光草，获得一枚古老铜币。', tag: '支线', color: '#b9a6d1' },
    ],
    characters: CHARACTERS.map(({ ...c }) => c),
    settlements: {}, // sessionId -> 结算记录
    drafts: {},      // sessionId -> 草稿
    revisions: [],   // 修订链（追加，不覆盖旧记录）
    levels: {},      // characterId -> 已确认等级
  };
}

// 旧版（无 id / 无结算字段）数据迁移
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return createSeed();
  const base = raw.version >= 2 ? raw : { ...createSeed(), ...raw, version: 2 };
  const used = new Set();
  base.characters = (base.characters || []).map((c, i) => {
    let id = c.id;
    if (!id || used.has(id)) id = `c-${i}-${(c.name || 'char').slice(0, 6)}`;
    used.add(id);
    return { id, name: c.name || `角色${i + 1}`, role: c.role || '', player: c.player || '', color: c.color || '#93b7a6' };
  });
  base.sessions = (base.sessions || []).map((s) => ({
    id: s.id, date: s.date, title: s.title, summary: s.summary || '', tag: s.tag || '主线', color: s.color || '#d8a153',
  }));
  base.settlements = base.settlements || {};
  base.drafts = base.drafts || {};
  base.revisions = base.revisions || [];
  base.levels = base.levels || {};
  // 丢弃引用了已删除角色/章节的孤立数据
  const charIds = new Set(base.characters.map((c) => c.id));
  const sessionIds = new Set(base.sessions.map((s) => s.id));
  for (const sid of Object.keys(base.settlements)) {
    if (!sessionIds.has(Number(sid))) delete base.settlements[sid];
    else {
      const st = base.settlements[sid];
      st.participantIds = (st.participantIds || []).filter((id) => charIds.has(id));
      if (!charIds.has(st.mvpId)) st.mvpId = st.participantIds[0] || null;
    }
  }
  for (const sid of Object.keys(base.drafts)) {
    if (!sessionIds.has(Number(sid))) delete base.drafts[sid];
    else {
      const d = base.drafts[sid];
      d.participantIds = (d.participantIds || []).filter((id) => charIds.has(id));
      if (!charIds.has(d.mvpId)) d.mvpId = d.participantIds[0] || null;
    }
  }
  base.levels = Object.fromEntries(Object.entries(base.levels).filter(([id]) => charIds.has(id)));
  return base;
}
