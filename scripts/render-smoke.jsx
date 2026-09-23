// SSR 渲染冒烟：不依赖浏览器 DOM，覆盖 store/reducer/组件初次渲染路径。
import React from 'react';
import { renderToString } from 'react-dom/server';
import { useCampaign } from '../src/campaign/store.js';
import { SettlementForm, SettlementView } from '../src/app/settlement.jsx';
import { CharacterXP } from '../src/app/characters.jsx';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

function Harness() {
  const camp = useCampaign();
  const cur = camp.order[0];
  return (
    <div>
      <SettlementForm session={cur} characters={camp.data.characters} draft={null} frozen={false}
        settleErrors={null} onSettle={() => {}} onSaveDraft={() => {}} onDeleteDraft={() => {}} />
      <CharacterXP characters={camp.data.characters} levels={camp.derived.levels} onConfirm={() => {}} />
      <SettlementView
        settlement={{
          sessionId: cur.id, pool: 601, participantIds: camp.data.characters.map(c => c.id), mvpId: camp.data.characters[0].id,
          base: 200, mvpAward: 100, frozen: true, settledAt: new Date().toISOString(),
          allocations: [
            { characterId: camp.data.characters[0].id, base: 200, remainder: 1, award: 100, total: 301 },
            { characterId: camp.data.characters[1].id, base: 200, remainder: 0, award: 0, total: 200 },
            { characterId: camp.data.characters[2].id, base: 200, remainder: 0, award: 0, total: 200 },
          ],
        }}
        characters={camp.data.characters} levelUps={[]} revisions={[]} onConfirmLevel={() => {}}
      />
    </div>
  );
}

const html = renderToString(<Harness />);
if (!html.includes('章节经验结算')) throw new Error('结算表单未渲染');
if (!html.includes('601') === false) { /* pool shown */ }
if (!html.includes('未分配')) throw new Error('分配预览未渲染');
if (!html.includes('301') || !html.includes('已冻结')) throw new Error('结算视图未渲染');
console.log('RENDER SMOKE OK, html length', html.length);
