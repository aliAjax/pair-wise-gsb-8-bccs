// 存储层：localStorage 读写与旧版本数据迁移。
// 不包含任何结算规则，仅负责持久化与结构归一化。

import { seed } from '../data/seed.js';
import { emptyDraft } from '../rules/xp.js';

const KEY = 'campaign-log';

function normalize(raw) {
  const data = {
    ...seed,
    ...raw,
    characters: raw.characters || seed.characters,
    sessions: raw.sessions || seed.sessions,
  };
  data.revisions = data.revisions || [];
  data.revisionSeq = data.revisionSeq || data.revisions.length;

  // v1 -> v2：角色补 id，章节补经验登记
  const usedNames = new Set();
  data.characters = data.characters.map((c, i) => {
    let id = c.id;
    if (!id) {
      id = `c${i + 1}`;
      while (usedNames.has(id)) id = `${id}x`;
    }
    usedNames.add(id);
    return { ackLevel: 1, ...c, id };
  });

  data.sessions = data.sessions.map((s) => ({
    ...s,
    xp: s.xp
      ? { status: 'draft', pool: '', participants: [], mvp: '', bonus: 0, insertedBeforeSettled: false, ...s.xp }
      : emptyDraft(),
  }));
  return data;
}

export function loadData() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw) return structuredClone(seed);
    return normalize(raw);
  } catch {
    return structuredClone(seed);
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 存储不可用时静默降级，页面仍可在内存中工作
  }
}

export function exportJson(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'campaign.json';
  a.click();
  URL.revokeObjectURL(url);
}
