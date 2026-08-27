'use strict';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const FLOWS = [
  { id: 'search', label: '搜索' },
  { id: 'info', label: '详情' },
  { id: 'chapter', label: '章节' },
  { id: 'images', label: '图片' },
  { id: 'category', label: '分类' },
  { id: 'login', label: '登录' },
  { id: 'custom', label: '直接调用' },
];

const CUSTOM_METHODS = [
  'getSearchRequest', 'parseSearch',
  'getInfoRequest', 'parseInfo',
  'getChapterRequest', 'parseChapter',
  'getImagesRequest', 'parseImages',
  'getLazyRequest', 'parseLazy',
  'getCheckRequest', 'parseCheck',
  'getCategories', 'getCategoryRequest', 'parseCategory',
  'getUrl', 'getHeader',
  'login', 'getLoginState', 'logout', 'getSettings', 'onSettingsAction',
];

const FLOW_FIELDS = {
  search: [
    { k: 'keyword', label: '关键词', type: 'text', def: '海贼王' },
    { k: 'page', label: '页码', type: 'number', def: 1 },
  ],
  info: [
    { k: 'cid', label: '漫画 cid', type: 'text', def: '' },
  ],
  chapter: [
    { k: 'cid', label: '漫画 cid', type: 'text', def: '' },
    { k: 'comicJson', label: 'comicJson（可选，JSON 字符串）', type: 'text', def: '{}' },
  ],
  images: [
    { k: 'cid', label: '漫画 cid', type: 'text', def: '' },
    { k: 'path', label: '章节 path', type: 'text', def: '' },
  ],
  category: [
    { k: 'format', label: 'format（留空自动用 getCategories）', type: 'text', def: '' },
    { k: 'page', label: '页码', type: 'number', def: 1 },
  ],
  login: [
    { k: 'account', label: '账号', type: 'text', def: '' },
    { k: 'password', label: '密码', type: 'password', def: '' },
  ],
  custom: [],
};

let SOURCES = [];
let currentFlow = 'search';
let inputValues = {};

async function loadSources() {
  const res = await fetch('/api/sources');
  SOURCES = await res.json();
  const sel = $('#source');
  sel.innerHTML = '';
  SOURCES.forEach((s) => {
    const opt = el('option');
    opt.value = s.url;
    opt.textContent = `${s.title} (type=${s.type})`;
    sel.appendChild(opt);
  });
  if (SOURCES.length) {
    sel.value = SOURCES[0].url;
    // 优先选中当前编辑的热辣漫画源
    const hot = SOURCES.find((s) => s.url.includes('hotmanga'));
    if (hot) sel.value = hot.url;
  }
  renderTabs();
  renderForm();
}

function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  FLOWS.forEach((f) => {
    const b = el('button', 'tab' + (f.id === currentFlow ? ' active' : ''), f.label);
    b.onclick = () => { currentFlow = f.id; renderTabs(); renderForm(); };
    tabs.appendChild(b);
  });
}

function renderForm() {
  const form = $('#form');
  form.innerHTML = '';
  inputValues = {};
  if (currentFlow === 'custom') {
    // 方法选择 + JSON 参数
    const mSel = el('select');
    CUSTOM_METHODS.forEach((m) => {
      const o = el('option');
      o.value = m; o.textContent = m;
      mSel.appendChild(o);
    });
    mSel.value = 'getSearchRequest';
    const row = el('div', 'field');
    row.appendChild(el('label', '方法'));
    row.appendChild(mSel);
    form.appendChild(row);

    const ta = el('textarea', 'argbox');
    ta.placeholder = 'JSON 数组参数，例如：\n["海贼王", 1]';
    ta.value = '["海贼王", 1]';
    const row2 = el('div', 'field');
    row2.appendChild(el('label', '参数（JSON 数组）'));
    row2.appendChild(ta);
    form.appendChild(row2);
    inputValues._method = mSel;
    inputValues._args = ta;
    return;
  }
  (FLOW_FIELDS[currentFlow] || []).forEach((f) => {
    const row = el('div', 'field');
    row.appendChild(el('label', f.label));
    const inp = el('input');
    inp.type = f.type;
    if (f.def !== undefined) inp.value = f.def;
    inp.dataset.key = f.k;
    row.appendChild(inp);
    form.appendChild(row);
  });
}

function collectParams() {
  const params = {};
  $('#form').querySelectorAll('input[data-key]').forEach((i) => {
    params[i.dataset.key] = i.type === 'number' ? Number(i.value) : i.value;
  });
  return params;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s, n) {
  if (typeof s !== 'string') return s;
  return s.length <= n ? s : s.slice(0, n) + '\n…（截断，共 ' + s.length + ' 字符）';
}

function renderValue(label, val, expandable) {
  const wrap = el('div', 'value');
  wrap.appendChild(el('div', 'value-label', label));
  const pre = el('pre', 'json');
  pre.textContent = pretty(val);
  if (expandable) pre.classList.add('expandable');
  wrap.appendChild(pre);
  return wrap;
}

function pretty(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
}

function renderStep(step) {
  const card = el('div', 'card');
  const head = el('div', 'card-head');
  head.appendChild(el('span', 'step', step.step));
  const badge = el('span', 'badge ' + (step.ok ? 'ok' : 'err'), step.ok ? 'OK' : '失败');
  head.appendChild(badge);
  card.appendChild(head);

  if (step.error) {
    card.appendChild(el('div', 'errmsg', step.error));
    if (step.stack) card.appendChild(el('pre', 'stack', truncate(step.stack, 1500)));
  }
  if ('result' in step && step.result !== undefined) {
    const isBody = step.step === 'fetch';
    card.appendChild(renderValue(isBody ? '响应' : '结果', step.result, true));
  }
  if (step.meta) {
    card.appendChild(renderValue('元数据', step.meta));
  }
  if (step.logs && step.logs.length) {
    const logWrap = el('details', 'logwrap');
    logWrap.appendChild(el('summary', '日志 (' + step.logs.length + ')'));
    const pre = el('pre', 'json');
    pre.textContent = step.logs.join('\n');
    logWrap.appendChild(pre);
    card.appendChild(logWrap);
  }
  return card;
}

function renderResult(data) {
  const box = $('#results');
  box.innerHTML = '';
  if (!data.ok) {
    const card = el('div', 'card');
    card.appendChild(el('div', 'errmsg', data.error || '未知错误'));
    box.appendChild(card);
    return;
  }
  if (data.steps && data.steps.length) {
    data.steps.forEach((s) => box.appendChild(renderStep(s)));
  } else {
    box.appendChild(renderStep({ step: '结果', ok: true, result: data.result }));
  }
  box.scrollTop = 0;
}

function setDlogs(msgs) {
  $('#dlogs').textContent = (msgs || []).join('\n') || '（无）';
}

async function run() {
  const sourceFile = $('#source').value;
  if (!sourceFile) return;
  $('#run').disabled = true;
  $('#run').textContent = '⏳ 运行中…';
  setDlogs([]);
  try {
    let payload;
    if (currentFlow === 'custom') {
      const method = inputValues._method ? inputValues._method.value : 'getSearchRequest';
      let args = [];
      try { args = JSON.parse(inputValues._args ? inputValues._args.value : '[]'); }
      catch (e) {
        $('#runHint').textContent = '参数不是合法 JSON 数组：' + e.message;
        return;
      }
      payload = { sourceFile, flow: 'custom', params: { method, args } };
    } else {
      payload = { sourceFile, flow: currentFlow, params: collectParams() };
    }
    const res = await fetch('/api/flow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    $('#runHint').textContent = '';
    renderResult(data);
    // 收集各步日志
    const logs = [];
    (data.steps || []).forEach((s) => { (s.logs || []).forEach((l) => logs.push(l)); });
    setDlogs(logs);
  } catch (e) {
    $('#runHint').textContent = '请求失败：' + e.message;
  } finally {
    $('#run').disabled = false;
    $('#run').textContent = '▶ 运行';
  }
}

async function viewSource() {
  const sourceFile = $('#source').value;
  if (!sourceFile) return;
  try {
    const res = await fetch('/api/script?file=' + encodeURIComponent(sourceFile));
    const txt = await res.text();
    $('#sourceCode').textContent = txt;
    $('#sourceModal').showModal();
  } catch (e) {
    alert('加载源码失败：' + e.message);
  }
}

$('#run').addEventListener('click', run);
$('#refresh').addEventListener('click', loadSources);
$('#viewSource').addEventListener('click', viewSource);
$('#closeModal').addEventListener('click', () => $('#sourceModal').close());
$('#sourceModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) $('#sourceModal').close();
});
// 回车触发运行
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'password') run();
});

loadSources();
