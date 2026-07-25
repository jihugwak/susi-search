/* 수시 입결 검색 — 정적 SPA.
   원본(대학어디가 발표자료 정리본)의 시트별 기능을 탭으로 옮겨 담았다.
     검색        ← 대학자료
     대학 분석    ← NEW대학분석 + 수시분석시트(그래프)
     집계·연도비교 ← 연도비교 피벗
     등급 변환    ← 자체등급변환
     대학 링크    ← 대학링크
   모든 필터·집계·판정은 브라우저에서 수행된다. */
(function () {
  'use strict';
  const RAW = window.ADIGA_DATA, LINKS = window.ADIGA_LINKS || {};
  // 자체등급변환 표: 원본의 5등급 열은 백분위 약 90 아래 구간에서 수식이 깨져
  // 8542.5 같은 값이 들어 있다. 9등급 열도 백분위 3.9 이하에서 9.0011로 범위를 넘는다.
  // 두 열 모두 등급 범위를 벗어난 값은 결측으로 버린다.
  const GRADE = (window.ADIGA_GRADE || []).map(([p, g9, g5]) =>
    [p, (g9 >= 1 && g9 <= 9) ? g9 : null, (g5 >= 1 && g5 <= 5) ? g5 : null]);
  // 위(백분위 100)에서부터 값이 성한 구간까지만 신뢰한다. 그 아래는 산발적으로
  // 값이 남아 있어도 깨진 수식의 잔재이므로 함께 버린다.
  function trimTail(col) {
    let end = 0;
    while (end < GRADE.length && GRADE[end][col] != null) end++;
    for (let k = end; k < GRADE.length; k++) GRADE[k][col] = null;
    return end ? GRADE[end - 1][0] : null;   // 유효한 최저 백분위
  }
  const G9_MIN = trimTail(1), G5_MIN = trimTail(2);
  const D = RAW.dicts, C = RAW.cols, N = RAW.n;

  const univ = C['대학'], region = C['지역'], year = C['연도'], method = C['교과/종합'],
        adm = C['전형'], dept = C['학과'], track = C['인문/자연'], cat = C['소계열'],
        seats = C['모집인원'], comp = C['경쟁률'], chuhap = C['추합'],
        g50 = C['등급50'], g70 = C['등급70'], v50 = C['변환50'], v70 = C['변환70'],
        vmax = C['만점'], applied = C['총지원지원'], passed = C['합격인원'], realComp = C['실경쟁률'];

  // 원본 소계열 열에는 미분류 행이 빈칸과 '0.0' 두 가지로 섞여 있다. 하나로 합쳐
  // 필터 목록과 집계 그룹에서 똑같이 빠지게 한다.
  D['소계열'] = D['소계열'].map(s => (s === '0.0' ? '' : s));

  // 원본에 미발표 데이터가 0으로 기재된 행 정규화(주로 2026학년도).
  // 등급·변환점수·경쟁률·모집인원 0은 실존할 수 없는 값이므로 결측으로 취급한다.
  for (let i = 0; i < N; i++) {
    for (const a of [g50, g70, v50, v70, vmax, applied, passed]) if (a[i] === 0) a[i] = null;
    if (comp[i] === 0 && g50[i] == null && g70[i] == null) { comp[i] = null; realComp[i] = null; }
    if (realComp[i] === 0) realComp[i] = null;
    if (seats[i] === 0) seats[i] = null;
    if (chuhap[i] === 0 && comp[i] == null && g50[i] == null && g70[i] == null) chuhap[i] = null;

    // 원본 변환점수 열에 9999가 결측 표시로 들어간 행이 있다(전주대 2025).
    if (v50[i] === 9999) v50[i] = null;
    if (v70[i] === 9999) v70[i] = null;
    // 원본 만점 열이 깨진 행이 있다(신라대 2023 만점 6.3, 경기대 2023 만점 9 등).
    // 변환점수가 만점을 5% 넘게 웃돌면 만점 쪽을 못 믿는다 → 환산백분위를 비운다.
    // 5% 이내 초과는 가산점·반올림으로 설명되므로 그대로 둔다.
    const hi = Math.max(v50[i] != null ? v50[i] : -Infinity, v70[i] != null ? v70[i] : -Infinity);
    if (vmax[i] != null && hi > vmax[i] * 1.05) vmax[i] = null;
  }
  // 변환점수를 만점 대비 백분위로 환산(원본 수시분석시트의 '단순백분위')
  function pctScore(i) {
    return v50[i] != null && vmax[i] ? (v50[i] / vmax[i]) * 100 : null;
  }

  const univL = D['대학'].map(s => s.toLowerCase());
  const admL = D['전형'].map(s => s.toLowerCase());
  const deptL = D['학과'].map(s => s.toLowerCase());
  const YEARS = [...new Set(year)].sort((a, b) => b - a);   // 최신 → 과거

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const fmt = (v, dp) => v == null ? '<span style="color:var(--muted)">–</span>' : (dp != null ? v.toFixed(dp) : String(v));
  const tokenize = q => q.toLowerCase().split(/\s+/).filter(Boolean);
  const matchAll = (hay, toks) => toks.every(t => hay.includes(t));

  /* ================= 차트 (인라인 SVG, 외부 의존성 없음) ================= */
  const SERIES_VARS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
  const tip = $('tip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(x + 12, window.innerWidth - r.width - 8) + 'px';
    tip.style.top = Math.max(8, y - r.height - 10) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  // series: [{name, values: Map(year → value)}] · 연도축은 오래된 → 최신
  // invert=true면 값이 작을수록 위(등급용). 마지막 점에 직접 라벨(≤4계열).
  function chart(kind, series, opts) {
    const years = [...YEARS].sort((a, b) => a - b);
    const labelled = kind === 'line' && series.length <= 4;   // 직접 라벨 자리
    const W = 540, H = 250, ml = 46, mr = labelled ? 84 : 20, mt = 14, mb = 30;
    const pw = W - ml - mr, ph = H - mt - mb;
    const vals = [];
    for (const s of series) for (const y of years) { const v = s.values.get(y); if (v != null) vals.push(v); }
    if (!vals.length) return '';
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (kind === 'bar') lo = 0;
    if (hi === lo) { hi += 1; lo = Math.max(0, lo - 1); }
    const pad = (hi - lo) * 0.12;
    lo = kind === 'bar' ? 0 : lo - pad;
    hi = hi + pad;
    const inv = !!opts.invert;
    const py = v => { const t = (v - lo) / (hi - lo); return mt + (inv ? t : 1 - t) * ph; };
    // 연도는 각 슬롯의 중앙에 놓는다 — 막대가 y축 눈금 라벨을 덮지 않게.
    const slotW = pw / years.length;
    const px = y => ml + (years.indexOf(y) + 0.5) * slotW;
    const dp = opts.dp != null ? opts.dp : 2;

    let g = '';
    // 눈금 5개 + 하치라인
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * (k / 4), y = py(v);
      g += `<line x1="${ml}" y1="${y.toFixed(1)}" x2="${W - mr}" y2="${y.toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>`
        + `<text x="${ml - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--ink-muted)" font-variant-numeric="tabular-nums">${v.toFixed(dp === 0 ? 0 : 1)}</text>`;
    }
    for (const y of years) {
      g += `<text x="${px(y).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11.5" fill="var(--ink-muted)">${y}</text>`;
    }
    g += `<line x1="${ml}" y1="${mt + ph}" x2="${W - mr}" y2="${mt + ph}" stroke="var(--axis)" stroke-width="1"/>`;

    if (kind === 'line') {
      const labels = [];
      series.forEach((s, si) => {
        const col = `var(${SERIES_VARS[si % 8]})`;
        const pts = years.filter(y => s.values.get(y) != null).map(y => [px(y), py(s.values.get(y))]);
        if (pts.length > 1) {
          g += `<path d="M${pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        }
        for (const p of pts) {
          g += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.5" fill="${col}" stroke="var(--card)" stroke-width="2"/>`;
        }
        // 직접 라벨: 계열이 적을 때만 (색상만으로 식별하지 않게)
        if (labelled && pts.length) {
          const last = pts[pts.length - 1];
          labels.push({ x: last[0] + 9, y: last[1], col, name: s.name.length > 9 ? s.name.slice(0, 8) + '…' : s.name });
        }
      });
      // 라벨이 겹치지 않게 세로로 벌린다
      labels.sort((a, b) => a.y - b.y);
      for (let k = 1; k < labels.length; k++) {
        if (labels[k].y - labels[k - 1].y < 13) labels[k].y = labels[k - 1].y + 13;
      }
      for (const L of labels) {
        g += `<text x="${L.x.toFixed(1)}" y="${(L.y + 4).toFixed(1)}" font-size="11" font-weight="700" fill="${L.col}">${esc(L.name)}</text>`;
      }
    } else {
      const bw = Math.max(4, Math.min(26, (slotW * 0.72) / series.length - 2));
      years.forEach(y => {
        const cx = px(y), total = series.length * (bw + 2) - 2;
        series.forEach((s, si) => {
          const v = s.values.get(y);
          if (v == null) return;
          const col = `var(${SERIES_VARS[si % 8]})`;
          const x = cx - total / 2 + si * (bw + 2);
          const yTop = py(v), h = Math.max(1, mt + ph - yTop), r = Math.min(4, bw / 2, h);
          g += `<path d="M${x.toFixed(1)} ${(mt + ph).toFixed(1)} V${(yTop + r).toFixed(1)} q0 ${-r} ${r} ${-r} h${(bw - 2 * r).toFixed(1)} q${r} 0 ${r} ${r} V${(mt + ph).toFixed(1)} Z" fill="${col}"/>`;
        });
      });
    }
    // 연도별 히트존(호버)
    years.forEach(y => {
      g += `<rect class="hz" data-y="${y}" x="${(px(y) - slotW / 2).toFixed(1)}" y="${mt}" width="${slotW.toFixed(1)}" height="${ph}" fill="transparent"/>`;
    });

    const legend = series.map((s, si) =>
      `<span><i style="background:var(${SERIES_VARS[si % 8]})"></i>${esc(s.name)}</span>`).join('');
    const id = 'c' + Math.random().toString(36).slice(2, 8);
    return `<figure class="chart"><figcaption>${esc(opts.title)}</figcaption><div class="sub">${esc(opts.sub || '')}</div>`
      + `<svg id="${id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title)}">${g}</svg>`
      + (series.length > 1 ? `<div class="legend">${legend}</div>` : '')
      + `</figure>`;
  }

  // 렌더 후 호버 연결 (연도 열 전체 → 계열별 값 툴팁)
  function bindChart(root, series, opts) {
    for (const svg of root.querySelectorAll('svg')) {
      const s = svg._series;
      if (!s) continue;
      svg.addEventListener('mousemove', e => {
        const hz = e.target.closest('.hz');
        if (!hz) { hideTip(); return; }
        const y = +hz.dataset.y;
        const lines = s.series.filter(x => x.values.get(y) != null)
          .map((x, i) => `<span style="color:var(${SERIES_VARS[s.series.indexOf(x) % 8]})">●</span> ${esc(x.name)} <b>${x.values.get(y).toFixed(s.dp)}</b>`);
        if (!lines.length) { hideTip(); return; }
        showTip(`<b>${y}학년도</b><br>${lines.join('<br>')}`, e.clientX, e.clientY);
      });
      svg.addEventListener('mouseleave', hideTip);
    }
  }
  function renderCharts(container, specs) {
    container.innerHTML = specs.map(sp => chart(sp.kind, sp.series, sp)).join('');
    const svgs = container.querySelectorAll('svg');
    specs.forEach((sp, i) => { if (svgs[i]) svgs[i]._series = { series: sp.series, dp: sp.dp != null ? sp.dp : 2 }; });
    bindChart(container);
  }

  /* ================= 공통: 상세 모달 ================= */
  const dlg = $('detail');
  const METRIC = {
    g70: { label: '70%컷', arr: g70, dp: 2, invert: true },
    g50: { label: '50%컷', arr: g50, dp: 2, invert: true },
    seats: { label: '모집인원', arr: seats, dp: 0 },
    comp: { label: '경쟁률', arr: comp, dp: 2 },
    realComp: { label: '실경쟁률', arr: realComp, dp: 2 },
    chuhap: { label: '추합', arr: chuhap, dp: 0 },
  };

  function openDetail(u, d, a) {
    const hits = [];
    for (let k = 0; k < N; k++) {
      if (univ[k] !== u || dept[k] !== d) continue;
      if (a != null && adm[k] !== a) continue;
      hits.push(k);
    }
    hits.sort((x, y2) => year[y2] - year[x] || adm[x] - adm[y2]);
    $('dTitle').textContent = `${D['대학'][u]} ${D['학과'][d]}`;
    const anyRow = hits[0];
    $('dSub').textContent = [a != null ? D['전형'][a] : `전형 ${new Set(hits.map(k => adm[k])).size}개`,
      anyRow != null ? D['지역'][region[anyRow]] : '', anyRow != null ? D['인문/자연'][track[anyRow]] : '']
      .filter(Boolean).join(' · ');

    $('dBody').innerHTML = hits.map(k => `<tr>`
      + `<td><b>${year[k]}</b></td>`
      + `<td>${esc(D['전형'][adm[k]])}</td>`
      + `<td class="num">${fmt(seats[k])}</td>`
      + `<td class="num">${fmt(comp[k], 2)}</td>`
      + `<td class="num">${fmt(realComp[k], 2)}</td>`
      + `<td class="num">${fmt(chuhap[k])}</td>`
      + `<td class="num"><b>${fmt(g50[k], 2)}</b></td>`
      + `<td class="num">${fmt(g70[k], 2)}</td>`
      + `<td class="num">${fmt(v50[k], 1)}</td>`
      + `<td class="num">${fmt(v70[k], 1)}</td>`
      + `<td class="num">${fmt(pctScore(k), 1)}</td>`
      + `</tr>`).join('');

    // 전형별 계열 구성 (모집인원 많은 순 최대 8개)
    const byAdm = new Map();
    for (const k of hits) {
      if (!byAdm.has(adm[k])) byAdm.set(adm[k], []);
      byAdm.get(adm[k]).push(k);
    }
    const admList = [...byAdm.entries()]
      .sort((x, y2) => (y2[1].reduce((s, k) => s + (seats[k] || 0), 0)) - (x[1].reduce((s, k) => s + (seats[k] || 0), 0)))
      .slice(0, 8);
    const mkSeries = arr => admList.map(([ac, ks]) => {
      const m = new Map();
      for (const k of ks) if (arr[k] != null) m.set(year[k], arr[k]);
      return { name: D['전형'][ac], values: m };
    }).filter(s => s.values.size);

    const specs = [];
    const cutS = mkSeries(g70);
    if (cutS.length) specs.push({ kind: 'line', series: cutS, title: '등급 70%컷 추이', sub: '위로 갈수록 높은 등급(숫자가 작음)', invert: true, dp: 2 });
    const compS = mkSeries(comp);
    if (compS.length) specs.push({ kind: 'bar', series: compS, title: '경쟁률 추이', sub: '전형별 지원 경쟁률', dp: 2 });
    renderCharts($('dCharts'), specs);
    dlg.showModal();
  }
  $('dClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', hideTip);

  /* ================= 탭 ================= */
  const panes = { search: $('pane-search'), univ: $('pane-univ'), pivot: $('pane-pivot'), grade: $('pane-grade'), links: $('pane-links'), cal: $('pane-cal'), settings: $('pane-settings') };
  function showTab(name) {
    if (!panes[name]) return;
    for (const btn of document.querySelectorAll('nav.tabs button')) btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== name;
    // 추가 탭은 열릴 때 지연 렌더 (calendar.js / settings.js)
    if (name === 'cal' && window.Calendar) window.Calendar.ensureRendered();
    if (name === 'settings' && window.SettingsTab) window.SettingsTab.ensureRendered();
  }
  document.querySelector('nav.tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    showTab(b.dataset.tab);
    location.hash = b.dataset.tab === 'search' ? '' : '#' + b.dataset.tab;
  });
  // 주소 해시로 탭·대학을 공유할 수 있다: #univ/고려대
  function applyHash() {
    const [tab, arg] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
    if (!tab) return;
    showTab(tab);
    if (tab === 'univ' && arg) selectUniv(arg);
  }

  /* ================= 자동완성 (공용) ================= */
  function bindAutocomplete(input, box, getHits, onPick) {
    let active = -1;
    const hide = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    function render() {
      const toks = tokenize(input.value.trim());
      const hits = getHits(toks);
      if (!hits.length) { hide(); return; }
      const first = toks[0] || '';
      box.innerHTML = hits.map(([nm, cnt]) => {
        const lo = nm.toLowerCase(), at = first ? lo.indexOf(first) : -1;
        const label = at >= 0
          ? esc(nm.slice(0, at)) + '<mark>' + esc(nm.slice(at, at + first.length)) + '</mark>' + esc(nm.slice(at + first.length))
          : esc(nm);
        return `<button type="button" data-v="${esc(nm)}"><span>${label}</span><span class="cnt">${cnt.toLocaleString('ko-KR')}건</span></button>`;
      }).join('');
      box.hidden = false; input.setAttribute('aria-expanded', 'true'); active = -1;
    }
    const apply = v => { input.value = v; hide(); onPick(v); };
    let deb;
    input.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => { render(); onPick(input.value.trim(), true); }, 120);
    });
    input.addEventListener('keydown', e => {
      const btns = box.hidden ? [] : [...box.querySelectorAll('button')];
      if (e.key === 'ArrowDown' && btns.length) { e.preventDefault(); active = (active + 1) % btns.length; }
      else if (e.key === 'ArrowUp' && btns.length) { e.preventDefault(); active = (active - 1 + btns.length) % btns.length; }
      else if (e.key === 'Enter') { if (active >= 0 && btns[active]) { e.preventDefault(); apply(btns[active].dataset.v); } else hide(); return; }
      else if (e.key === 'Escape') { hide(); return; }
      else return;
      btns.forEach((b, k) => b.classList.toggle('active', k === active));
      if (btns[active]) btns[active].scrollIntoView({ block: 'nearest' });
    });
    box.addEventListener('mousedown', e => {
      const b = e.target.closest('button[data-v]');
      if (b) { e.preventDefault(); apply(b.dataset.v); }
    });
    input.addEventListener('blur', () => setTimeout(hide, 120));
    input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  }

  /* ================= 탭 1: 검색 ================= */
  const els = {
    qUniv: $('qUniv'), qDept: $('qDept'), qAdm: $('qAdm'),
    year: $('fYear'), region: $('fRegion'), method: $('fMethod'), track: $('fTrack'), cat: $('fCat'),
    grade: $('myGrade'), chips: $('judgeChips'), count: $('count'), scope: $('scope'),
    thead: $('theadRow'), tbody: $('tbody'), empty: $('empty'), more: $('moreBtn'),
  };
  function fillSelect(sel, items) {
    for (const [val, label] of items) {
      const o = document.createElement('option');
      o.value = val; o.textContent = label;
      sel.appendChild(o);
    }
  }
  fillSelect(els.year, YEARS.map(y => [y, y + '학년도']));
  const regionSorted = D['지역'].map((r, i) => [i, r]).filter(([, r]) => r).sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  fillSelect(els.region, regionSorted);
  fillSelect(els.method, D['교과/종합'].map((m, i) => [i, m]));
  fillSelect(els.track, D['인문/자연'].map((t, i) => [i, t]).filter(([, t]) => t));
  const catSorted = D['소계열'].map((c, i) => [i, c]).filter(([, c]) => c && c !== '0.0').sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  fillSelect(els.cat, catSorted);

  function judge(i, g) {
    const cut = g70[i] != null ? g70[i] : g50[i];
    if (cut == null) return null;
    if (g <= cut - 0.25) return '안정';
    if (g <= cut + 0.25) return '적정';
    if (g <= cut + 0.8) return '도전';
    return '어려움';
  }
  function deltaHtml(cut) {
    if (cut == null || state.grade == null) return '';
    const d = cut - state.grade;
    const cls = d > 0.005 ? 'plus' : d < -0.005 ? 'minus' : 'zero';
    return `<span class="delta ${cls}">${(d >= 0 ? '+' : '') + d.toFixed(2)}</span>`;
  }

  const state = {
    qUniv: '', qDept: '', qAdm: '', year: '', region: '', method: '', track: '', cat: '',
    grade: null, judges: new Set(), sortKey: 'g50', sortDir: 1, shown: 300,
  };
  const FIELDS = {
    qUniv: { names: D['대학'], lower: univL, codes: univ, exact: new Set(univL) },
    qDept: { names: D['학과'], lower: deptL, codes: dept, exact: new Set(deptL) },
    qAdm: { names: D['전형'], lower: admL, codes: adm, exact: new Set(admL) },
  };
  function fieldPred(key) {
    const q = state[key].trim().toLowerCase();
    if (!q) return null;
    const f = FIELDS[key];
    if (f.exact.has(q)) return c => f.lower[c] === q;
    const toks = q.split(/\s+/);
    return c => matchAll(f.lower[c], toks);
  }
  const COLS = [
    { key: 'year', label: '학년도', num: true, get: i => year[i] },
    { key: 'region', label: '지역', num: false, get: i => D['지역'][region[i]] },
    { key: 'univ', label: '대학', num: false, get: i => D['대학'][univ[i]] },
    { key: 'method', label: '유형', num: false, get: i => D['교과/종합'][method[i]] },
    { key: 'adm', label: '전형', num: false, get: i => D['전형'][adm[i]] },
    { key: 'dept', label: '학과', num: false, get: i => D['학과'][dept[i]] },
    { key: 'track', label: '계열', num: false, get: i => D['인문/자연'][track[i]] },
    { key: 'seats', label: '모집', num: true, get: i => seats[i] },
    { key: 'comp', label: '경쟁률', num: true, get: i => comp[i] },
    { key: 'chuhap', label: '추합', num: true, get: i => chuhap[i] },
    { key: 'g50', label: '등급50%', num: true, get: i => g50[i] },
    { key: 'g70', label: '등급70%', num: true, get: i => g70[i] },
  ];
  function runFilter(skipKey) {
    const pU = skipKey === 'qUniv' ? null : fieldPred('qUniv');
    const pD = skipKey === 'qDept' ? null : fieldPred('qDept');
    const pA = skipKey === 'qAdm' ? null : fieldPred('qAdm');
    const wYear = state.year === '' ? null : +state.year;
    const wRegion = state.region === '' ? null : +state.region;
    const wMethod = state.method === '' ? null : +state.method;
    const wTrack = state.track === '' ? null : +state.track;
    const wCat = state.cat === '' ? null : +state.cat;
    const g = state.grade;
    const useJudge = g != null && state.judges.size > 0;
    const out = [];
    for (let i = 0; i < N; i++) {
      if (wYear !== null && year[i] !== wYear) continue;
      if (wRegion !== null && region[i] !== wRegion) continue;
      if (wMethod !== null && method[i] !== wMethod) continue;
      if (wTrack !== null && track[i] !== wTrack) continue;
      if (wCat !== null && cat[i] !== wCat) continue;
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
      if (va == null) return 1;
      if (vb == null) return -1;
      return (isNum ? (va - vb) : String(va).localeCompare(String(vb), 'ko')) * dir;
    });
    return idx;
  }
  let current = [];
  function renderHead() {
    let h = COLS.map(c => {
      const arrow = state.sortKey === c.key ? `<span class="arrow">${state.sortDir === 1 ? '▲' : '▼'}</span>` : '';
      return `<th class="${c.num ? 'num' : ''}" data-sort="${c.key}">${c.label} ${arrow}</th>`;
    }).join('');
    if (state.grade != null) h += '<th>판정</th>';
    els.thead.innerHTML = h;
  }
  function renderBody() {
    const showJudge = state.grade != null;
    let html = '';
    for (const i of current.slice(0, state.shown)) {
      const mName = D['교과/종합'][method[i]];
      html += `<tr data-i="${i}">`
        + `<td class="num">${year[i]}</td>`
        + `<td>${esc(D['지역'][region[i]])}</td>`
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
    if (state.region !== '') parts.push(D['지역'][+state.region]);
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
  // 검색어 자동완성: 현재 걸린 다른 조건 안에서 후보와 건수를 계산한다.
  function suggestFor(stateKey) {
    return toks => {
      if (!toks.length) return [];
      const f = FIELDS[stateKey];
      const idx = runFilter(stateKey);
      const counts = new Map();
      for (const i of idx) counts.set(f.codes[i], (counts.get(f.codes[i]) || 0) + 1);
      const first = toks[0], starts = [], contains = [];
      for (const c of counts.keys()) {
        const nm = f.names[c];
        if (!nm || !matchAll(f.lower[c], toks)) continue;
        (f.lower[c].startsWith(first) ? starts : contains).push(c);
      }
      const byCount = (a, b) => counts.get(b) - counts.get(a);
      starts.sort(byCount); contains.sort(byCount);
      return starts.concat(contains).slice(0, 12).map(c => [f.names[c], counts.get(c)]);
    };
  }
  for (const [input, box, key] of [[els.qUniv, $('sugUniv'), 'qUniv'], [els.qDept, $('sugDept'), 'qDept'], [els.qAdm, $('sugAdm'), 'qAdm']]) {
    bindAutocomplete(input, box, suggestFor(key), v => { state[key] = v.trim(); refresh(); });
  }
  for (const [el, key] of [[els.year, 'year'], [els.region, 'region'], [els.method, 'method'], [els.track, 'track'], [els.cat, 'cat']]) {
    el.addEventListener('change', () => { state[key] = el.value; refresh(); });
  }
  els.grade.addEventListener('input', () => {
    const v = parseFloat(els.grade.value);
    state.grade = Number.isFinite(v) && v >= 1 && v <= 9 ? v : null;
    els.chips.hidden = state.grade == null;
    if (state.grade == null) {
      state.judges.clear();
      for (const b of els.chips.querySelectorAll('.chip')) b.setAttribute('aria-pressed', 'false');
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
    if (state.sortKey === th.dataset.sort) state.sortDir *= -1;
    else { state.sortKey = th.dataset.sort; state.sortDir = 1; }
    current = runSort(current);
    renderHead(); renderBody();
  });
  els.tbody.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-i]');
    if (tr) { const i = +tr.dataset.i; openDetail(univ[i], dept[i], null); }
  });
  els.more.addEventListener('click', () => { state.shown += 300; renderBody(); });

  /* ================= 탭 2: 대학 분석 (NEW대학분석 + 훑어보기) ================= */
  const uState = { univ: null, metrics: new Set(['g70', 'comp']) };
  const rowsByUniv = new Map();
  for (let i = 0; i < N; i++) {
    if (!rowsByUniv.has(univ[i])) rowsByUniv.set(univ[i], []);
    rowsByUniv.get(univ[i]).push(i);
  }
  // 원본 대학링크 시트의 '학과안내자료' 열은 전 대학이 비어 있어 싣지 않는다.
  const LINK_LABELS = [['입학처홈페이지', '입학처'], ['대학교 입결발표', '입결 발표'], ['대학알리미', '대학알리미'],
    ['종합전형가이드북', '종합전형 가이드북'], ['2026', '어디가 2026'], ['2027', '어디가 2027']];
  // 대학자료와 대학링크 시트의 캠퍼스 표기가 서로 다른 대학들.
  const LINK_ALIAS = { '중앙대(다빈치)': '중앙대2캠', '홍익대(세)': '홍익대' };

  function renderUnivLinks(name) {
    const box = $('uLinks');
    const alias = LINK_ALIAS[name];
    const e = LINKS[name] || (alias ? LINKS[alias] : null);
    const none = '<span class="none">이 대학의 링크 정보가 원본에 없습니다</span>';
    if (!e) { box.innerHTML = none; return; }
    const btns = LINK_LABELS.filter(([k]) => e[k])
      .map(([k, label]) => `<a class="linkbtn" href="${esc(e[k])}" target="_blank" rel="noopener">${esc(label)} ↗</a>`).join('');
    if (!btns) { box.innerHTML = none; return; }
    box.innerHTML = btns + (LINKS[name] ? ''
      : `<span class="none">원본 링크 시트의 <b>${esc(alias)}</b> 기준입니다</span>`);
  }

  function renderUniv() {
    const uc = uState.univ;
    if (uc == null) return;
    const name = D['대학'][uc];
    $('uTitle').textContent = name;
    renderUnivLinks(name);

    // 전형 × 학과 조합을 행으로, 연도를 열로 편다.
    const groups = new Map();
    for (const i of rowsByUniv.get(uc)) {
      const key = adm[i] + ' ' + dept[i];
      if (!groups.has(key)) groups.set(key, { adm: adm[i], dept: dept[i], years: new Map() });
      groups.get(key).years.set(year[i], i);
    }
    const mets = ['g70', 'g50', 'seats', 'comp', 'realComp', 'chuhap'].filter(m => uState.metrics.has(m));
    if (!mets.length) mets.push('g70');
    const sortMet = mets[0];

    const list = [...groups.values()].sort((a, b) => {
      const av = pick(a, sortMet), bv = pick(b, sortMet);
      if (av == null && bv == null) return D['전형'][a.adm].localeCompare(D['전형'][b.adm], 'ko');
      if (av == null) return 1;
      if (bv == null) return -1;
      return METRIC[sortMet].invert ? av - bv : bv - av;   // 등급은 오름차순(우수 먼저), 나머지는 큰 값 먼저
    });
    function pick(gr, m) {   // 최신 연도의 값(없으면 그 이전 연도)
      for (const y of YEARS) {
        const i = gr.years.get(y);
        if (i != null && METRIC[m].arr[i] != null) return METRIC[m].arr[i];
      }
      return null;
    }

    let h1 = '<tr><th rowspan="2" style="min-width:230px">전형 · 학과</th>';
    let h2 = '<tr>';
    for (const m of mets) {
      h1 += `<th class="num" colspan="${YEARS.length}" style="border-left:1px solid var(--line)">${METRIC[m].label}</th>`;
      h2 += YEARS.map((y, k) => `<th class="num yr" ${k === 0 ? 'style="border-left:1px solid var(--line)"' : ''}>${y}</th>`).join('');
    }
    $('uThead').innerHTML = h1 + '</tr>' + h2 + '</tr>';

    $('uTbody').innerHTML = list.map(gr => {
      let r = `<tr data-adm="${gr.adm}" data-dept="${gr.dept}"><td class="grp">${esc(D['전형'][gr.adm])} <span style="font-weight:400;color:var(--muted)">·</span> ${esc(D['학과'][gr.dept])}</td>`;
      for (const m of mets) {
        const M = METRIC[m];
        r += YEARS.map((y, k) => {
          const i = gr.years.get(y);
          const v = i != null ? M.arr[i] : null;
          return `<td class="num" ${k === 0 ? 'style="border-left:1px solid var(--line)"' : ''}>${fmt(v, M.dp)}</td>`;
        }).join('');
      }
      return r + '</tr>';
    }).join('');
    $('uEmpty').hidden = list.length > 0;
    $('uScope').textContent = `${list.length}개 전형·학과 · ${YEARS[YEARS.length - 1]}~${YEARS[0]}학년도`;
  }

  function selectUniv(name) {
    const c = D['대학'].indexOf(String(name).trim());
    if (c < 0) return;
    uState.univ = c;
    $('uPick').value = D['대학'][c];
    renderUniv();
  }
  bindAutocomplete($('uPick'), $('sugUPick'), toks => {
    if (!toks.length) return [];
    const hits = [];
    for (let c = 0; c < D['대학'].length; c++) {
      if (matchAll(univL[c], toks)) hits.push([D['대학'][c], (rowsByUniv.get(c) || []).length]);
    }
    return hits.sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, v => {
    selectUniv(v);
    if (uState.univ != null) location.hash = '#univ/' + encodeURIComponent(D['대학'][uState.univ]);
  });
  $('uMetrics').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const m = b.dataset.m;
    if (uState.metrics.has(m)) { uState.metrics.delete(m); b.setAttribute('aria-pressed', 'false'); }
    else { uState.metrics.add(m); b.setAttribute('aria-pressed', 'true'); }
    renderUniv();
  });
  $('uTbody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-dept]');
    if (tr && uState.univ != null) openDetail(uState.univ, +tr.dataset.dept, +tr.dataset.adm);
  });

  /* ================= 탭 3: 집계 · 연도비교 ================= */
  const PKEYS = {
    univ: { label: '대학', codes: univ, names: D['대학'] },
    region: { label: '지역', codes: region, names: D['지역'] },
    adm: { label: '전형', codes: adm, names: D['전형'] },
    method: { label: '전형 유형', codes: method, names: D['교과/종합'] },
    dept: { label: '학과', codes: dept, names: D['학과'] },
    track: { label: '계열', codes: track, names: D['인문/자연'] },
    cat: { label: '소계열', codes: cat, names: D['소계열'] },
  };
  const PMETRIC = {
    g70: { arr: g70, dp: 2, sum: false }, g50: { arr: g50, dp: 2, sum: false },
    comp: { arr: comp, dp: 2, sum: false }, realComp: { arr: realComp, dp: 2, sum: false },
    v50: { arr: v50, dp: 1, sum: false }, v70: { arr: v70, dp: 1, sum: false },
    seats: { arr: seats, dp: 0, sum: true }, chuhap: { arr: chuhap, dp: 0, sum: true },
  };
  fillSelect($('pKey1'), Object.entries(PKEYS).map(([k, v]) => [k, v.label]));
  fillSelect($('pKey2'), Object.entries(PKEYS).map(([k, v]) => [k, v.label]));
  $('pKey1').value = 'univ';
  fillSelect($('pRegion'), regionSorted);
  fillSelect($('pMethod'), D['교과/종합'].map((m, i) => [i, m]));

  function renderPivot() {
    const k1 = PKEYS[$('pKey1').value], k2v = $('pKey2').value, k2 = k2v ? PKEYS[k2v] : null;
    const metKey = $('pMetric').value, M = PMETRIC[metKey];
    const wRegion = $('pRegion').value === '' ? null : +$('pRegion').value;
    const wMethod = $('pMethod').value === '' ? null : +$('pMethod').value;

    const groups = new Map();   // label → {sum,cnt} per year
    for (let i = 0; i < N; i++) {
      if (wRegion !== null && region[i] !== wRegion) continue;
      if (wMethod !== null && method[i] !== wMethod) continue;
      const v = M.arr[i];
      if (v == null) continue;
      const n1 = k1.names[k1.codes[i]];
      if (!n1) continue;
      let label = n1;
      if (k2) {
        const n2 = k2.names[k2.codes[i]];
        if (!n2) continue;
        label += ' · ' + n2;
      }
      let g = groups.get(label);
      if (!g) { g = { years: new Map() }; groups.set(label, g); }
      let cell = g.years.get(year[i]);
      if (!cell) { cell = { sum: 0, cnt: 0 }; g.years.set(year[i], cell); }
      cell.sum += v; cell.cnt++;
    }
    const val = cell => cell == null ? null : (M.sum ? cell.sum : cell.sum / cell.cnt);
    const latest = YEARS[0], prev = YEARS[1];
    const list = [...groups.entries()].map(([label, g]) => {
      const cur = val(g.years.get(latest)), pre = val(g.years.get(prev));
      return { label, g, cur, pre, delta: cur != null && pre != null ? cur - pre : null };
    }).sort((a, b) => {
      if (a.cur == null && b.cur == null) return a.label.localeCompare(b.label, 'ko');
      if (a.cur == null) return 1;
      if (b.cur == null) return -1;
      return metKey.startsWith('g') ? a.cur - b.cur : b.cur - a.cur;
    });

    $('pThead').innerHTML = '<tr><th style="min-width:200px">' + esc(k1.label + (k2 ? ' · ' + k2.label : ''))
      + '</th>' + YEARS.slice().reverse().map(y => `<th class="num">${y}</th>`).join('')
      + `<th class="num">${latest} − ${prev}</th><th class="num">표본</th></tr>`;
    $('pTbody').innerHTML = list.slice(0, 500).map(r => {
      const cells = YEARS.slice().reverse().map(y => `<td class="num">${fmt(val(r.g.years.get(y)), M.dp)}</td>`).join('');
      const d = r.delta;
      const cls = d == null ? 'zero' : (metKey.startsWith('g') ? (d < 0 ? 'plus' : d > 0 ? 'minus' : 'zero') : (d > 0 ? 'plus' : d < 0 ? 'minus' : 'zero'));
      const dTxt = d == null ? '–' : (d >= 0 ? '+' : '') + d.toFixed(M.dp);
      const total = [...r.g.years.values()].reduce((s, c) => s + c.cnt, 0);
      return `<tr><td><b>${esc(r.label)}</b></td>${cells}<td class="num"><span class="delta ${cls}">${dTxt}</span></td><td class="num" style="color:var(--muted)">${total}</td></tr>`;
    }).join('');
    $('pCount').textContent = list.length.toLocaleString('ko-KR');
    $('pNote').textContent = (M.sum ? '합계' : '평균') + ' · 값이 있는 행만 집계'
      + (list.length > 500 ? ' · 상위 500개 표시' : '');
  }
  for (const id of ['pKey1', 'pKey2', 'pRegion', 'pMethod', 'pMetric']) $(id).addEventListener('change', renderPivot);
  renderPivot();

  /* ================= 탭 4: 등급 변환 ================= */
  // GRADE: [기준백분위, 9등급, 5등급] · 백분위 내림차순
  // 결측 구간(원본 수식이 깨진 아래쪽)은 보간하지 않고 그대로 결측으로 돌려준다.
  const lerp = (a, b, t) => (a == null || b == null) ? null : a + (b - a) * t;
  function pctToGrade(p) {
    if (!GRADE.length || !(p >= 0 && p <= 100)) return [null, null];
    for (let k = 0; k < GRADE.length; k++) {
      const [gp, g9, g5] = GRADE[k];
      if (p >= gp) {
        if (k === 0) return [g9, g5];
        const [pp, p9, p5] = GRADE[k - 1];   // 한 칸 위(더 높은 백분위)
        const t = (p - gp) / (pp - gp);      // 선형 보간
        return [lerp(g9, p9, t), lerp(g5, p5, t)];
      }
    }
    const last = GRADE[GRADE.length - 1];
    return [last[1], last[2]];
  }
  // 등급 → 백분위: 표는 백분위 내림차순이고 등급은 그에 따라 커진다.
  // 입력 등급 이상이 되는 첫 지점의 기준 백분위를 돌려준다.
  function gradeToPct(g) {
    if (!GRADE.length || !(g >= 1 && g <= 9)) return null;
    let lastValid = null;
    for (const [p, g9] of GRADE) {
      if (g9 == null) break;                 // 결측 구간부터는 표를 믿지 않는다
      if (g9 >= g) return p;
      lastValid = p;
    }
    return lastValid;   // 표가 닿는 최저 백분위까지 내려가도 등급에 못 미치는 경우
  }
  $('cvPct').addEventListener('input', () => {
    const p = parseFloat($('cvPct').value);
    const [g9, g5] = pctToGrade(p);
    $('cvG9').textContent = g9 == null ? '–' : g9.toFixed(2);
    $('cvG5').textContent = g5 == null ? '–' : g5.toFixed(2);
  });
  $('cvGrade').addEventListener('input', () => {
    const p = gradeToPct(parseFloat($('cvGrade').value));
    $('cvPctOut').textContent = p == null ? '–' : p.toFixed(1);
  });
  const notes = [];
  if (G5_MIN != null) notes.push(`5등급 열은 백분위 ${G5_MIN.toFixed(1)} 아래 구간에서 수식이 깨져 있습니다(8542.5 같은 값).`);
  if (G9_MIN != null && G9_MIN > GRADE[GRADE.length - 1][0]) notes.push(`9등급 열도 백분위 ${G9_MIN.toFixed(1)} 아래 구간에서 9를 넘는 값이 나옵니다.`);
  $('gNote').textContent = notes.length
    ? '원본 시트의 ' + notes.join(' ') + ' 등급 범위를 벗어난 구간은 –로 비워 두었습니다.' : '';
  $('gTbody').innerHTML = GRADE.map(([p, g9, g5]) =>
    `<tr><td class="num"><b>${p.toFixed(1)}</b></td><td class="num">${g9 == null ? '–' : g9.toFixed(2)}</td><td class="num">${g5 == null ? '–' : g5.toFixed(2)}</td></tr>`).join('');

  /* ================= 탭 5: 대학 링크 ================= */
  function renderLinks() {
    const q = $('lQuery').value.trim().toLowerCase();
    const names = Object.keys(LINKS).filter(n => !q || n.toLowerCase().includes(q)).sort((a, b) => a.localeCompare(b, 'ko'));
    const cell = (e, k) => e[k] ? `<a class="linkbtn" href="${esc(e[k])}" target="_blank" rel="noopener">열기 ↗</a>` : '<span style="color:var(--muted)">–</span>';
    $('lTbody').innerHTML = names.map(n => {
      const e = LINKS[n];
      const adiga = e['2026'] || e['2027'];
      return `<tr style="cursor:default"><td><b>${esc(n)}</b></td>`
        + `<td>${cell(e, '입학처홈페이지')}</td><td>${cell(e, '대학교 입결발표')}</td><td>${cell(e, '대학알리미')}</td>`
        + `<td>${cell(e, '종합전형가이드북')}</td>`
        + `<td>${adiga ? `<a class="linkbtn" href="${esc(adiga)}" target="_blank" rel="noopener">어디가 ↗</a>` : '<span style="color:var(--muted)">–</span>'}</td></tr>`;
    }).join('');
    $('lCount').textContent = names.length;
    $('lEmpty').hidden = names.length > 0;
  }
  $('lQuery').addEventListener('input', renderLinks);
  renderLinks();

  $('statTotal').textContent = `· ${D['대학'].length}개 대학 · ${N.toLocaleString('ko-KR')}건`;
  refresh();
  applyHash();
  window.addEventListener('hashchange', applyHash);
})();
