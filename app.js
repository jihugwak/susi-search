/* 수시 입결 검색 — 정적 SPA. 모든 필터·정렬·판정은 브라우저에서 수행된다. */
(function () {
  'use strict';
  const RAW = window.ADIGA_DATA;
  const D = RAW.dicts, C = RAW.cols, N = RAW.n;

  // '서울15'는 원본 오입력 → '서울'로 정규화
  const regionNames = D['지역'].map(s => (s === '서울15' ? '서울' : s));

  // 행 단위 뷰 (인덱스 배열로만 다룬다)
  const univ = C['대학'], region = C['지역'], year = C['연도'], method = C['교과/종합'],
        adm = C['전형'], dept = C['학과'], track = C['인문/자연'], cat = C['소계열'],
        seats = C['모집인원'], comp = C['경쟁률'], chuhap = C['추합'],
        g50 = C['등급50'], g70 = C['등급70'], v50 = C['변환50'], realComp = C['실경쟁률'];

  // 원본에 미발표 데이터가 0으로 기재된 행 정규화(주로 2026학년도).
  // 등급·변환점수·경쟁률·모집인원 0은 실존할 수 없는 값이므로 결측으로 취급한다.
  for (let i = 0; i < N; i++) {
    if (g50[i] === 0) g50[i] = null;
    if (g70[i] === 0) g70[i] = null;
    if (v50[i] === 0) v50[i] = null;
    if (comp[i] === 0 && g50[i] == null && g70[i] == null) { comp[i] = null; realComp[i] = null; }
    if (seats[i] === 0) seats[i] = null;
    // 완전 미발표 행(등급·경쟁률 모두 없음)의 추합 0도 의미가 없다
    if (chuhap[i] === 0 && comp[i] == null && g50[i] == null && g70[i] == null) chuhap[i] = null;
  }

  // 검색용 소문자 문자열 사전
  const univL = D['대학'].map(s => s.toLowerCase());
  const admL = D['전형'].map(s => s.toLowerCase());
  const deptL = D['학과'].map(s => s.toLowerCase());

  // ---- 필터 UI 채우기 ----
  const $ = id => document.getElementById(id);
  const els = {
    qUniv: $('qUniv'), qDept: $('qDept'), qAdm: $('qAdm'),
    sugUniv: $('sugUniv'), sugDept: $('sugDept'), sugAdm: $('sugAdm'),
    year: $('fYear'), region: $('fRegion'), method: $('fMethod'),
    track: $('fTrack'), cat: $('fCat'), grade: $('myGrade'),
    chips: $('judgeChips'), count: $('count'), scope: $('scope'),
    thead: $('theadRow'), tbody: $('tbody'), empty: $('empty'), more: $('moreBtn'),
    dlg: $('detail'), dTitle: $('dTitle'), dSub: $('dSub'), dBody: $('dBody'), dClose: $('dClose'),
  };

  function fillSelect(sel, items) {
    for (const [val, label] of items) {
      const o = document.createElement('option');
      o.value = val; o.textContent = label;
      sel.appendChild(o);
    }
  }
  const uniqYears = [...new Set(year)].sort((a, b) => b - a);
  fillSelect(els.year, uniqYears.map(y => [y, y + '학년도']));
  const uniqRegions = [...new Set(regionNames)].sort((a, b) => a.localeCompare(b, 'ko'));
  fillSelect(els.region, uniqRegions.map(r => [r, r]));
  fillSelect(els.method, D['교과/종합'].map((m, i) => [i, m]));
  fillSelect(els.track, D['인문/자연'].map((t, i) => [i, t]).filter(([, t]) => t));
  const catSorted = D['소계열'].map((c2, i) => [i, c2])
    .filter(([, c2]) => c2 && c2 !== '0.0')
    .sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  fillSelect(els.cat, catSorted);

  // ---- 판정 ----
  // 내 등급 g(낮을수록 우수), 컷은 70%컷 우선(없으면 50%컷).
  // g <= 컷-0.25 → 안정 / g <= 컷+0.25 → 적정 / g <= 컷+0.8 → 도전 / 그 외 → 어려움
  function judge(i, g) {
    const cut = g70[i] != null ? g70[i] : g50[i];
    if (cut == null) return null;
    if (g <= cut - 0.25) return '안정';
    if (g <= cut + 0.25) return '적정';
    if (g <= cut + 0.8) return '도전';
    return '어려움';
  }
  // 컷 − 내 등급 차이 표시 (+면 내 등급이 컷보다 여유, −면 부족)
  function deltaHtml(cut) {
    if (cut == null || state.grade == null) return '';
    const d2 = cut - state.grade;
    const cls = d2 > 0.005 ? 'plus' : d2 < -0.005 ? 'minus' : 'zero';
    return `<span class="delta ${cls}">${(d2 >= 0 ? '+' : '') + d2.toFixed(2)}</span>`;
  }

  // ---- 상태 ----
  const state = {
    qUniv: '', qDept: '', qAdm: '',
    year: '', region: '', method: '', track: '', cat: '',
    grade: null, judges: new Set(),
    sortKey: 'g50', sortDir: 1, shown: 300,
  };

  // 검색 필드 메타: 상태키 → 사전/코드배열. 입력값이 사전 항목과 완전히 일치하면
  // (자동완성에서 선택한 경우) 부분일치가 아니라 정확일치로 거른다.
  const FIELDS = {
    qUniv: { names: D['대학'], lower: univL, codes: univ, exact: new Set(univL) },
    qDept: { names: D['학과'], lower: deptL, codes: dept, exact: new Set(deptL) },
    qAdm:  { names: D['전형'], lower: admL,  codes: adm,  exact: new Set(admL) },
  };
  function fieldPred(key) {
    const q = state[key].trim().toLowerCase();
    if (!q) return null;
    const f = FIELDS[key];
    if (f.exact.has(q)) return c2 => f.lower[c2] === q;
    const toks = q.split(/\s+/);
    return c2 => matchAll(f.lower[c2], toks);
  }

  const COLS = [
    { key: 'year',  label: '학년도', num: true,  get: i => year[i] },
    { key: 'region',label: '지역',   num: false, get: i => regionNames[region[i]] },
    { key: 'univ',  label: '대학',   num: false, get: i => D['대학'][univ[i]] },
    { key: 'method',label: '유형',   num: false, get: i => method[i] },
    { key: 'adm',   label: '전형',   num: false, get: i => D['전형'][adm[i]] },
    { key: 'dept',  label: '학과',   num: false, get: i => D['학과'][dept[i]] },
    { key: 'track', label: '계열',   num: false, get: i => D['인문/자연'][track[i]] },
    { key: 'seats', label: '모집',   num: true,  get: i => seats[i] },
    { key: 'comp',  label: '경쟁률', num: true,  get: i => comp[i] },
    { key: 'chuhap',label: '추합',   num: true,  get: i => chuhap[i] },
    { key: 'g50',   label: '등급50%',num: true,  get: i => g50[i] },
    { key: 'g70',   label: '등급70%',num: true,  get: i => g70[i] },
  ];

  // ---- 필터링 ----
  function tokenize(q) {
    return q.toLowerCase().split(/\s+/).filter(Boolean);
  }
  function matchAll(hay, toks) {
    for (const t of toks) if (!hay.includes(t)) return false;
    return true;
  }
  // skipKey: 해당 검색 필드는 무시하고 거른다(자동완성 제안 계산용)
  function runFilter(skipKey) {
    const pU = skipKey === 'qUniv' ? null : fieldPred('qUniv');
    const pD = skipKey === 'qDept' ? null : fieldPred('qDept');
    const pA = skipKey === 'qAdm' ? null : fieldPred('qAdm');
    const wantYear = state.year === '' ? null : +state.year;
    const wantRegion = state.region === '' ? null : state.region;
    const wantMethod = state.method === '' ? null : +state.method;
    const wantTrack = state.track === '' ? null : +state.track;
    const wantCat = state.cat === '' ? null : +state.cat;
    const g = state.grade;
    // 등급만 입력하면 전체를 보여주되 판정·± 표시만 붙인다.
    // 칩(안정/적정/도전)을 누르면 그 판정에 해당하는 행만 남긴다.
    const useJudge = g != null && state.judges.size > 0;

    const out = [];
    for (let i = 0; i < N; i++) {
      if (wantYear !== null && year[i] !== wantYear) continue;
      if (wantRegion !== null && regionNames[region[i]] !== wantRegion) continue;
      if (wantMethod !== null && method[i] !== wantMethod) continue;
      if (wantTrack !== null && track[i] !== wantTrack) continue;
      if (wantCat !== null && cat[i] !== wantCat) continue;
      if (pU && !pU(univ[i])) continue;
      if (pD && !pD(dept[i])) continue;
      if (pA && !pA(adm[i])) continue;
      if (useJudge) {
        const j = judge(i, g);
        if (j === null || !state.judges.has(j)) continue;
      }
      out.push(i);
    }
    return out;
  }

  function runSort(idx) {
    const col = COLS.find(c => c.key === state.sortKey);
    if (!col) return idx;
    const get = col.get, dir = state.sortDir, isNum = col.num;
    idx.sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;            // null은 항상 뒤로
      if (vb == null) return -1;
      if (isNum) return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'ko') * dir;
    });
    return idx;
  }

  // ---- 렌더링 ----
  function esc(s) {
    return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }
  function fmt(v, dp) {
    if (v == null) return '<span style="color:var(--muted)">–</span>';
    return dp != null ? v.toFixed(dp) : String(v);
  }

  function renderHead() {
    const showJudge = state.grade != null;
    let h = '';
    for (const c of COLS) {
      const arrow = state.sortKey === c.key ? `<span class="arrow">${state.sortDir === 1 ? '▲' : '▼'}</span>` : '';
      h += `<th class="${c.num ? 'num' : ''}" data-sort="${c.key}">${c.label} ${arrow}</th>`;
    }
    if (showJudge) h += '<th>판정</th>';
    els.thead.innerHTML = h;
  }

  let current = [];
  function renderBody() {
    const showJudge = state.grade != null;
    const rows = current.slice(0, state.shown);
    let html = '';
    for (const i of rows) {
      const m = method[i], mName = D['교과/종합'][m];
      html += `<tr data-i="${i}">`
        + `<td class="num">${year[i]}</td>`
        + `<td>${esc(regionNames[region[i]])}</td>`
        + `<td><b>${esc(D['대학'][univ[i]])}</b></td>`
        + `<td><span class="badge b-${esc(mName)}">${esc(mName)}</span></td>`
        + `<td>${esc(D['전형'][adm[i]])}</td>`
        + `<td>${esc(D['학과'][dept[i]])}</td>`
        + `<td>${esc(D['인문/자연'][track[i]] || '–')}</td>`
        + `<td class="num">${fmt(seats[i])}</td>`
        + `<td class="num">${fmt(comp[i], 2)}</td>`
        + `<td class="num">${fmt(chuhap[i])}</td>`
        + `<td class="num"><b>${fmt(g50[i], 2)}</b>${deltaHtml(g50[i])}</td>`
        + `<td class="num">${fmt(g70[i], 2)}${deltaHtml(g70[i])}</td>`;
      if (showJudge) {
        const j = judge(i, state.grade);
        html += `<td>${j ? `<span class="judge j-${j}">${j}</span>` : ''}</td>`;
      }
      html += '</tr>';
    }
    els.tbody.innerHTML = html;
    els.empty.hidden = current.length > 0;
    els.more.hidden = current.length <= state.shown;
    els.count.textContent = current.length.toLocaleString('ko-KR');
    const parts = [];
    if (state.year) parts.push(state.year + '학년도');
    if (state.region) parts.push(state.region);
    if (state.method !== '') parts.push(D['교과/종합'][+state.method]);
    for (const q of [state.qUniv, state.qDept, state.qAdm]) if (q) parts.push(`"${q}"`);
    els.scope.textContent = parts.length ? parts.join(' · ') : '전체 조건';
  }

  function refresh() {
    current = runSort(runFilter());
    state.shown = 300;
    renderHead();
    renderBody();
  }

  // ---- 상세(연도별 추이) ----
  function openDetail(i) {
    const u = univ[i], a = adm[i], d2 = dept[i];
    const hits = [];
    for (let k = 0; k < N; k++) {
      if (univ[k] === u && adm[k] === a && dept[k] === d2) hits.push(k);
    }
    hits.sort((x, y2) => year[x] - year[y2]);
    els.dTitle.textContent = `${D['대학'][u]} ${D['학과'][d2]}`;
    els.dSub.textContent = `${D['전형'][a]} · ${regionNames[region[i]]} · ${D['인문/자연'][track[i]] || ''}`;
    let html = '';
    for (const k of hits) {
      html += `<tr>`
        + `<td><b>${year[k]}</b></td>`
        + `<td class="num">${fmt(seats[k])}</td>`
        + `<td class="num">${fmt(comp[k], 2)}</td>`
        + `<td class="num">${fmt(chuhap[k])}</td>`
        + `<td class="num"><b>${fmt(g50[k], 2)}</b></td>`
        + `<td class="num">${fmt(g70[k], 2)}</td>`
        + `<td class="num">${fmt(v50[k], 1)}</td>`
        + `<td class="num">${fmt(realComp[k], 2)}</td>`
        + `</tr>`;
    }
    els.dBody.innerHTML = html;
    els.dlg.showModal();
  }

  // ---- 자동완성 ----
  // 입력 중 관련 검색어를 드롭다운으로 보여준다. 후보와 건수는 현재 걸려 있는
  // 다른 조건(다른 검색어·필터) 안에서 계산하므로 0건이 되는 조합은 제안되지 않는다.
  // 앞글자 일치 > 포함 일치 순, 같은 급이면 건수 많은 순.
  function suggest(stateKey, toks) {
    if (!toks.length) return [];
    const f = FIELDS[stateKey];
    const idx = runFilter(stateKey);
    const counts = new Map();
    for (const i of idx) {
      const c2 = f.codes[i];
      counts.set(c2, (counts.get(c2) || 0) + 1);
    }
    const first = toks[0];
    const starts = [], contains = [];
    for (const c2 of counts.keys()) {
      const nm = f.names[c2];
      if (!nm) continue;
      const lo = f.lower[c2];
      if (!matchAll(lo, toks)) continue;
      (lo.startsWith(first) ? starts : contains).push(c2);
    }
    const byCount = (a, b2) => counts.get(b2) - counts.get(a);
    starts.sort(byCount); contains.sort(byCount);
    return starts.concat(contains).slice(0, 12).map(c2 => [f.names[c2], counts.get(c2)]);
  }

  function bindAutocomplete(input, box, stateKey) {
    let active = -1;

    function hide() {
      box.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }
    function apply(value) {
      input.value = value;
      state[stateKey] = value;
      hide();
      refresh();
    }
    function render() {
      const toks = tokenize(input.value.trim());
      const hits = suggest(stateKey, toks);
      if (!hits.length) { hide(); return; }
      const first = toks[0] || '';
      let html = '';
      for (const [nm, cnt] of hits) {
        const lo = nm.toLowerCase();
        const at = lo.indexOf(first);
        const label = at >= 0 && first
          ? esc(nm.slice(0, at)) + '<mark>' + esc(nm.slice(at, at + first.length)) + '</mark>' + esc(nm.slice(at + first.length))
          : esc(nm);
        html += `<button type="button" data-v="${esc(nm)}"><span class="nm">${label}</span><span class="cnt">${cnt.toLocaleString('ko-KR')}건</span></button>`;
      }
      box.innerHTML = html;
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    }

    let deb;
    input.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => {
        state[stateKey] = input.value.trim();
        render();
        refresh();
      }, 120);
    });
    input.addEventListener('keydown', e => {
      const btns = box.hidden ? [] : [...box.querySelectorAll('button')];
      if (e.key === 'ArrowDown' && btns.length) {
        e.preventDefault();
        active = (active + 1) % btns.length;
      } else if (e.key === 'ArrowUp' && btns.length) {
        e.preventDefault();
        active = (active - 1 + btns.length) % btns.length;
      } else if (e.key === 'Enter') {
        if (active >= 0 && btns[active]) { e.preventDefault(); apply(btns[active].dataset.v); }
        else hide();
        return;
      } else if (e.key === 'Escape') { hide(); return; }
      else return;
      btns.forEach((b2, k) => b2.classList.toggle('active', k === active));
      if (btns[active]) btns[active].scrollIntoView({ block: 'nearest' });
    });
    // mousedown: blur보다 먼저 실행되어 클릭 선택이 유실되지 않게 한다
    box.addEventListener('mousedown', e => {
      const b2 = e.target.closest('button[data-v]');
      if (b2) { e.preventDefault(); apply(b2.dataset.v); }
    });
    input.addEventListener('blur', () => setTimeout(hide, 120));
    input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  }

  bindAutocomplete(els.qUniv, els.sugUniv, 'qUniv');
  bindAutocomplete(els.qDept, els.sugDept, 'qDept');
  bindAutocomplete(els.qAdm, els.sugAdm, 'qAdm');

  // ---- 이벤트 ----
  for (const [el, key] of [[els.year, 'year'], [els.region, 'region'], [els.method, 'method'], [els.track, 'track'], [els.cat, 'cat']]) {
    el.addEventListener('change', () => { state[key] = el.value; refresh(); });
  }
  els.grade.addEventListener('input', () => {
    const v = parseFloat(els.grade.value);
    state.grade = Number.isFinite(v) && v >= 1 && v <= 9 ? v : null;
    els.chips.hidden = state.grade == null;
    if (state.grade == null) {
      state.judges.clear();
      for (const b2 of els.chips.querySelectorAll('.chip')) b2.setAttribute('aria-pressed', 'false');
    }
    refresh();
  });
  els.chips.addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const j = b.dataset.j;
    if (state.judges.has(j)) { state.judges.delete(j); b.setAttribute('aria-pressed', 'false'); }
    else { state.judges.add(j); b.setAttribute('aria-pressed', 'true'); }
    refresh();
  });
  els.thead.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (state.sortKey === key) state.sortDir *= -1;
    else { state.sortKey = key; state.sortDir = 1; }
    current = runSort(current);
    renderHead();
    renderBody();
  });
  els.tbody.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-i]');
    if (tr) openDetail(+tr.dataset.i);
  });
  els.more.addEventListener('click', () => { state.shown += 300; renderBody(); });
  els.dClose.addEventListener('click', () => els.dlg.close());
  els.dlg.addEventListener('click', e => { if (e.target === els.dlg) els.dlg.close(); });

  document.getElementById('statTotal').textContent =
    `· ${D['대학'].length}개 대학 · ${N.toLocaleString('ko-KR')}건`;

  refresh();
})();
