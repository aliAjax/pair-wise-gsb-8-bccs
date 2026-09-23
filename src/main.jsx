import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { useCampaign } from './campaign/store.js';
import { SettlementForm, SettlementView } from './app/settlement.jsx';
import { CharacterXP } from './app/characters.jsx';

function App() {
  const camp = useCampaign();
  const { data, order, derived, issues, lastMessage, settleErrors,
    settle, saveDraft, deleteDraft, addSession, confirmLevel, revisionsByChapter } = camp;
  const [tab, setTab] = useState('timeline');
  const [active, setActive] = useState(data.sessions[0]?.id);
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ title: '', date: '2024-07-01', summary: '', tag: '主线' });

  useEffect(() => { if (lastMessage) setNotice(lastMessage); }, [lastMessage]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3200);
    return () => clearTimeout(t);
  }, [notice]);

  const cur = data.sessions.find((x) => x.id === active) || order[0];
  const curId = cur?.id;
  const chapterNo = cur ? order.findIndex((s) => s.id === cur.id) + 1 : 0;
  const curIdx = cur ? order.findIndex((s) => s.id === cur.id) : -1;
  const backfill = curIdx >= 0 && order.slice(curIdx + 1).some((s) => data.settlements[s.id]);
  const settlement = curId != null ? data.settlements[curId] : null;
  const draft = curId != null ? data.drafts[curId] : null;
  const formErrors = settleErrors?.sessionId === curId ? settleErrors.errors : (draft?.errors || null);

  const add = () => {
    if (!form.title) return;
    const s = { ...form, color: form.tag === '支线' ? '#b9a6d1' : form.tag === '番外' ? '#93b7a6' : '#d8a153' };
    addSession(s);
    setActive(Date.now());
    setForm({ title: '', date: '2024-07-01', summary: '', tag: '主线' });
    setShow(false);
  };

  const exportData = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'campaign.json';
    a.click();
    setNotice('战役记录已导出');
  };

  const pendingTotal = Object.values(derived.levels).filter((l) => l.pending).reduce((n, l) => n + l.pendingUps, 0);

  return (
    <div className="shell">
      <aside>
        <div className="logo"><span>✦</span> CAMPAIGNER</div>
        <div className="campaign">
          <small>当前战役</small>
          <strong>{data.name}</strong>
          <span>{data.system} · 2024</span>
        </div>
        <nav>{[
          ['timeline', '◌', '时间线'],
          ['characters', '♙', '角色与经验'],
          ['places', '⌖', '地点图鉴'],
          ['loot', '◇', '战利品'],
        ].map(([id, i, t]) => (
          <button className={tab === id ? 'active' : ''} onClick={() => setTab(id)} key={id}>
            <i>{i}</i>{t}
            {id === 'characters' && pendingTotal > 0 && <em className="nav-badge">{pendingTotal}</em>}
          </button>
        ))}
        </nav>
        <div className="side-bottom">
          <button>⚙ 偏好设置</button>
          <small>本地存储已开启 · 分层数据/规则/存储</small>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <span className="crumb">MY CAMPAIGN / {data.system}</span>
            <h1>{tab === 'timeline' ? '战役时间线' : tab === 'characters' ? '角色与经验' : tab === 'places' ? '地点图鉴' : '战利品'}</h1>
          </div>
          <div className="actions">
            <button onClick={exportData} className="outline">↓ 导出</button>
            <button onClick={() => setShow(true)} className="primary">＋ 新建章节</button>
          </div>
        </header>

        {issues.length > 0 && (
          <div className="audit-banner">
            <strong>⚠ 载入时发现 {issues.length} 项数据一致性问题</strong>
            <ul>{issues.slice(0, 6).map((x, i) => <li key={i}>[{x.severity}] {x.code}{x.sessionId ? ` · 章节 #${x.sessionId}` : ''}{x.message ? ` · ${x.message}` : ''}</li>)}</ul>
          </div>
        )}

        {tab === 'timeline' && (
          <div className="timeline-layout">
            <section className="timeline">
              <div className="timeline-intro">
                <div><span>THE CHRONICLE</span><h2>记录每一次冒险</h2></div>
                <span className="count">{data.sessions.length} CHAPTERS · {Object.keys(data.settlements).length} 已结算</span>
              </div>
              {order.map((s, i) => {
                const st = data.settlements[s.id];
                const dr = data.drafts[s.id];
                return (
                  <button className={`chapter ${curId === s.id ? 'selected' : ''}`} onClick={() => setActive(s.id)} key={s.id}>
                    <div className="date">
                      <b>{new Date(s.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</b>
                      <small>{new Date(s.date).getFullYear()}</small>
                    </div>
                    <div className="line"><span style={{ background: st ? s.color : '#f7f5f0' }} />{i < order.length - 1 && <i />}</div>
                    <div className="chapter-copy">
                      <div className="tag-row">
                        <div className="tag">{s.tag}</div>
                        {st && <span className="chip frozen">❄ 已结算 {st.pool} XP · ★{data.characters.find((c) => c.id === st.mvpId)?.name}</span>}
                        {dr && <span className="chip draft">⚠ 草稿{dr.errors?.length ? ` · ${dr.errors.length} 项冲突` : ''}</span>}
                      </div>
                      <h3>{s.title}</h3>
                      <p>{s.summary}</p>
                    </div>
                    <span className="arrow">↗</span>
                  </button>
                );
              })}
            </section>

            <section className="detail-panel">
              <div className="detail-cover" style={{ background: cur?.color }}>
                <span>CHAPTER {String(chapterNo).padStart(2, '0')}</span><i>✦</i>
              </div>
              <div className="detail-body">
                <span className="tag">{cur?.tag}</span>
                <h2>{cur?.title}</h2>
                <p>{cur?.summary}</p>
                <div className="meta-grid">
                  <div><small>游戏日期</small><strong>{cur?.date}</strong></div>
                  <div><small>状态</small>
                    <strong>{settlement ? '已结算 · 已冻结' : draft ? '草稿待处理' : '未结算'}</strong>
                  </div>
                </div>

                {cur && !settlement && !draft && (
                  <div className="note"><span>✎</span><div><strong>经验结算</strong>
                    <p>登记本章经验池、出场角色与一名本场最佳；基础份额均分，余数按角色顺序分配。</p></div></div>
                )}

                {cur && settlement && (
                  <SettlementView key={settlement.settledAt} settlement={settlement} characters={data.characters}
                    levelUps={derived.levelUpsByChapter[curId]}
                    revisions={revisionsByChapter[curId]}
                    onConfirmLevel={(cid, lv) => {
                      const c = data.characters.find((x) => x.id === cid);
                      confirmLevel(cid, c?.name, lv);
                    }} />
                )}

                {cur && (
                  <SettlementForm
                    key={settlement ? settlement.settledAt : `open-${cur.id}`}
                    session={cur} characters={data.characters}
                    draft={draft} frozen={Boolean(settlement)} backfill={backfill}
                    settleErrors={settleErrors?.sessionId === cur.id ? settleErrors : null}
                    onSettle={settle}
                    onSaveDraft={saveDraft}
                    onDeleteDraft={deleteDraft}
                  />
                )}
              </div>
            </section>
          </div>
        )}

        {tab === 'characters' && (
          <CharacterXP characters={data.characters} levels={derived.levels}
            onConfirm={(id, name, lv) => confirmLevel(id, name, lv)} />
        )}

        {tab === 'places' && (
          <section className="empty">
            <div>⌖</div><h2>地点图鉴</h2>
            <p>从章节笔记中收集地点。当前已记录灰港、雾林和失落钟楼。</p>
            <div className="place-list">
              <span>01　灰港 <b>已探索</b></span>
              <span>02　失落钟楼 <b>已探索</b></span>
              <span>03　雾林 <b>待探索</b></span>
            </div>
          </section>
        )}
        {tab === 'loot' && (
          <section className="empty">
            <div>◇</div><h2>战利品清单</h2><p>追踪旅途中获得的装备、遗物和金币。</p>
            <div className="place-list">
              <span>月光草 × 3 <b>消耗品</b></span>
              <span>古老铜币 × 1 <b>遗物</b></span>
              <span>灰港守卫徽章 × 2 <b>任务物品</b></span>
            </div>
          </section>
        )}
      </main>

      {show && (
        <div className="modal-bg">
          <div className="modal">
            <button className="close" onClick={() => setShow(false)}>×</button>
            <span className="crumb">NEW CHAPTER</span><h2>记录新的章节</h2>
            <label>章节标题<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例：第三章：月下集市" /></label>
            <label>游戏日期<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <label>章节摘要<textarea rows="3" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="发生了什么？" /></label>
            <label>章节类型<select value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })}><option>主线</option><option>支线</option><option>番外</option></select></label>
            <button className="primary full" onClick={add}>保存章节</button>
          </div>
        </div>
      )}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
