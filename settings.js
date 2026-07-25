/* 관심대학·지원예정 설정 탭 — 원본 SettingsClient.tsx 이관.
   window.CalLib(상한·특수기관·대학목록) + window.Susi(설정·apiFetch) 사용.
   window.SettingsTab.ensureRendered(): 탭이 처음 열릴 때 app.js가 호출. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  };

  var LIB = window.CalLib;
  var interested = null, applying = null; // null = 미초기화
  var query = '';
  var saving = false;
  var message = null; // { ok, text }

  function initFromServer() {
    var s = (window.Susi && window.Susi.getSettings()) || { interested: [], applying: [] };
    interested = s.interested.slice();
    applying = s.applying.slice();
  }

  function toggle(kind, u) {
    message = null;
    if (kind === 'interested') {
      var i = interested.indexOf(u);
      if (i >= 0) interested.splice(i, 1);
      else if (interested.length >= LIB.MAX_INTERESTED) {
        message = { ok: false, text: '관심대학은 최대 ' + LIB.MAX_INTERESTED + '개까지 담을 수 있습니다.' };
      } else interested.push(u);
    } else {
      var j = applying.indexOf(u);
      if (j >= 0) applying.splice(j, 1);
      else if (!LIB.isSpecialInstitution(u) && LIB.countableApplying(applying) >= LIB.MAX_APPLYING) {
        message = { ok: false, text: '지원 예정 대학은 최대 ' + LIB.MAX_APPLYING + '개까지 담을 수 있습니다. (KAIST·DGIST·GIST·UNIST·KENTECH·사관학교 제외)' };
      } else applying.push(u);
    }
    render();
  }

  async function save() {
    saving = true; message = null; render();
    try {
      var res = await window.Susi.apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ interested: interested, applying: applying })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) { message = { ok: false, text: data.error || '저장에 실패했습니다.' }; return; }
      message = { ok: true, text: '저장되었습니다.' };
      // 전역 설정 갱신 → 달력 재렌더 트리거
      window.Susi.setSettings({ interested: interested.slice(), applying: applying.slice() });
    } catch (e) {
      message = { ok: false, text: '네트워크 오류가 발생했습니다.' };
    } finally {
      saving = false; render();
    }
  }

  function render() {
    var pane = $('pane-settings');
    if (!pane) return;
    if (interested === null) initFromServer();

    var univs = LIB.universities();
    var q = query.trim().toLowerCase();
    var filtered = q ? univs.filter(function (u) { return u.university.toLowerCase().indexOf(q) >= 0; }) : univs;
    var iSet = {}; interested.forEach(function (u) { iSet[u] = true; });
    var aSet = {}; applying.forEach(function (u) { aSet[u] = true; });
    var applyingCount = LIB.countableApplying(applying);

    var html = '';
    // 상단 카운터 + 저장
    html += '<div class="set-top">' +
      '<h2 class="set-title">관심대학 · 지원예정 설정</h2>' +
      '<span class="set-count">관심대학 <b' + (interested.length >= LIB.MAX_INTERESTED ? ' class="over"' : '') + '>' +
      interested.length + '</b> / ' + LIB.MAX_INTERESTED + '</span>' +
      '<span class="set-count">지원예정 <b' + (applyingCount >= LIB.MAX_APPLYING ? ' class="over"' : '') + '>' +
      applyingCount + '</b> / ' + LIB.MAX_APPLYING + '</span>' +
      '<button type="button" class="set-save" id="setSave"' + (saving ? ' disabled' : '') + '>' +
      (saving ? '저장 중...' : '저장') + '</button>' +
      '</div>';

    if (message) {
      html += '<p class="set-msg ' + (message.ok ? 'ok' : 'err') + '">' + esc(message.text) + '</p>';
    }
    html += '<p class="set-desc">담은 대학의 모든 수시 일정이 <b>수시 달력</b> 탭에 표시됩니다. (수능은 항상 표시)</p>';

    // 검색
    html += '<input type="text" id="setQuery" class="set-search" placeholder="대학명 검색" autocomplete="off" value="' + esc(query) + '">';

    // 목록
    html += '<div class="set-list">';
    if (filtered.length === 0) {
      html += '<p class="set-none">검색 결과가 없습니다.</p>';
    } else {
      html += filtered.map(function (u) {
        var isI = !!iSet[u.university], isA = !!aSet[u.university];
        return '<div class="set-item">' +
          '<span class="set-uname">' + esc(u.university) + '</span>' +
          (u.special ? '<span class="set-tag">지원 횟수 제외</span>' : '') +
          '<span class="set-acts">' +
          '<button type="button" class="set-toggle i' + (isI ? ' on' : '') + '" data-kind="interested" data-u="' + esc(u.university) + '">관심</button>' +
          '<button type="button" class="set-toggle a' + (isA ? ' on' : '') + '" data-kind="applying" data-u="' + esc(u.university) + '">지원</button>' +
          '</span></div>';
      }).join('');
    }
    html += '</div>';

    // 담은 목록 요약
    html += '<div class="set-summary">' +
      summaryHTML('관심대학', 'i', interested) +
      summaryHTML('지원 예정 대학', 'a', applying) +
      '</div>';

    pane.innerHTML = html;
    bind(pane);
  }

  function summaryHTML(title, cls, items) {
    var chips = items.length === 0
      ? '<p class="set-none">담은 대학이 없습니다.</p>'
      : '<div class="set-chips">' + items.map(function (u) {
        return '<button type="button" class="set-chip" data-remove="' + cls + '" data-u="' + esc(u) + '" title="클릭하여 제거">' +
          esc(u) + ' ✕</button>';
      }).join('') + '</div>';
    return '<div class="set-sumcol set-sum-' + cls + '"><h3>' + esc(title) + ' (' + items.length + ')</h3>' + chips + '</div>';
  }

  function bind(pane) {
    var saveBtn = $('setSave');
    if (saveBtn) saveBtn.addEventListener('click', function () { if (!saving) save(); });
    var q = $('setQuery');
    if (q) q.addEventListener('input', function () {
      query = q.value;
      // 목록만 갱신하면 좋지만 단순화를 위해 전체 재렌더 (포커스 유지)
      var pos = q.selectionStart;
      render();
      var nq = $('setQuery');
      if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) {} }
    });
    pane.addEventListener('click', function (e) {
      var t = e.target.closest('.set-toggle');
      if (t) { toggle(t.dataset.kind, t.dataset.u); return; }
      var r = e.target.closest('.set-chip');
      if (r) { toggle(r.dataset.remove === 'i' ? 'interested' : 'applying', r.dataset.u); return; }
    });
  }

  window.SettingsTab = {
    ensureRendered: function () { if (interested === null) initFromServer(); render(); }
  };

  // 외부(부팅/저장)에서 설정이 바뀌면 로컬 상태 재동기화
  if (window.Susi && window.Susi.onSettingsChange) {
    window.Susi.onSettingsChange(function (s) {
      interested = s.interested.slice();
      applying = s.applying.slice();
      if ($('pane-settings') && !$('pane-settings').hidden) render();
    });
  }
})();
