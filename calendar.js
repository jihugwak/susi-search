/* 수시 달력(2027) 탭 — 원본 2027 수시 Calendar 프로젝트(CalendarClient.tsx + lib/date.ts +
   lib/types.ts)를 susi-search 정적 사이트용 바닐라 JS로 이관. React/Tailwind 미사용.
   window.CalLib: 다른 모듈(settings.js)과 공유하는 순수 로직.
   window.Calendar.ensureRendered(): 탭이 처음 열릴 때 app.js가 호출. */
(function () {
  'use strict';

  var DATA = window.CAL_DATA || { notice: '', events: [] };
  var EVENTS = DATA.events || [];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  };

  /* ================= 날짜 유틸 (lib/date.ts 이관) ================= */
  function parseDate(iso) {
    var p = iso.split('-').map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  function startOfWeek(d) { var s = startOfDay(d); return addDays(s, -s.getDay()); } // 일요일 시작
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function withinRange(day, startISO, endISO) {
    var t = startOfDay(day).getTime(), s = parseDate(startISO).getTime(), e = parseDate(endISO).getTime();
    return t >= s && t <= e;
  }
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function weekdayKo(d) { return WEEKDAYS[d.getDay()]; }
  function formatKo(d) {
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + weekdayKo(d) + ')';
  }
  function formatRangeKo(startISO, endISO) {
    var s = parseDate(startISO), e = parseDate(endISO);
    if (sameDay(s, e)) return formatKo(s);
    var sameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
    if (sameMonth) {
      return s.getFullYear() + '년 ' + (s.getMonth() + 1) + '월 ' + s.getDate() + '일 (' + weekdayKo(s) +
        ') ~ ' + e.getDate() + '일 (' + weekdayKo(e) + ')';
    }
    return formatKo(s) + ' ~ ' + formatKo(e);
  }

  /* ================= 필터 로직 (lib/types.ts 이관) ================= */
  var COMMON_CATEGORIES = ['수능']; // 설정과 무관하게 항상 표시
  var MAX_INTERESTED = 30, MAX_APPLYING = 6;
  function isCommonCategory(cat) { return COMMON_CATEGORIES.indexOf(cat) >= 0; }
  function isSpecialInstitution(university) {
    var u = university.toUpperCase().replace(/\s/g, '');
    if (['KAIST', 'DGIST', 'GIST', 'UNIST', 'KENTECH'].some(function (k) { return u.indexOf(k) >= 0; })) return true;
    if (university.indexOf('사관학교') >= 0) return true;
    return false;
  }
  function countableApplying(applying) {
    return applying.filter(function (u) { return !isSpecialInstitution(u); }).length;
  }
  function eventMatches(e, selectedSet) {
    if (isCommonCategory(e.category)) return true;
    return selectedSet.has(e.university);
  }

  /* 대학 목록 파생 (lib/data.ts buildUniversities): 공통구분 제외, 유니크, ko 정렬 */
  var UNIVERSITIES = (function () {
    var set = {};
    EVENTS.forEach(function (e) { if (!isCommonCategory(e.category)) set[e.university] = true; });
    return Object.keys(set).map(function (u) {
      return { university: u, special: isSpecialInstitution(u) };
    }).sort(function (a, b) { return a.university.localeCompare(b.university, 'ko'); });
  })();

  window.CalLib = {
    MAX_INTERESTED: MAX_INTERESTED, MAX_APPLYING: MAX_APPLYING,
    isSpecialInstitution: isSpecialInstitution, countableApplying: countableApplying,
    universities: function () { return UNIVERSITIES; }
  };

  /* ================= 카테고리 색/순서 (CalendarClient.tsx 이관) ================= */
  var CATEGORY_CLASS = {
    '원서접수마감': 'cat-apply', '추천명단마감': 'cat-recommend', '서류마감': 'cat-doc',
    '1단계합격': 'cat-step1', '면접': 'cat-interview', '논술': 'cat-essay',
    '실기': 'cat-practical', '최종합격': 'cat-final', '충원합격': 'cat-extra', '수능': 'cat-suneung'
  };
  var CATEGORY_ORDER = ['원서접수마감', '추천명단마감', '서류마감', '1단계합격', '면접', '논술', '실기', '최종합격', '충원합격', '수능'];
  function catClass(cat) { return CATEGORY_CLASS[cat] || 'cat-etc'; }

  /* ================= 상태 ================= */
  var view = 'month';
  var cursor = null;
  var rendered = false;
  var eventById = {};
  EVENTS.forEach(function (e) { eventById[e.id] = e; });

  function selectedSet() {
    var s = (window.Susi && window.Susi.getSettings()) || { interested: [], applying: [] };
    var set = new Set();
    s.interested.forEach(function (u) { set.add(u); });
    s.applying.forEach(function (u) { set.add(u); });
    return set;
  }

  function activeEvents() {
    var set = selectedSet();
    return EVENTS.filter(function (e) { return eventMatches(e, set); });
  }

  function eventsOnDay(events, day) {
    return events.filter(function (e) { return withinRange(day, e.start, e.end); })
      .sort(function (a, b) { return a.category.localeCompare(b.category, 'ko'); });
  }

  function initialCursor(events) {
    if (!events.length) return startOfDay(new Date());
    var earliest = events.reduce(function (min, e) {
      var t = parseDate(e.start).getTime(); return t < min ? t : min;
    }, Infinity);
    return startOfDay(new Date(earliest));
  }

  /* ================= 렌더 ================= */
  function render() {
    var pane = $('pane-cal');
    if (!pane) return;
    var events = activeEvents();
    var hasSelection = selectedSet().size > 0;

    if (!hasSelection) {
      pane.innerHTML =
        '<div class="cal-empty">' +
        '<div class="cal-empty-icon">🗓️</div>' +
        '<h2>아직 담은 전형이 없어요</h2>' +
        '<p>관심대학·지원예정 대학을 설정하면 해당 일정만 달력에 표시됩니다. (수능은 항상 표시)</p>' +
        '<button type="button" class="cal-cta" id="calToSettings">대학·전형 설정하러 가기</button>' +
        '</div>';
      var btn = $('calToSettings');
      if (btn) btn.addEventListener('click', function () { var t = $('tab-settings'); if (t) t.click(); });
      return;
    }

    if (!cursor) cursor = initialCursor(events);
    var today = startOfDay(new Date());

    var periodLabel;
    if (view === 'month') periodLabel = cursor.getFullYear() + '년 ' + (cursor.getMonth() + 1) + '월';
    else if (view === 'week') {
      var ws = startOfWeek(cursor), we = addDays(ws, 6);
      periodLabel = (ws.getMonth() + 1) + '월 ' + ws.getDate() + '일 ~ ' + (we.getMonth() + 1) + '월 ' + we.getDate() + '일';
    } else periodLabel = formatKo(cursor);

    var html = '';
    // 컨트롤 바
    html += '<div class="cal-ctrl">' +
      '<div class="cal-nav">' +
      '<button type="button" class="cal-btn" data-move="-1" aria-label="이전">‹</button>' +
      '<button type="button" class="cal-btn" data-move="1" aria-label="다음">›</button>' +
      '<button type="button" class="cal-btn cal-today" data-today="1">오늘</button>' +
      '</div>' +
      '<h2 class="cal-period">' + esc(periodLabel) + '</h2>' +
      '<div class="cal-views">' +
      ['month', 'week', 'day'].map(function (v) {
        return '<button type="button" class="cal-view' + (v === view ? ' on' : '') + '" data-view="' + v + '">' +
          (v === 'month' ? '월' : v === 'week' ? '주' : '일') + '</button>';
      }).join('') +
      '</div></div>';

    // 본문
    html += '<div class="cal-body">';
    if (view === 'month') html += monthHTML(events, today);
    else if (view === 'week') html += weekHTML(events, today);
    else html += dayHTML(events, today);
    html += '</div>';

    // 범례
    html += '<div class="cal-legend">' + CATEGORY_ORDER.map(function (c) {
      return '<span class="cal-leg"><span class="cal-dot ' + catClass(c) + '"></span>' + esc(c) + '</span>';
    }).join('') + '</div>';

    // 유의사항
    if (DATA.notice) {
      html += '<section class="panel cal-notice"><h3>유의사항</h3><p>' + esc(DATA.notice) + '</p></section>';
    }

    pane.innerHTML = html;
    bindPane(pane, events);
  }

  function monthHTML(events, today) {
    var first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    var gridStart = startOfWeek(first);
    var days = [];
    for (var i = 0; i < 42; i++) days.push(addDays(gridStart, i));
    var head = '<div class="cal-month-head">' + ['일', '월', '화', '수', '목', '금', '토'].map(function (w, i) {
      var cls = i === 0 ? ' sun' : i === 6 ? ' sat' : '';
      return '<div class="cal-wd' + cls + '">' + w + '</div>';
    }).join('') + '</div>';
    var cells = days.map(function (d, i) {
      var inMonth = d.getMonth() === cursor.getMonth();
      var isToday = sameDay(d, today);
      var dayEvents = eventsOnDay(events, d);
      var dnumCls = isToday ? ' today' : d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '';
      var iso = isoOf(d);
      var pills = dayEvents.slice(0, 3).map(function (e) {
        return '<span class="cal-pill ' + catClass(e.category) + '" data-eid="' + esc(e.id) + '" title="' +
          esc(e.university + ' ' + e.admissionType + ' · ' + e.title) + '">' + esc(e.university + ' ' + e.title) + '</span>';
      }).join('');
      var more = dayEvents.length > 3 ? '<span class="cal-more">+' + (dayEvents.length - 3) + '</span>' : '';
      return '<button type="button" class="cal-cell' + (inMonth ? '' : ' out') + '" data-day="' + iso + '">' +
        '<span class="cal-dnum' + dnumCls + '">' + d.getDate() + '</span>' +
        '<span class="cal-pills">' + pills + more + '</span></button>';
    }).join('');
    return '<div class="cal-month">' + head + '<div class="cal-grid">' + cells + '</div></div>';
  }

  function weekHTML(events, today) {
    var start = startOfWeek(cursor);
    var cards = '';
    for (var i = 0; i < 7; i++) {
      var d = addDays(start, i);
      var isToday = sameDay(d, today);
      var dayEvents = eventsOnDay(events, d);
      var hcls = d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '';
      var inner = dayEvents.length === 0
        ? '<span class="cal-none">일정 없음</span>'
        : dayEvents.map(function (e) {
          return '<button type="button" class="cal-wpill ' + catClass(e.category) + '" data-eid="' + esc(e.id) + '">' +
            '<b>' + esc(e.university) + '</b><br>' + esc(e.title) + '</button>';
        }).join('');
      cards += '<div class="cal-wcard">' +
        '<button type="button" class="cal-whead' + hcls + '" data-day="' + isoOf(d) + '">' +
        '<span class="cal-wdnum' + (isToday ? ' today' : '') + '">' + d.getDate() + '</span>' +
        '<span class="cal-wwd">' + weekdayKo(d) + '</span></button>' +
        '<div class="cal-wbody">' + inner + '</div></div>';
    }
    return '<div class="cal-week">' + cards + '</div>';
  }

  function dayHTML(events, today) {
    var dayEvents = eventsOnDay(events, cursor);
    var isToday = sameDay(cursor, today);
    var head = '<div class="cal-dhead"><span class="cal-dtitle">' + esc(formatKo(cursor)) + '</span>' +
      (isToday ? '<span class="cal-badge-today">오늘</span>' : '') + '</div>';
    var body;
    if (dayEvents.length === 0) {
      body = '<p class="cal-dnoev">이 날에는 담은 전형의 일정이 없습니다.</p>';
    } else {
      body = dayEvents.map(function (e) {
        return '<button type="button" class="cal-drow" data-eid="' + esc(e.id) + '">' +
          '<span class="cal-dcat ' + catClass(e.category) + '">' + esc(e.category) + '</span>' +
          '<span class="cal-dinfo"><span class="cal-duniv">' + esc(e.university) +
          (e.time ? '<span class="cal-dtime">' + esc(e.time) + '</span>' : '') + '</span>' +
          '<span class="cal-dadm">' + esc(e.admissionType || '전체') + '</span>' +
          (e.note ? '<span class="cal-dnote">' + esc(e.note) + '</span>' : '') +
          '</span></button>';
      }).join('');
    }
    return '<div class="cal-day">' + head + '<div class="cal-dlist">' + body + '</div></div>';
  }

  function isoOf(d) {
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  /* ================= 이벤트 배선 ================= */
  function bindPane(pane, events) {
    var ctrl = pane.querySelector('.cal-ctrl');
    if (ctrl) ctrl.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.move) { move(Number(b.dataset.move)); render(); }
      else if (b.dataset.today) { cursor = startOfDay(new Date()); render(); }
      else if (b.dataset.view) { view = b.dataset.view; render(); }
    });
    var body = pane.querySelector('.cal-body');
    if (body) body.addEventListener('click', function (e) {
      var pill = e.target.closest('[data-eid]');
      if (pill) { e.stopPropagation(); openModal(pill.dataset.eid); return; }
      var day = e.target.closest('[data-day]');
      if (day) { cursor = parseDate(day.dataset.day); view = 'day'; render(); }
    });
  }

  function move(dir) {
    if (view === 'month') cursor = addMonths(cursor, dir);
    else if (view === 'week') cursor = addDays(cursor, dir * 7);
    else cursor = addDays(cursor, dir);
  }

  /* ================= 이벤트 상세 모달 ================= */
  function openModal(eid) {
    var e = eventById[eid];
    if (!e) return;
    var dlg = $('calDetail');
    var body = $('calDetailBody');
    body.innerHTML =
      '<div class="cal-md-head"><span class="cal-dcat ' + catClass(e.category) + '">' + esc(e.category) + '</span>' +
      '<button type="button" class="d-close" id="calDetailClose" aria-label="닫기">×</button></div>' +
      '<h2 class="cal-md-title">' + esc(e.title) + '</h2>' +
      '<dl class="cal-md-dl">' +
      row('대학', e.university) +
      row('전형', e.admissionType || '전체') +
      row('구분', e.category) +
      row('일자', formatRangeKo(e.start, e.end) + (e.time ? ' ' + e.time : '')) +
      (e.note ? row('비고', e.note) : '') +
      '</dl>';
    $('calDetailClose').addEventListener('click', function () { dlg.close(); });
    dlg.showModal();
  }
  function row(k, v) {
    return '<div class="cal-md-row"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';
  }

  /* ================= 공개 진입점 ================= */
  window.Calendar = {
    ensureRendered: function () { rendered = true; render(); }
  };

  // 설정 변경 시 이미 렌더된 경우 갱신
  if (window.Susi && window.Susi.onSettingsChange) {
    window.Susi.onSettingsChange(function () { if (rendered) render(); });
  }
})();
