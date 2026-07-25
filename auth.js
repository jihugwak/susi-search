/* 회원제 게이트 + 인증 + 공유 상태.
   정적 프론트(GitHub Pages)에서 Vercel 백엔드(susi-calendar-2027)의 인증·설정 API를
   Bearer 토큰(localStorage)으로 호출한다. 쿠키를 쓰지 않으므로 Safari 등에서도
   교차 사이트로 안정 동작한다.
   window.Susi 로 사용자·설정·apiFetch 를 다른 모듈(calendar.js/settings.js)에 노출한다. */
(function () {
  'use strict';

  var API_BASE = 'https://susi-calendar-2027.vercel.app';
  var TOKEN_KEY = 'susi_token';

  var token = localStorage.getItem(TOKEN_KEY) || null;
  var user = null;
  var settings = { interested: [], applying: [] };
  var settingsListeners = [];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  };

  /* 대전광역시 고등학교 목록 (회원가입 소속학교) — 원본 lib/schools.ts 이관.
     "동방고등학교" 최상단, 나머지 ㄱㄴㄷ 정렬. */
  var PINNED_SCHOOL = '동방고등학교';
  var SCHOOLS_RAW = [
    '계룡디지텍고등학교', '대전가오고등학교', '대전대성여자고등학교', '대전동신과학고등학교',
    '대전여자고등학교', '동아마이스터고등학교', '명석고등학교', '보문고등학교', '우송고등학교',
    '남대전고등학교', '대전고등학교', '대전대성고등학교', '대전국제통상고등학교', '대전동산고등학교',
    '대전성모여자고등학교', '대전신일여자고등학교', '대전여자상업고등학교', '대전중앙고등학교',
    '대전한빛고등학교', '청란여자고등학교', '충남기계공업고등학교', '충남여자고등학교', '호수돈여자고등학교',
    '대전관저고등학교', '대전괴정고등학교', '대전구봉고등학교', '대전대신고등학교', '대전둔산여자고등학교',
    '대전둔원고등학교', '대전만년고등학교', '대전복수고등학교', '대전외국어고등학교', '대전제일고등학교',
    '동방고등학교', '서대전고등학교', '서대전여자고등학교', '서일고등학교', '서일여자고등학교',
    '충남고등학교', '한밭고등학교', '대덕고등학교', '대덕소프트웨어마이스터고등학교', '대전과학고등학교',
    '대전노은고등학교', '대전도시과학고등학교', '대전도안고등학교', '대전반석고등학교', '대전예술고등학교',
    '대전용산고등학교', '대전전민고등학교', '대전전자디자인고등학교', '대전지족고등학교', '대전체육고등학교',
    '유성고등학교', '유성생명과학고등학교', '유성여자고등학교', '중일고등학교', '대전생활과학고등학교',
    '대전송촌고등학교', '대전이문고등학교', '동대전고등학교', '신탄진고등학교'
  ];
  var SCHOOLS = [PINNED_SCHOOL].concat(
    SCHOOLS_RAW.filter(function (s) { return s !== PINNED_SCHOOL; })
      .sort(function (a, b) { return a.localeCompare(b, 'ko'); })
  );

  /* ---------- 토큰 / API ---------- */
  function setToken(t) {
    token = t || null;
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function apiFetch(path, opts) {
    opts = opts || {};
    var headers = {};
    var k;
    if (opts.headers) for (k in opts.headers) headers[k] = opts.headers[k];
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    var o = { method: opts.method || 'GET', headers: headers };
    if (opts.body) o.body = opts.body;
    return fetch(API_BASE + path, o);
  }

  function notifySettings() {
    settingsListeners.forEach(function (fn) {
      try { fn(settings); } catch (e) { /* noop */ }
    });
  }

  function setSettings(s) {
    settings = {
      interested: (s && Array.isArray(s.interested)) ? s.interested.slice() : [],
      applying: (s && Array.isArray(s.applying)) ? s.applying.slice() : []
    };
    notifySettings();
  }

  /* ---------- 화면 전환 ---------- */
  function showApp() {
    var gate = $('authGate'), wrap = $('appWrap'), boot = $('bootMsg');
    if (boot) boot.hidden = true;
    if (gate) gate.hidden = true;
    if (wrap) wrap.hidden = false;
    renderUserBar();
  }
  function showGate(mode) {
    var gate = $('authGate'), wrap = $('appWrap'), boot = $('bootMsg');
    if (boot) boot.hidden = true;
    if (wrap) wrap.hidden = true;
    if (gate) gate.hidden = false;
    setGateMode(mode || 'login');
    var ub = $('userBar'); if (ub) ub.hidden = true;
  }

  function renderUserBar() {
    var ub = $('userBar');
    if (!ub) return;
    if (!user) { ub.hidden = true; return; }
    ub.hidden = false;
    ub.innerHTML =
      '<span class="ub-name">' + esc(user.name) + '<span class="ub-school">' + esc(user.school || '') + '</span></span>' +
      '<button type="button" id="btnLogout" class="ub-logout">로그아웃</button>';
    $('btnLogout').addEventListener('click', logout);
  }

  function setGateMode(mode) {
    var isLogin = mode !== 'signup';
    var lv = $('gateLogin'), sv = $('gateSignup');
    if (lv) lv.hidden = !isLogin;
    if (sv) sv.hidden = isLogin;
    var e1 = $('loginError'); if (e1) e1.textContent = '';
    var e2 = $('signupError'); if (e2) e2.textContent = '';
    var sd = $('signupDone'); if (sd) sd.hidden = true;
    var sf = $('signupForm'); if (sf) sf.hidden = false;
  }

  /* ---------- 로그인 / 회원가입 / 로그아웃 ---------- */
  async function doLogin(id, password) {
    var errEl = $('loginError');
    errEl.textContent = '';
    var btn = $('loginSubmit');
    btn.disabled = true; btn.textContent = '로그인 중...';
    try {
      var res = await apiFetch('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ id: id, password: password })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) { errEl.textContent = data.error || '로그인에 실패했습니다.'; return; }
      setToken(data.token);
      await boot(); // /me + settings 로드 후 앱 노출
    } catch (e) {
      errEl.textContent = '네트워크 오류가 발생했습니다.';
    } finally {
      btn.disabled = false; btn.textContent = '로그인';
    }
  }

  async function doSignup(form) {
    var errEl = $('signupError');
    errEl.textContent = '';
    var btn = $('signupSubmit');
    btn.disabled = true; btn.textContent = '가입 중...';
    try {
      var body = JSON.stringify({
        name: form.name, id: form.id, school: form.school,
        password: form.password, gender: form.gender, gpa: Number(form.gpa)
      });
      var res = await apiFetch('/api/auth/signup', { method: 'POST', body: body });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) { errEl.textContent = data.error || '회원가입에 실패했습니다.'; return; }
      // 승인 대기 안내
      $('signupForm').hidden = true;
      var done = $('signupDone');
      done.hidden = false;
      done.querySelector('.sd-name').textContent = form.name;
    } catch (e) {
      errEl.textContent = '네트워크 오류가 발생했습니다.';
    } finally {
      btn.disabled = false; btn.textContent = '회원가입';
    }
  }

  async function logout() {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (e) { /* noop */ }
    setToken(null);
    user = null;
    setSettings({ interested: [], applying: [] });
    showGate('login');
  }

  /* ---------- 부팅: 토큰 검증 + 설정 로드 ---------- */
  async function boot() {
    if (!token) { showGate('login'); return; }
    try {
      var meRes = await apiFetch('/api/auth/me');
      if (!meRes.ok) { setToken(null); showGate('login'); return; }
      user = await meRes.json();
      var sRes = await apiFetch('/api/settings');
      if (sRes.ok) setSettings(await sRes.json());
      else setSettings({ interested: [], applying: [] });
      showApp();
    } catch (e) {
      // 네트워크 오류: 로그인 화면으로 (토큰은 유지해 재시도 가능)
      showGate('login');
      var el = $('loginError');
      if (el) el.textContent = '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.';
    }
  }

  /* ---------- 게이트 마크업 배선 ---------- */
  function wireGate() {
    // 학교 select 채우기
    var sel = $('suSchool');
    if (sel) {
      sel.innerHTML = '<option value="">학교를 선택하세요</option>' +
        SCHOOLS.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
    }
    // 로그인 폼
    var lf = $('loginForm');
    if (lf) lf.addEventListener('submit', function (e) {
      e.preventDefault();
      doLogin($('liId').value.trim(), $('liPw').value);
    });
    // 회원가입 폼
    var sf = $('signupForm');
    if (sf) sf.addEventListener('submit', function (e) {
      e.preventDefault();
      doSignup({
        name: $('suName').value.trim(),
        id: $('suId').value.trim(),
        school: $('suSchool').value,
        password: $('suPw').value,
        gender: currentGender,
        gpa: $('suGpa').value
      });
    });
    // 성별 토글
    var currentGender = '';
    var gBtns = document.querySelectorAll('#suGender button[data-g]');
    gBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        currentGender = b.dataset.g;
        gBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      });
    });
    // 로그인/가입 화면 전환 링크
    var toSignup = $('toSignup'), toLogin = $('toLogin');
    if (toSignup) toSignup.addEventListener('click', function (e) { e.preventDefault(); setGateMode('signup'); });
    if (toLogin) toLogin.addEventListener('click', function (e) { e.preventDefault(); setGateMode('login'); });
    var toLoginDone = $('toLoginDone');
    if (toLoginDone) toLoginDone.addEventListener('click', function (e) { e.preventDefault(); setGateMode('login'); });
  }

  /* ---------- 공개 API ---------- */
  window.Susi = {
    apiFetch: apiFetch,
    getSettings: function () { return settings; },
    setSettings: setSettings,          // settings.js 저장 성공 후 갱신용
    getUser: function () { return user; },
    onSettingsChange: function (fn) { settingsListeners.push(fn); },
    isReady: function () { return !!user; }
  };

  document.addEventListener('DOMContentLoaded', function () {
    wireGate();
    boot();
  });
})();
