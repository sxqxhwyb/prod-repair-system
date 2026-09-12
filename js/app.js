/* ============================================================
 * 产线设备报修系统 - 统一工作台
 * 登录 → 操作工 / 维修员 / 管理员（左侧功能分区 + 右侧内容）
 * ============================================================ */
(function () {
  'use strict';
  var DB = window.RepairDB;
  var MY_ORDER_KEY = 'prod_repair_my_orders';
  var MY_FB_KEY = 'prod_repair_my_fbs';

  var ROLE_META = {
    operator:  { name: '操作工', cls: 'operator',  sub: '操作工工作台' },
    repairman: { name: '维修员', cls: 'repairman', sub: '维修员工作台' },
    admin:     { name: '管理员', cls: 'admin',     sub: '设备管理后台' }
  };

  var MENUS = {
    operator: [
      { group: '报修服务', items: [
        { key: 'home', icon: '🏠', label: '系统首页' },
        { key: 'report', icon: '📝', label: '设备报修' },
        { key: 'mine', icon: '📋', label: '我的报修', badge: 'mineActive' }
      ]},
      { group: '信息查询', items: [
        { key: 'equip', icon: '🏭', label: '设备信息' },
        { key: 'notice', icon: '📢', label: '通知公告' },
        { key: 'feedback', icon: '💬', label: '试用反馈' }
      ]}
    ],
    repairman: [
      { group: '维修作业', items: [
        { key: 'home', icon: '🏠', label: '工作台首页' },
        { key: 'wall', icon: '🔔', label: '待接工单', badge: 'pending' },
        { key: 'myrepairs', icon: '🛠️', label: '我的维修' },
        { key: 'ratefb', icon: '⭐', label: '维修反馈' }
      ]},
      { group: '信息查询', items: [
        { key: 'equip', icon: '🏭', label: '设备信息' },
        { key: 'notice', icon: '📢', label: '通知公告' },
        { key: 'feedback', icon: '💬', label: '试用反馈' }
      ]}
    ],
    admin: [
      { group: '运营管理', items: [
        { key: 'home', icon: '🏠', label: '系统首页' },
        { key: 'stats', icon: '📊', label: '数据统计' },
        { key: 'orders', icon: '📋', label: '工单管理', badge: 'pending' },
        { key: 'records', icon: '📁', label: '维修记录' }
      ]},
      { group: '基础配置', items: [
        { key: 'equip', icon: '🏷️', label: '设备台账' },
        { key: 'workers', icon: '👷', label: '维修人员' },
        { key: 'notice', icon: '📢', label: '公告管理' },
        { key: 'feedback', icon: '💬', label: '反馈管理', badge: 'unreplied' }
      ]}
    ]
  };

  var PAGE_TITLES = {
    home: '系统首页', report: '设备报修', mine: '我的报修', wall: '待接工单',
    myrepairs: '我的维修', ratefb: '维修反馈', equip: '设备信息',
    notice: '通知公告', feedback: '试用反馈', stats: '数据统计',
    orders: '工单管理', records: '维修记录', workers: '维修人员'
  };

  var state = {
    role: null,
    page: 'home',
    orderFilter: 'all',
    kw: '',
    detailId: null,
    rateScore: 0,
    form: { line: '', equipType: '', level: 'normal', images: [] },
    fbType: 'suggest',
    scanEquip: null,      // 扫码绑定的主设备对象
    pendingScanNo: null   // 未登录时扫码携带的设备编号
  };

  /* ---------- 工具 ---------- */
  function $(s, ctx) { return (ctx || document).querySelector(s); }
  function $all(s, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(s)); }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getMyIds(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function addMyId(key, id) {
    var arr = getMyIds(key);
    if (arr.indexOf(id) === -1) { arr.push(id); localStorage.setItem(key, JSON.stringify(arr)); }
  }
  function statusTag(s) {
    var st = DB.STATUS[s];
    return '<span class="status-tag" style="background:' + st.bg + ';color:' + st.color + '">' + st.name + '</span>';
  }
  function lineTag(lineId) {
    var l = DB.getLine(lineId);
    return '<span class="line-tag" style="background:' + l.color + '1a;color:' + l.color + ';border:1px solid ' + l.color + '55">' + esc(l.name) + '</span>';
  }
  function modeTag(o) {
    if (o.status === 'pending') return '';
    return o.mode === 'assign'
      ? '<span class="mode-tag assign">管理员指派</span>'
      : '<span class="mode-tag grab">维修员抢单</span>';
  }
  function starsHTML(n) {
    var s = '';
    for (var i = 0; i < 5; i++) s += i < n ? '★' : '<span class="star-gray">★</span>';
    return '<span class="stars">' + s + '</span>';
  }

  /* ---------- 扫码报修路由（二维码自包含设备信息，跨设备无需后台同步） ----------
     短码（旧/兼容）：#/report?eq=主设备编号
     全码（新）：     #/report?eq=编号&l=产线&t=设备类型&w=工位&n=设备名称
  -------------------------------------------------- */
  // 生成二维码内容：完整设备信息全部编码进 URL（本地/公网自适应）
  function scanUrl(eq) {
    var q = '#/report?eq=' + encodeURIComponent(eq.no);
    if (eq.line) q += '&l=' + encodeURIComponent(eq.line);
    if (eq.equipType) q += '&t=' + encodeURIComponent(eq.equipType);
    if (eq.workstation) q += '&w=' + encodeURIComponent(eq.workstation);
    if (eq.name) q += '&n=' + encodeURIComponent(eq.name);
    return location.origin + location.pathname + q;
  }
  // 解析扫码 hash 为 payload 对象
  function readScanPayload() {
    var m = (location.hash || '').match(/^#\/report\?(.+)$/);
    if (!m) return null;
    var p = {};
    m[1].split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i <= 0) return;
      var k = kv.slice(0, i);
      try { p[k] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); }
      catch (e) { p[k] = kv.slice(i + 1); }
    });
    if (!p.eq) return null;
    return {
      no: String(p.eq).trim(),
      line: p.l || '', equipType: p.t || '',
      workstation: p.w || '', name: p.n || ''
    };
  }
  function readScanHash() {
    var p = readScanPayload();
    return p ? p.no : null;
  }
  // 解析扫码设备：优先本地台账；查不到但二维码携带了完整信息时，自动登记到本机台账（跨设备"同步"）
  function resolveScanEquip(p) {
    if (!p || !p.no) return null;
    var local = DB.getEquipmentByNo(p.no);
    if (local) return local;
    var lineOk = DB.LINES.some(function (l) { return l.id === p.line; });
    var typeOk = DB.EQUIP_TYPES.some(function (t) { return t.id === p.equipType; });
    if (lineOk && typeOk && p.workstation) {
      var res = DB.addEquipment({
        no: p.no, name: p.name, line: p.line,
        equipType: p.equipType, workstation: p.workstation
      });
      if (res.ok) return res.equipment;
    }
    return null;
  }
  function showLoginScanTip(p) {
    var box = $('#login-scan-tip');
    if (!box) return;
    if (typeof p === 'string') p = { no: p };
    var eq = resolveScanEquip(p);
    var msg = eq
      ? '📷 扫码报修：设备 <b class="mono">' + esc(eq.no) + '</b>（' + esc(eq.name) + '）。请以操作工身份输入姓名进入，设备信息将自动带出。'
      : '📷 扫码报修：设备编号 <b class="mono">' + esc(p.no) + '</b> 尚未在台账中登记，进入后请核对设备信息。';
    box.innerHTML = msg + '<span id="scan-tip-close" title="关闭">×</span>';
    box.style.display = 'flex';
    var x = $('#scan-tip-close');
    if (x) x.onclick = function () { box.style.display = 'none'; state.pendingScanNo = null; history.replaceState(null, '', location.pathname + location.search); };
    // 扫码默认是操作工场景，自动切到操作工 tab
    var opTab = document.querySelector('.login-role[data-role="operator"]');
    if (opTab && !$('#pane-operator').classList.contains('active')) opTab.click();
    $('#lg-op-name') && $('#lg-op-name').focus();
  }
  function hideLoginScanTip() {
    var box = $('#login-scan-tip');
    if (box) box.style.display = 'none';
  }
  // 已登录 / 登录后：应用扫码目标
  function applyPendingScan() {
    var p = readScanPayload();
    if (!p) return false;
    var eq = resolveScanEquip(p);
    state.page = 'report';
    if (eq) {
      state.scanEquip = eq;
    } else {
      state.scanEquip = null;
      toast('设备编号「' + p.no + '」不在台账，请手动选择设备信息');
    }
    hideLoginScanTip();
    renderMenu();
    renderPage();
    renderBell();
    return true;
  }
  function clearScan(keepHash) {
    state.scanEquip = null;
    state.pendingScanNo = null;
    hideLoginScanTip();
    if (!keepHash && location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  /* ============================================================
   * 登录
   * ============================================================ */
  function initLogin() {
    // 身份切换
    $all('.login-role').forEach(function (el) {
      el.onclick = function () {
        $all('.login-role').forEach(function (x) { x.classList.remove('active'); });
        el.classList.add('active');
        $all('.login-pane').forEach(function (p) { p.classList.remove('active'); });
        $('#pane-' + el.dataset.role).classList.add('active');
      };
    });

    // 维修员下拉
    $('#lg-rp-select').innerHTML = DB.listWorkers().map(function (w) {
      return '<option value="' + w.id + '">' + esc(w.name) + '（' + esc(w.skill) + ' · 负责 ' + esc(w.scope) + '）</option>';
    }).join('');

    $('#btn-login-operator').onclick = loginOperator;
    $('#btn-login-repairman').onclick = loginRepairman;
    $('#btn-login-admin').onclick = loginAdmin;
    $all('.login-input').forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var pane = inp.closest('.login-pane');
          if (pane.id === 'pane-operator') loginOperator();
          if (pane.id === 'pane-repairman') loginRepairman();
          if (pane.id === 'pane-admin') loginAdmin();
        }
      });
    });
  }

  function loginOperator() {
    var name = $('#lg-op-name').value.trim();
    var phone = $('#lg-op-phone').value.trim();
    if (!name) { toast('请填写您的姓名'); $('#lg-op-name').focus(); return; }
    if (phone && !/^1\d{10}$/.test(phone)) { toast('请填写正确的 11 位手机号'); return; }
    enterShell({ type: 'operator', name: name, phone: phone });
  }
  function loginRepairman() {
    var wid = $('#lg-rp-select').value;
    var w = DB.getWorker(wid);
    if (!w) { toast('请选择维修员身份'); return; }
    enterShell({ type: 'repairman', workerId: w.id, name: w.name });
  }
  function loginAdmin() {
    var acc = $('#lg-ad-account').value.trim();
    var pwd = $('#lg-ad-pwd').value;
    if (acc !== 'admin' || pwd !== 'admin123') { toast('账号或密码错误（演示账号 admin / admin123）'); $('#lg-ad-pwd').value = ''; return; }
    enterShell({ type: 'admin', name: '设备管理员' });
  }

  function enterShell(role) {
    state.role = role;
    DB.setRole(role);
    state.page = 'home';
    $('#login-page').style.display = 'none';
    $('#app-shell').style.display = 'flex';
    var meta = ROLE_META[role.type];
    $('#side-role-sub').textContent = meta.sub;
    $('#top-role-tag').textContent = meta.name;
    $('#top-role-tag').className = 'top-role-tag ' + meta.cls;
    $('#top-username').textContent = role.name;
    $('#top-avatar').textContent = role.name.charAt(0);
    // 扫码进入：登录后直接打开已绑定设备的报修单（仅操作工）
    if (state.pendingScanNo || readScanHash()) {
      if (role.type !== 'operator') {
        toast('扫码报修仅限操作工身份使用，已为您忽略扫码信息');
        clearScan();
      } else {
        applyPendingScan();
        return;
      }
    }
    renderMenu();
    renderPage();
    renderBell();
  }

  function logout() {
    DB.clearRole();
    state.role = null;
    state.scanEquip = null;
    $('#app-shell').style.display = 'none';
    $('#login-page').style.display = 'flex';
    $('#lg-ad-pwd').value = '';
    var payload = readScanPayload();
    if (payload) { state.pendingScanNo = payload.no; showLoginScanTip(payload); } else hideLoginScanTip();
  }

  /* ============================================================
   * 菜单 / 布局
   * ============================================================ */
  function badgeValue(key) {
    if (key === 'pending') return DB.listOrders('pending').length;
    if (key === 'unreplied') return DB.listFeedbacks().filter(function (f) { return !f.reply; }).length;
    if (key === 'mineActive') {
      var ids = getMyIds(MY_ORDER_KEY);
      return DB.listOrders().filter(function (o) { return ids.indexOf(o.id) >= 0 && o.status !== 'done'; }).length;
    }
    return 0;
  }

  function renderMenu() {
    var groups = MENUS[state.role.type];
    $('#side-menu').innerHTML = groups.map(function (g) {
      return '<div class="menu-group-title">' + g.group + '</div>' +
        g.items.map(function (it) {
          var b = it.badge ? badgeValue(it.badge) : 0;
          return '<div class="menu-item' + (state.page === it.key ? ' active' : '') + '" data-go="' + it.key + '">' +
            '<span class="menu-icon">' + it.icon + '</span><span>' + it.label + '</span>' +
            (b ? '<span class="menu-badge">' + b + '</span>' : '') + '</div>';
        }).join('');
    }).join('');
    $all('#side-menu .menu-item').forEach(function (el) {
      el.onclick = function () { goPage(el.dataset.go); };
    });
  }

  function goPage(key, filter) {
    // 从菜单正常进入 = 退出扫码绑定模式（扫码入口走 applyPendingScan）
    if (state.scanEquip || state.pendingScanNo || readScanHash()) clearScan();
    state.page = key;
    state.orderFilter = filter || 'all';
    state.kw = '';
    renderMenu();
    renderPage();
    renderBell();
  }

  function refreshAll() {
    renderMenu();
    renderPage();
    renderBell();
  }

  function renderPage() {
    var p = state.page;
    var title = PAGE_TITLES[p] || '系统首页';
    if (p === 'equip' && state.role.type === 'admin') title = '设备台账';
    $('#top-title').textContent = title;
    $('#top-crumb').textContent = '首页 / ' + title;
    var c = $('#content');
    if (p === 'home') renderHome(c);
    else if (p === 'report') renderReport(c);
    else if (p === 'mine') renderMine(c);
    else if (p === 'wall') renderWall(c);
    else if (p === 'myrepairs') renderMyRepairs(c);
    else if (p === 'ratefb') renderRateFb(c);
    else if (p === 'equip') renderEquip(c);
    else if (p === 'notice') renderNotice(c);
    else if (p === 'feedback') renderFeedback(c);
    else if (p === 'stats') renderStats(c);
    else if (p === 'orders') renderOrders(c);
    else if (p === 'records') renderRecords(c);
    else if (p === 'workers') renderWorkers(c);
    window.scrollTo(0, 0);
  }

  function bellCount() {
    var t = state.role.type;
    if (t === 'repairman') return badgeValue('pending');
    if (t === 'admin') return badgeValue('pending') + badgeValue('unreplied');
    return badgeValue('mineActive');
  }
  function renderBell() {
    if (!state.role) return;
    var n = bellCount();
    var el = $('#bell-badge');
    if (n > 0) { el.style.display = 'inline-block'; el.textContent = n; }
    else el.style.display = 'none';
  }

  /* ============================================================
   * 系统首页（三角色各自视角）
   * ============================================================ */
  function renderHome(c) {
    var r = state.role;
    var statsHtml = '', quickHtml = '';

    if (r.type === 'operator') {
      var ids = getMyIds(MY_ORDER_KEY);
      var mine = DB.listOrders().filter(function (o) { return ids.indexOf(o.id) >= 0; });
      var p = mine.filter(function (o) { return o.status === 'pending'; }).length;
      var d = mine.filter(function (o) { return o.status === 'processing'; }).length;
      var dn = mine.filter(function (o) { return o.status === 'done'; }).length;
      statsHtml = statRow([
        ['📋', 'b1', mine.length, '我的报修总数'],
        ['⏳', 'b2', p, '待处理'],
        ['🔨', 'b3', d, '处理中'],
        ['✅', 'b4', dn, '已完成']
      ]);
      quickHtml = quickGrid([
        ['📝', '设备报修', '填报设备故障', 'report'],
        ['📋', '我的报修', '跟踪维修进度', 'mine'],
        ['📢', '通知公告', '查看系统通知', 'notice'],
        ['💬', '试用反馈', '提建议报问题', 'feedback']
      ]);
    } else if (r.type === 'repairman') {
      var pending = DB.listOrders('pending').length;
      var myAll = DB.listByWorker(r.workerId);
      var doing = myAll.filter(function (o) { return o.status === 'processing'; }).length;
      var done = myAll.filter(function (o) { return o.status === 'done'; }).length;
      var w = DB.getWorker(r.workerId);
      statsHtml = statRow([
        ['🔔', 'b2', pending, '待接工单'],
        ['🔨', 'b3', doing, '我处理中'],
        ['✅', 'b4', done, '我已完成'],
        ['⭐', 'b8', w.rating.toFixed(1), '我的服务评分']
      ]);
      quickHtml = quickGrid([
        ['🔔', '待接工单', '抢单处理故障', 'wall'],
        ['🛠️', '我的维修', '记录处理过程', 'myrepairs'],
        ['⭐', '维修反馈', '查看报修人评价', 'ratefb'],
        ['💬', '试用反馈', '提建议报问题', 'feedback']
      ]);
    } else {
      var s = DB.stats();
      statsHtml = statRow([
        ['📋', 'b1', s.total, '工单总数'],
        ['⏳', 'b2', s.pending, '待处理'],
        ['🔨', 'b3', s.processing, '处理中'],
        ['✅', 'b4', s.done, '已完成 · 闭环率 ' + s.closeRate]
      ]);
      quickHtml = quickGrid([
        ['📊', '数据统计', '查看图表分析', 'stats'],
        ['📋', '工单管理', '指派维修工单', 'orders'],
        ['👷', '维修人员', '人员配置管理', 'workers'],
        ['📢', '公告管理', '发布系统通知', 'notice']
      ]);
    }

    c.innerHTML =
      statsHtml +
      '<div class="page-grid-21">' +
        '<div class="card"><div class="card-title">最新公告</div><div id="home-notices">' + noticeListHTML(2) + '</div></div>' +
        '<div class="card"><div class="card-title">快捷操作</div>' + quickHtml + '</div>' +
      '</div>';

    $all('#content [data-go]').forEach(function (el) {
      el.onclick = function () { goPage(el.dataset.go); };
    });
  }

  function statRow(items) {
    return '<div class="stat-row">' + items.map(function (it) {
      return '<div class="stat-card"><div class="stat-ico ' + it[1] + '">' + it[0] + '</div>' +
        '<div><b>' + it[2] + '</b><span>' + it[3] + '</span></div></div>';
    }).join('') + '</div>';
  }
  function quickGrid(items) {
    return '<div class="quick-grid">' + items.map(function (q) {
      return '<div class="quick-item" data-go="' + q[3] + '"><div class="qi-icon">' + q[0] + '</div>' +
        '<b>' + q[1] + '</b><span>' + q[2] + '</span></div>';
    }).join('') + '</div>';
  }
  function noticeListHTML(limit) {
    var list = DB.listNotices();
    if (limit) list = list.slice(0, limit);
    if (!list.length) return '<div class="table-empty">暂无公告</div>';
    return list.map(function (n) {
      return '<div class="notice-item"><h4><span class="notice-tag">公告</span>' + esc(n.title) + '</h4>' +
        '<p>' + esc(n.content) + '</p><div class="notice-meta">' + esc(n.author) + ' · ' + DB.fmtTime(n.t) + '</div></div>';
    }).join('');
  }

  /* ============================================================
   * 操作工 - 设备报修表单
   * ============================================================ */
  function renderReport(c) {
    var scan = state.scanEquip;
    state.form = {
      line: scan ? scan.line : '',
      equipType: scan ? scan.equipType : '',
      level: 'normal', images: []
    };
    var scanBar = scan
      ? '<div class="scan-bar">' +
          '<span class="scan-ico">📷</span>' +
          '<div class="scan-info"><b>已扫码绑定主设备：<span class="mono">' + esc(scan.no) + '</span></b>' +
          '<span>' + esc(scan.name) + ' ｜ 产线 / 类型 / 工位已自动带出且不可修改，只需填写故障信息</span></div>' +
          '<span class="scan-unbind" id="f-unbind">取消绑定<br>手动填写</span>' +
        '</div>'
      : '';
    var locked = scan ? ' readonly' : '';
    var lockedCls = scan ? ' locked-input' : '';
    var dataList = '<datalist id="equip-nos">' + DB.listEquipments().map(function (e) {
      return '<option value="' + esc(e.no) + '">' + esc(e.name) + '｜' + esc(DB.getLine(e.line).name) + '</option>';
    }).join('') + '</datalist>';
    c.innerHTML =
      scanBar +
      '<div class="card"><div class="card-title">设备报修单</div>' +
      dataList +
      '<div class="form-grid">' +
        '<div class="f-item full"><label>所属产线 <em>*</em></label><div class="f-ctl"><div class="opt-row' + (scan ? ' locked' : '') + '" id="f-line"></div></div></div>' +
        '<div class="f-item full"><label>设备类型 <em>*</em></label><div class="f-ctl"><div class="opt-row' + (scan ? ' locked' : '') + '" id="f-equip"></div></div></div>' +
        '<div class="f-item full"><label>故障等级</label><div class="f-ctl"><div class="opt-row" id="f-level">' +
          '<div class="opt-chip active" data-v="normal">一般故障</div>' +
          '<div class="opt-chip danger" data-v="urgent">🚨 紧急·停机</div>' +
        '</div></div></div>' +
        '<div class="f-item"><label>设备编号 <em>*</em></label><div class="f-ctl"><input class="f-input' + lockedCls + '" id="f-equipno" list="equip-nos"' + locked + ' value="' + (scan ? esc(scan.no) : '') + '" placeholder="如：ZS-120T-03（见设备铭牌/二维码）">' +
          (scan ? '' : '<div class="f-tip">可直接输入或选择已绑定的主设备编号，自动带出设备信息</div>') + '</div></div>' +
        '<div class="f-item"><label>工位 <em>*</em></label><div class="f-ctl"><input class="f-input' + lockedCls + '" id="f-station"' + locked + ' value="' + (scan ? esc(scan.workstation) : '') + '" placeholder="如：注塑车间 03 号位"></div></div>' +
        '<div class="f-item full"><label>故障现象 <em>*</em></label><div class="f-ctl"><textarea class="f-textarea" id="f-fault" maxlength="300" placeholder="请描述故障现象：异响 / 卡料 / 报警 / 尺寸异常等…"></textarea>' +
          '<div class="f-tip">描述越清楚，维修员判断越快，紧急停机请同时电话联系维修班</div></div></div>' +
        '<div class="f-item full"><label>故障照片</label><div class="f-ctl"><div class="img-uploader" id="f-imgs">' +
          '<input type="file" id="f-file" accept="image/*" multiple hidden>' +
          '<div class="img-add-btn" id="f-imgadd"><b>＋</b><span>拍照/相册</span></div></div>' +
          '<div class="f-tip">最多上传 3 张，用于故障佐证</div></div></div>' +
        '<div class="f-item"><label>报修人 <em>*</em></label><div class="f-ctl"><input class="f-input" id="f-name" value="' + esc(state.role.name || '') + '" placeholder="您的姓名"></div></div>' +
        '<div class="f-item"><label>联系电话</label><div class="f-ctl"><input class="f-input" id="f-phone" type="tel" maxlength="11" value="' + esc(state.role.phone || '') + '" placeholder="选填，方便维修员联系"></div></div>' +
      '</div>' +
      '<div style="text-align:center;margin-top:8px"><button class="btn primary" id="f-submit" style="padding:11px 46px;font-size:15px">📤 提交报修</button></div>' +
      '</div>';

    // 产线 / 设备类型选项（扫码模式自动选中并锁定）
    $('#f-line').innerHTML = DB.LINES.map(function (l) {
      return '<div class="opt-chip' + (scan && l.id === scan.line ? ' active' : '') + '" data-id="' + l.id + '">' + esc(l.name) + '</div>';
    }).join('');
    $('#f-equip').innerHTML = DB.EQUIP_TYPES.map(function (t) {
      return '<div class="opt-chip' + (scan && t.id === scan.equipType ? ' active' : '') + '" data-id="' + t.id + '">' + t.icon + ' ' + esc(t.name) + '</div>';
    }).join('');

    function setActiveChip(containerId, id) {
      $all('#' + containerId + ' .opt-chip').forEach(function (x) {
        x.classList.toggle('active', x.dataset.id === id);
      });
    }
    $all('#f-line .opt-chip').forEach(function (el) {
      el.onclick = function () {
        if (state.scanEquip) return;
        state.form.line = el.dataset.id;
        setActiveChip('f-line', el.dataset.id);
      };
    });
    $all('#f-equip .opt-chip').forEach(function (el) {
      el.onclick = function () {
        if (state.scanEquip) return;
        state.form.equipType = el.dataset.id;
        setActiveChip('f-equip', el.dataset.id);
      };
    });
    $all('#f-level .opt-chip').forEach(function (el) {
      el.onclick = function () {
        state.form.level = el.dataset.v;
        $all('#f-level .opt-chip').forEach(function (x) { x.classList.remove('active'); });
        el.classList.add('active');
      };
    });

    // 手动模式：输入已绑定的主设备编号 → 自动带出全部设备信息
    if (!scan) {
      $('#f-equipno').addEventListener('blur', function () {
        var eq = DB.getEquipmentByNo(this.value);
        if (!eq) return;
        this.value = eq.no;
        state.form.line = eq.line;
        state.form.equipType = eq.equipType;
        setActiveChip('f-line', eq.line);
        setActiveChip('f-equip', eq.equipType);
        if (!$('#f-station').value.trim()) $('#f-station').value = eq.workstation;
        toast('已匹配台账主设备「' + eq.no + '」，设备信息自动带出');
      });
    }

    // 取消扫码绑定，转为手动填写
    var unbind = $('#f-unbind');
    if (unbind) unbind.onclick = function () {
      clearScan();
      renderPage();
    };

    // 图片上传
    $('#f-imgadd').onclick = function () { $('#f-file').click(); };
    $('#f-file').onchange = function () {
      var files = Array.prototype.slice.call(this.files);
      files.slice(0, 3 - state.form.images.length).forEach(function (file) {
        DB.compressImage(file).then(function (data) {
          state.form.images.push(data);
          renderThumbs();
        });
      });
      this.value = '';
    };
    function renderThumbs() {
      var html = state.form.images.map(function (src, i) {
        return '<div class="img-thumb"><img src="' + src + '" data-src="' + i + '"><div class="img-del" data-del="' + i + '">×</div></div>';
      }).join('');
      var add = state.form.images.length < 3
        ? '<input type="file" id="f-file" accept="image/*" multiple hidden><div class="img-add-btn" id="f-imgadd"><b>＋</b><span>拍照/相册</span></div>' : '';
      $('#f-imgs').innerHTML = html + add + '<div class="f-tip" style="width:100%">最多上传 3 张，用于故障佐证</div>';
      $('#f-imgadd') && ($('#f-imgadd').onclick = function () { $('#f-file').click(); });
      $('#f-file') && ($('#f-file').onchange = function () {
        var fs = Array.prototype.slice.call(this.files);
        fs.slice(0, 3 - state.form.images.length).forEach(function (file) {
          DB.compressImage(file).then(function (data) { state.form.images.push(data); renderThumbs(); });
        });
        this.value = '';
      });
      $all('#f-imgs .img-del').forEach(function (d) {
        d.onclick = function () { state.form.images.splice(Number(d.dataset.del), 1); renderThumbs(); };
      });
      $all('#f-imgs img').forEach(function (img) {
        img.onclick = function () { showViewer(state.form.images[Number(img.dataset.src)]); };
      });
    }

    $('#f-submit').onclick = function () {
      if (!state.form.line) { toast('请选择所属产线'); return; }
      if (!state.form.equipType) { toast('请选择设备类型'); return; }
      var equipNo = $('#f-equipno').value.trim();
      var station = $('#f-station').value.trim();
      var fault = $('#f-fault').value.trim();
      var name = $('#f-name').value.trim();
      var phone = $('#f-phone').value.trim();
      if (!equipNo) { toast('请填写设备编号'); return; }
      if (!station) { toast('请填写工位'); return; }
      if (!fault) { toast('请描述故障现象'); return; }
      if (!name) { toast('请填写报修人姓名'); return; }
      if (phone && !/^1\d{10}$/.test(phone)) { toast('联系电话格式不正确'); return; }
      var o = DB.createOrder({
        line: state.form.line, equipType: state.form.equipType,
        equipNo: equipNo, workstation: station, level: state.form.level,
        fault: fault, images: state.form.images, reporter: name, phone: phone
      });
      addMyId(MY_ORDER_KEY, o.id);
      state.role.name = name; state.role.phone = phone;
      DB.setRole(state.role);
      clearScan();
      toast('报修提交成功，已通知维修班！');
      goPage('mine');
    };
  }

  /* ============================================================
   * 工单列表（操作工我的报修 / 维修员待接 / 我的维修）
   * ============================================================ */
  function listTabsHTML(mode) {
    var tabs = mode === 'wall'
      ? [['all', '全部待接']]
      : mode === 'mine'
        ? [['all', '全部'], ['pending', '待处理'], ['processing', '处理中'], ['done', '已完成']]
        : [['processing', '处理中'], ['done', '已完成'], ['all', '全部']];
    var cur = state.orderFilter;
    if (!tabs.some(function (t) { return t[0] === cur; })) cur = tabs[0][0];
    return '<div class="filter-bar"><div class="filter-tabs">' +
      tabs.map(function (t) {
        return '<div class="f-tab' + (cur === t[0] ? ' active' : '') + '" data-s="' + t[0] + '">' + t[1] + '</div>';
      }).join('') + '</div></div>';
  }

  function orderCardHTML(o, actions) {
    var eq = DB.getEquipType(o.equipType);
    return '<div class="order-card2 ' + o.status + (o.level === 'urgent' ? ' urgent' : '') + '" data-detail="' + o.id + '">' +
      '<div class="oc2-head"><div class="oc2-title"><span class="oc2-eq">' + eq.icon + '</span><b>' + esc(o.equipNo) + '</b>' +
        '<span class="mono">' + esc(o.no) + '</span></div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
        (o.level === 'urgent' ? '<span class="urgent-tag">紧急·停机</span>' : '<span class="normal-tag">一般故障</span>') +
        statusTag(o.status) + '</div></div>' +
      '<div class="oc2-meta">' + lineTag(o.line) + '<span class="muted">📍 ' + esc(o.workstation) + '</span>' + modeTag(o) + '</div>' +
      '<p class="oc2-fault">' + esc(o.fault) + '</p>' +
      '<div class="oc2-foot"><span class="muted">报修人：' + esc(o.reporter) +
      (o.workerId ? ' · 维修员：' + esc(DB.getWorker(o.workerId).name) : '') +
      ' · ' + DB.fmtTime(o.createTime) + '</span>' +
      '<div class="oc2-actions">' + actions + '</div></div></div>';
  }

  function bindOrderList(container) {
    $all('[data-detail]', container).forEach(function (el) {
      el.onclick = function (e) {
        if (e.target.closest('.btn')) return;
        openOrderDetail(el.dataset.detail);
      };
    });
  }

  function renderMine(c) {
    var ids = getMyIds(MY_ORDER_KEY);
    var list = DB.listOrders().filter(function (o) { return ids.indexOf(o.id) >= 0; });
    if (state.orderFilter !== 'all') list = list.filter(function (o) { return o.status === state.orderFilter; });
    c.innerHTML = listTabsHTML('mine') +
      '<div class="card"><div class="card-title">我的报修（' + list.length + '）</div>' +
      (list.length ? '<div class="order-list">' + list.map(function (o) {
        var act = o.status === 'done' && o.rating === 0
          ? '<button class="btn warning sm" data-rate="' + o.id + '">⭐ 立即评价</button>' : '';
        return orderCardHTML(o, '<button class="btn sm" data-detail="' + o.id + '">查看详情</button>' + act);
      }).join('') + '</div>' : '<div class="empty-box"><div class="empty-icon">📭</div>暂无报修记录，点击左侧「设备报修」发起报修</div>') +
      '</div>';
    bindListTabs(c);
    bindOrderList(c);
    $all('[data-rate]', c).forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); openRateDialog(b.dataset.rate); };
    });
  }

  function renderWall(c) {
    var list = DB.listOrders('pending');
    c.innerHTML = listTabsHTML('wall') +
      '<div class="card"><div class="card-title">待接工单（' + list.length + '）<span class="muted" style="font-weight:400;font-size:12px">报修通知已自动推送，点击卡片可查看详情或直接抢单</span></div>' +
      (list.length ? '<div class="order-list">' + list.map(function (o) {
        return orderCardHTML(o, '<button class="btn primary sm" data-grab="' + o.id + '">🔧 抢单</button>' +
          '<button class="btn sm" data-detail="' + o.id + '">详情</button>');
      }).join('') + '</div>' : '<div class="empty-box"><div class="empty-icon">🎉</div>当前没有待接工单，新报修将自动通知</div>') +
      '</div>';
    bindOrderList(c);
    $all('[data-grab]', c).forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        doGrab(b.dataset.grab);
      };
    });
  }

  function renderMyRepairs(c) {
    var list = DB.listByWorker(state.role.workerId);
    if (state.orderFilter !== 'all') list = list.filter(function (o) { return o.status === state.orderFilter; });
    list = list.filter(function (o) { return o.status !== 'pending'; });
    c.innerHTML = listTabsHTML('myrepairs') +
      '<div class="card"><div class="card-title">我的维修（' + list.length + '）</div>' +
      (list.length ? '<div class="order-list">' + list.map(function (o) {
        var act = '';
        if (o.status === 'processing') {
          act = '<button class="btn success sm" data-complete="' + o.id + '">✅ 完成维修</button>' +
                '<button class="btn sm" data-detail="' + o.id + '">处理记录</button>';
        } else {
          act = '<button class="btn sm" data-detail="' + o.id + '">查看详情</button>';
        }
        return orderCardHTML(o, act);
      }).join('') + '</div>' : '<div class="empty-box"><div class="empty-icon">🛠️</div>暂无相关工单，可到「待接工单」抢单</div>') +
      '</div>';
    bindListTabs(c);
    bindOrderList(c);
    $all('[data-complete]', c).forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); openCompleteDialog(b.dataset.complete); };
    });
  }

  function renderRateFb(c) {
    var list = DB.listByWorker(state.role.workerId).filter(function (o) { return o.status === 'done'; });
    c.innerHTML = '<div class="card"><div class="card-title">报修人评价（' + list.length + '）<span class="muted" style="font-weight:400;font-size:12px">维修完成后报修人可评分，您可回复感谢与说明</span></div>' +
      (list.length ? '<div class="order-list">' + list.map(function (o) {
        var body;
        if (o.rating > 0) {
          body = '<div class="info-block yellow"><h4>' + starsHTML(o.rating) + ' 报修人评价</h4>' +
            '<p>' + esc(o.reporter) + '：' + (esc(o.ratingText) || '感谢反馈') + '</p>' +
            (o.workerReply ? '<div class="info-block blue" style="margin:8px 0 0"><h4>我的回复</h4><p>' + esc(o.workerReply) + '</p></div>' : '') +
            '</div>';
        } else {
          body = '<div class="info-block"><h4>⏳ 待评价</h4><p>报修人 ' + esc(o.reporter) + ' 暂未提交评价</p></div>';
        }
        return '<div class="order-card2 done" data-detail="' + o.id + '">' +
          '<div class="oc2-head"><div class="oc2-title"><span class="oc2-eq">' + DB.getEquipType(o.equipType).icon + '</span><b>' + esc(o.equipNo) + '</b><span class="mono">' + esc(o.no) + '</span></div>' + statusTag('done') + '</div>' +
          body +
          '<div class="oc2-foot"><span class="muted">' + esc(o.reporter) + ' · ' + DB.fmtTime(o.completeTime) + '</span>' +
          '<div class="oc2-actions">' +
          (o.rating > 0 && !o.workerReply ? '<button class="btn primary sm" data-rep="' + o.id + '">回复评价</button>' : '') +
          '<button class="btn sm" data-detail="' + o.id + '">查看工单</button></div></div></div>';
      }).join('') + '</div>' : '<div class="empty-box"><div class="empty-icon">⭐</div>暂无已完成工单</div>') +
      '</div>';
    bindOrderList(c);
    $all('[data-rep]', c).forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); openRatingReplyDialog(b.dataset.rep); };
    });
  }

  function bindListTabs(c) {
    $all('.f-tab', c).forEach(function (t) {
      t.onclick = function () {
        state.orderFilter = t.dataset.s;
        renderPage();
      };
    });
  }

  function doGrab(orderId) {
    if (DB.grab(orderId, state.role.workerId)) {
      toast('抢单成功！请尽快前往现场');
      state.orderFilter = 'processing';
      refreshAll();
    } else {
      toast('手慢了，该工单已被接单');
      refreshAll();
    }
  }

  /* ============================================================
   * 设备台账 / 设备信息（管理员维护二维码绑定，其他角色查看）
   * ============================================================ */
  function renderEquip(c) {
    var isAdmin = state.role.type === 'admin';
    var all = DB.listOrders();
    var list = DB.listEquipments();

    var ledgerCard;
    if (isAdmin) {
      ledgerCard =
        '<div class="card"><div class="card-title">主设备台账（' + list.length + '）' +
          '<span class="title-actions"><span class="muted" style="font-weight:400;font-size:12px">二维码与主设备编号一一绑定，打印后张贴于设备上</span>' +
          '<button class="btn primary sm" id="eq-add">＋ 新增主设备</button></span></div>' +
          '<table class="data-table"><thead><tr>' +
          '<th>主设备编号</th><th>设备名称</th><th>设备类型</th><th>所属产线</th><th>工位</th><th>历史报修</th><th>操作</th>' +
          '</tr></thead><tbody id="eq-body"></tbody></table></div>';
    } else {
      ledgerCard =
        '<div class="card"><div class="card-title">主设备扫码报修（' + list.length + '）' +
          '<span class="muted" style="font-weight:400;font-size:12px">扫描设备上的二维码即可一键报修</span></div>' +
          '<div class="ledger-grid" id="eq-body">' +
          list.map(function (e) {
            var cnt = all.filter(function (o) { return o.equipNo.toUpperCase() === e.no.toUpperCase(); }).length;
            return '<div class="ledger-card">' +
              '<div class="lc-top"><span class="eq-icon">' + DB.getEquipType(e.equipType).icon + '</span>' +
              '<div><b class="mono">' + esc(e.no) + '</b><div class="muted">' + esc(e.name) + '</div></div>' +
              '<button class="btn primary sm" data-qr="' + e.id + '" style="margin-left:auto">📷 二维码</button></div>' +
              '<div class="lc-meta">' + lineTag(e.line) + '<span class="muted">📍 ' + esc(e.workstation) + '</span>' +
              '<span class="muted">历史报修 ' + cnt + ' 次</span></div></div>';
          }).join('') + '</div></div>';
    }

    c.innerHTML = ledgerCard +
      '<div class="card"><div class="card-title">产线 / 车间分布</div>' +
        '<div class="equip-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">' +
        DB.LINES.map(function (l) {
          var cnt = all.filter(function (o) { return o.line === l.id; }).length;
          return '<div class="line-card" style="background:linear-gradient(135deg,' + l.color + ',' + l.color + 'cc)">' +
            '<b>' + esc(l.name) + '</b><span>累计报修 ' + cnt + ' 单</span></div>';
        }).join('') + '</div></div>' +
      '<div class="card"><div class="card-title">设备类型分布</div>' +
        '<div class="equip-grid">' +
        DB.EQUIP_TYPES.map(function (t) {
          var cnt = all.filter(function (o) { return o.equipType === t.id; }).length;
          return '<div class="equip-card"><span class="eq-icon">' + t.icon + '</span><div><b>' + esc(t.name) + '</b><span>历史报修 ' + cnt + ' 次</span></div></div>';
        }).join('') + '</div></div>';

    if (isAdmin) {
      $('#eq-body').innerHTML = list.length ? list.map(function (e) {
        var cnt = all.filter(function (o) { return o.equipNo.toUpperCase() === e.no.toUpperCase(); }).length;
        return '<tr><td><b class="mono">🏷️ ' + esc(e.no) + '</b></td>' +
          '<td>' + esc(e.name) + '</td>' +
          '<td>' + DB.getEquipType(e.equipType).icon + ' ' + esc(DB.getEquipType(e.equipType).name) + '</td>' +
          '<td>' + lineTag(e.line) + '</td>' +
          '<td>' + esc(e.workstation) + '</td>' +
          '<td>' + cnt + ' 次</td>' +
          '<td class="nowrap">' +
            '<button class="btn primary sm" data-qr="' + e.id + '">📷 二维码</button>' +
            '<button class="btn sm" data-eqedit="' + e.id + '">编辑</button>' +
            '<button class="btn danger sm" data-eqdel="' + e.id + '">移除</button>' +
          '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="table-empty">暂无主设备，请先新增并绑定二维码</td></tr>';
      $('#eq-add').onclick = function () { openEquipmentDialog(null); };
      $all('#eq-body [data-eqedit]').forEach(function (b) {
        b.onclick = function () { openEquipmentDialog(DB.getEquipment(b.dataset.eqedit)); };
      });
      $all('#eq-body [data-eqdel]').forEach(function (b) {
        b.onclick = function () {
          var e = DB.getEquipment(b.dataset.eqdel);
          if (e && confirm('确认移除主设备「' + e.no + '」？其二维码将失效（不影响历史工单）。')) {
            DB.removeEquipment(e.id); toast('已移除'); renderPage();
          }
        };
      });
    }
    $all('#content [data-qr]').forEach(function (b) {
      b.onclick = function () { openQrDialog(DB.getEquipment(b.dataset.qr)); };
    });
  }

  /* ---------- 设备二维码弹窗（生成 / 打印 / 下载） ---------- */
  function openQrDialog(e) {
    if (!e) return;
    var url = scanUrl(e);
    var body =
      '<div class="qr-wrap">' +
        '<div id="qr-box" class="qr-box"></div>' +
        '<div class="qr-no mono">🏷️ ' + esc(e.no) + '</div>' +
        '<div class="qr-devname">' + DB.getEquipType(e.equipType).icon + ' ' + esc(e.name) + '</div>' +
        '<div class="qr-meta">' + lineTag(e.line) + ' <span class="muted">📍 ' + esc(e.workstation) + '</span></div>' +
      '</div>' +
      '<div class="qr-url" id="qr-url">' + esc(url) + '</div>' +
      '<p class="qr-tip">使用微信「扫一扫」或手机相机扫描此码，自动带出设备编号 / 产线 / 类型 / 工位，手机端一键报修<br>设备信息已写入二维码，任何手机扫码均可识别，无需提前在该手机上登记</p>';
    openDialog({
      title: '设备二维码 · ' + e.no, body: body,
      foot: '<button class="btn" data-close="1">关闭</button><button class="btn sm" id="qr-print">🖨️ 打印张贴</button><button class="btn primary sm" id="qr-download">⬇️ 下载 PNG</button>',
      onShow: function () {
        var box = $('#qr-box');
        box.innerHTML = '';
        try {
          new QRCode(box, {
            text: url, width: 248, height: 248,
            colorDark: '#0f172a', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });
        } catch (err) {
          box.innerHTML = '<div class="table-empty">二维码生成失败：' + esc(err.message) + '</div>';
        }
        function qrCanvas() { return $('#qr-box canvas') || $('#qr-box img'); }
        function qrDataUrl() {
          var cv = $('#qr-box canvas');
          if (cv) return cv.toDataURL('image/png');
          var im = $('#qr-box img');
          return im ? im.src : '';
        }
        $('#qr-download').onclick = function () {
          var src = qrDataUrl();
          if (!src) { toast('二维码未就绪'); return; }
          var a = document.createElement('a');
          a.href = src; a.download = '设备二维码-' + e.no + '.png';
          document.body.appendChild(a); a.click(); a.remove();
        };
        $('#qr-print').onclick = function () {
          var src = qrDataUrl();
          if (!src) { toast('二维码未就绪'); return; }
          var w = window.open('', '_blank');
          if (!w) { toast('浏览器拦截了打印窗口，请允许弹窗'); return; }
          w.document.write(
            '<!doctype html><html><head><meta charset="utf-8"><title>设备二维码 ' + esc(e.no) + '</title>' +
            '<style>body{font-family:\"Microsoft YaHei\",sans-serif;text-align:center;padding:36px;color:#1e293b}' +
            'img{width:320px;height:320px}.no{font-size:28px;font-weight:700;margin:16px 0 4px;font-family:Consolas,monospace}' +
            '.nm{font-size:16px}.mt{color:#64748b;font-size:13px;margin-top:6px}.tp{margin-top:20px;color:#94a3b8;font-size:12px}' +
            '</style></head><body><img src="' + src + '">' +
            '<div class="no">' + esc(e.no) + '</div><div class="nm">' + esc(e.name) + '</div>' +
            '<div class="mt">' + esc(DB.getLine(e.line).name) + ' · ' + esc(e.workstation) + '</div>' +
            '<div class="tp">微信 / 相机扫码 → 一键报修</div></body></html>'
          );
          w.document.close(); w.focus();
          setTimeout(function () { w.print(); }, 350);
        };
      }
    });
  }

  /* ---------- 新增 / 编辑主设备 ---------- */
  function openEquipmentDialog(e) {
    var isEdit = !!e;
    var body =
      '<label class="login-label">主设备编号 <em>*</em></label><input class="f-input" id="eq-no" maxlength="30" placeholder="如：ZS-120T-03（与设备铭牌一致，二维码绑定此编号）" value="' + (isEdit ? esc(e.no) : '') + '">' +
      (isEdit ? '<div class="f-tip" style="margin:4px 0 0">修改编号 / 工位 / 产线等信息后，已张贴的旧二维码不会自动更新，需重新生成并打印张贴</div>' : '') +
      '<label class="login-label">设备名称</label><input class="f-input" id="eq-name" maxlength="30" placeholder="如：120T注塑机（留空则取设备类型名）" value="' + (isEdit ? esc(e.name) : '') + '">' +
      '<label class="login-label">所属产线 <em>*</em></label><select class="f-input" id="eq-line">' +
        DB.LINES.map(function (l) { return '<option value="' + l.id + '"' + (isEdit && l.id === e.line ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') +
      '</select>' +
      '<label class="login-label">设备类型 <em>*</em></label><select class="f-input" id="eq-type">' +
        DB.EQUIP_TYPES.map(function (t) { return '<option value="' + t.id + '"' + (isEdit && t.id === e.equipType ? ' selected' : '') + '>' + t.icon + ' ' + esc(t.name) + '</option>'; }).join('') +
      '</select>' +
      '<label class="login-label">工位 <em>*</em></label><input class="f-input" id="eq-station" maxlength="40" placeholder="如：注塑车间 03 号位" value="' + (isEdit ? esc(e.workstation) : '') + '">';
    openDialog({
      title: isEdit ? '编辑主设备' : '新增主设备', body: body,
      foot: '<button class="btn" data-close="1">取消</button><button class="btn primary" id="eq-ok">' + (isEdit ? '保存' : '确认添加') + '</button>',
      onShow: function () {
        $('#eq-ok').onclick = function () {
          var d = {
            no: $('#eq-no').value, name: $('#eq-name').value,
            line: $('#eq-line').value, equipType: $('#eq-type').value,
            workstation: $('#eq-station').value
          };
          if (!d.no.trim()) { toast('请填写主设备编号'); return; }
          if (!d.workstation.trim()) { toast('请填写工位'); return; }
          if (isEdit) {
            if (DB.updateEquipment(e.id, d)) { closeDialog(); toast('已保存，请确认二维码是否需要重新打印'); renderPage(); }
            else toast('保存失败：编号可能与其他设备重复');
          } else {
            var res = DB.addEquipment(d);
            if (!res.ok) { toast(res.msg); return; }
            closeDialog();
            toast('主设备「' + res.equipment.no + '」已绑定，请生成并打印二维码');
            renderPage();
            openQrDialog(res.equipment);
          }
        };
      }
    });
  }

  /* ============================================================
   * 通知公告（操作工/维修员查看，管理员发布管理）
   * ============================================================ */
  function renderNotice(c) {
    if (state.role.type === 'admin') {
      c.innerHTML =
        '<div class="card"><div class="card-title">发布公告</div>' +
          '<div class="f-item"><label>公告标题 <em>*</em></label><div class="f-ctl"><input class="f-input" id="n-title" placeholder="如：周末设备保养停机通知"></div></div>' +
          '<div class="f-item"><label>公告内容 <em>*</em></label><div class="f-ctl"><textarea class="f-textarea" id="n-content" placeholder="公告发布后，操作工与维修员登录后即可在首页和通知公告中查看…"></textarea></div></div>' +
          '<div style="text-align:right"><button class="btn primary" id="n-publish">📢 发布公告</button></div>' +
        '</div>' +
        '<div class="card"><div class="card-title">历史公告</div><div id="n-list">' + noticeAdminList() + '</div></div>';
      $('#n-publish').onclick = function () {
        var title = $('#n-title').value.trim();
        var content = $('#n-content').value.trim();
        if (!title || !content) { toast('请填写公告标题和内容'); return; }
        DB.addNotice(title, content, '设备管理员');
        toast('公告已发布，全体用户可见');
        renderPage();
      };
      $all('#n-list [data-delnotice]').forEach(function (b) {
        b.onclick = function () {
          if (confirm('确认删除该公告？')) { DB.removeNotice(b.dataset.delnotice); toast('已删除'); renderPage(); }
        };
      });
    } else {
      c.innerHTML = '<div class="card"><div class="card-title">通知公告（' + DB.listNotices().length + '）</div>' + noticeListHTML(0) + '</div>';
    }
  }
  function noticeAdminList() {
    var list = DB.listNotices();
    if (!list.length) return '<div class="table-empty">暂无公告</div>';
    return list.map(function (n) {
      return '<div class="notice-item"><h4><span class="notice-tag">公告</span>' + esc(n.title) +
        '<span style="margin-left:auto"><button class="btn danger sm" data-delnotice="' + n.id + '">删除</button></span></h4>' +
        '<p>' + esc(n.content) + '</p><div class="notice-meta">' + esc(n.author) + ' · ' + DB.fmtTime(n.t) + '</div></div>';
    }).join('');
  }

  /* ============================================================
   * 试用反馈（操作工/维修员提交；管理员回复）
   * ============================================================ */
  function renderFeedback(c) {
    if (state.role.type === 'admin') {
      var list = DB.listFeedbacks();
      var wait = list.filter(function (f) { return !f.reply; }).length;
      c.innerHTML = '<div class="card"><div class="card-title">试用反馈管理 <span class="muted" style="font-weight:400;font-size:12px">共 ' + list.length + ' 条，待回复 ' + wait + ' 条</span></div>' +
        (list.length ? list.map(function (f) {
          return '<div class="feedback-card' + (f.reply ? '' : ' unreplied') + '">' +
            '<div class="fb-head"><div class="wc-avatar">' + esc(f.name.charAt(0)) + '</div>' +
              '<div class="fb-head-info"><b>' + esc(f.name) + '</b><span>' + (ROLE_META[f.role] ? ROLE_META[f.role].name : '用户') + ' · ' + DB.fmtTime(f.t) + '</span></div>' +
              '<span class="fb-type type-' + f.type + '">' + (DB.FEEDBACK_TYPES[f.type] || '其他') + '</span>' +
              (f.reply ? '<span class="replied-ok">已回复</span>' : '<span class="replied-wait">待回复</span>') + '</div>' +
            '<div class="fb-content">' + esc(f.content) + '</div>' +
            (f.reply ? '<div class="fb-reply-box"><b>管理员回复：</b>' + esc(f.reply) + '</div>' : '') +
            '<div class="fb-foot"><button class="btn ' + (f.reply ? '' : 'primary') + ' sm" data-fbreply="' + f.id + '">' + (f.reply ? '修改回复' : '回复') + '</button></div>' +
          '</div>';
        }).join('') : '<div class="empty-box"><div class="empty-icon">💬</div>暂无反馈</div>') +
        '</div>';
      $all('[data-fbreply]', c).forEach(function (b) {
        b.onclick = function () { openFeedbackDialog(b.dataset.fbreply); };
      });
    } else {
      var myIds = getMyIds(MY_FB_KEY);
      var my = DB.listFeedbacks().filter(function (f) { return myIds.indexOf(f.id) >= 0; });
      c.innerHTML =
        '<div class="card"><div class="card-title">提交试用反馈</div>' +
          '<div class="f-item"><label>反馈类型</label><div class="f-ctl"><div class="opt-row" id="fb-types">' +
            ['suggest', 'bug', 'other'].map(function (t) {
              return '<div class="opt-chip' + (state.fbType === t ? ' active' : '') + '" data-v="' + t + '">' + (DB.FEEDBACK_TYPES[t]) + '</div>';
            }).join('') + '</div></div></div>' +
          '<div class="f-item"><label>反馈内容 <em>*</em></label><div class="f-ctl"><textarea class="f-textarea" id="fb-content" maxlength="300" placeholder="小范围试用中，欢迎提出任何建议或遇到的问题…"></textarea></div></div>' +
          '<div style="text-align:right"><button class="btn primary" id="fb-submit">📤 提交反馈</button></div>' +
        '</div>' +
        '<div class="card"><div class="card-title">我的反馈（' + my.length + '）</div>' +
          (my.length ? my.map(function (f) {
            return '<div class="feedback-card' + (f.reply ? '' : ' unreplied') + '">' +
              '<div class="fb-head"><b>' + esc(f.name) + '</b><span class="fb-type type-' + f.type + '">' + (DB.FEEDBACK_TYPES[f.type] || '其他') + '</span>' +
                '<span class="muted" style="margin-left:auto">' + DB.fmtTime(f.t) + '</span></div>' +
              '<div class="fb-content">' + esc(f.content) + '</div>' +
              (f.reply ? '<div class="fb-reply-box"><b>管理员回复：</b>' + esc(f.reply) + '</div>' : '<div class="muted" style="margin-top:8px">⏳ 等待管理员回复…</div>') +
            '</div>';
          }).join('') : '<div class="table-empty">还没有提交过反馈</div>') +
        '</div>';

      $all('#fb-types .opt-chip').forEach(function (el) {
        el.onclick = function () {
          state.fbType = el.dataset.v;
          $all('#fb-types .opt-chip').forEach(function (x) { x.classList.remove('active'); });
          el.classList.add('active');
        };
      });
      $('#fb-submit').onclick = function () {
        var content = $('#fb-content').value.trim();
        if (!content) { toast('请填写反馈内容'); return; }
        var f = DB.addFeedback({ name: state.role.name, role: state.role.type, type: state.fbType, content: content });
        addMyId(MY_FB_KEY, f.id);
        toast('反馈已提交，感谢您的建议！');
        renderPage();
      };
    }
  }

  /* ============================================================
   * 管理员 - 数据统计
   * ============================================================ */
  function renderStats(c) {
    var s = DB.stats();
    c.innerHTML =
      '<div class="stat-row eight">' +
        [['📋', 'b1', s.total, '工单总数'], ['⏳', 'b2', s.pending, '待处理'],
         ['🔨', 'b3', s.processing, '处理中'], ['✅', 'b4', s.done, '已完成（闭环率 ' + s.closeRate + '）'],
         ['⚡', 'b5', s.avgRespond ? DB.fmtDuration(s.avgRespond) : '—', '平均响应时长'],
         ['🛠️', 'b6', s.avgRepair ? DB.fmtDuration(s.avgRepair) : '—', '平均维修时长'],
         ['⏱️', 'b7', s.downtime ? DB.fmtDuration(s.downtime) : '—', '累计停机时长'],
         ['⭐', 'b8', s.avgRating + ' 分', '平均评分']
        ].map(function (it) {
          return '<div class="stat-card"><div class="stat-ico ' + it[1] + '">' + it[0] + '</div><div><b>' + it[2] + '</b><span>' + it[3] + '</span></div></div>';
        }).join('') + '</div>' +
      '<div class="page-grid-21">' +
        '<div class="card"><div class="card-title">近 7 天报修趋势</div><div class="chart-bars" id="st-days"></div></div>' +
        '<div class="card"><div class="card-title">产线分布</div><div id="st-lines"></div></div>' +
      '</div>' +
      '<div class="page-grid-21">' +
        '<div class="card"><div class="card-title">设备类型分布</div><div id="st-types"></div></div>' +
        '<div class="card"><div class="card-title">维修员工作量排行</div><div id="st-rank"></div></div>' +
      '</div>';

    var maxDay = Math.max.apply(null, s.days.map(function (d) { return d.count; }).concat([1]));
    $('#st-days').innerHTML = s.days.map(function (d) {
      return '<div class="bar-col"><div class="bar-num">' + (d.count || '') + '</div>' +
        '<div class="bar" style="height:' + Math.round(d.count / maxDay * 100) + '%"></div>' +
        '<div class="bar-label">' + d.label + '</div></div>';
    }).join('');

    var maxLine = Math.max.apply(null, s.byLine.map(function (x) { return x.count; }).concat([1]));
    $('#st-lines').innerHTML = s.byLine.map(function (x) {
      return '<div class="dist-row"><div class="dist-name">' + esc(x.line.name) + '</div>' +
        '<div class="dist-track"><div class="dist-fill" style="width:' + Math.round(x.count / maxLine * 100) + '%;background:' + x.line.color + '"></div></div>' +
        '<div class="dist-num">' + x.count + '</div></div>';
    }).join('');

    if (s.byType.length) {
      var maxType = s.byType[0].count;
      var palette = ['#2563eb', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#64748b', '#ec4899'];
      $('#st-types').innerHTML = s.byType.map(function (x, i) {
        return '<div class="dist-row"><div class="dist-name">' + x.type.icon + ' ' + esc(x.type.name) + '</div>' +
          '<div class="dist-track"><div class="dist-fill" style="width:' + Math.round(x.count / maxType * 100) + '%;background:' + palette[i % palette.length] + '"></div></div>' +
          '<div class="dist-num">' + x.count + '</div></div>';
      }).join('');
    } else $('#st-types').innerHTML = '<div class="table-empty">暂无数据</div>';

    $('#st-rank').innerHTML = s.workers.map(function (r2, i) {
      var total = r2.doing + r2.done;
      var medal = ['🥇', '🥈', '🥉'][i] || '';
      var max = (s.workers[0].doing + s.workers[0].done) || 1;
      return '<div class="rank-row"><div class="rank-name"><span class="rank-medal">' + medal + '</span>' +
        '<div class="wc-avatar" style="width:34px;height:34px;font-size:14px">' + r2.worker.name.charAt(0) + '</div>' +
        '<div><b>' + esc(r2.worker.name) + '</b><div class="muted">' + esc(r2.worker.skill) + '</div></div></div>' +
        '<div class="rank-bar-wrap"><div class="rank-bar"><div class="rank-fill" style="width:' + Math.round(total / max * 100) + '%"></div></div>' +
        '<div class="rank-nums"><span class="doing">处理中 ' + r2.doing + '</span> · 已完成 ' + r2.done + ' · ⭐' + r2.worker.rating.toFixed(1) + '</div></div></div>';
    }).join('');
  }

  /* ============================================================
   * 管理员 - 工单管理 / 维修记录
   * ============================================================ */
  function renderOrders(c) {
    var list = DB.listOrders(state.orderFilter);
    var kw = state.kw.trim().toLowerCase();
    if (kw) {
      list = list.filter(function (o) {
        var bag = [o.no, o.equipNo, o.workstation, o.reporter, o.fault,
          DB.getLine(o.line).name, DB.getEquipType(o.equipType).name,
          o.workerId ? DB.getWorker(o.workerId).name : ''].join(' ').toLowerCase();
        return bag.indexOf(kw) !== -1;
      });
    }
    c.innerHTML =
      '<div class="filter-bar"><div class="filter-tabs">' +
        [['all', '全部'], ['pending', '待处理'], ['processing', '处理中'], ['done', '已完成']].map(function (t) {
          return '<div class="f-tab' + (state.orderFilter === t[0] ? ' active' : '') + '" data-s="' + t[0] + '">' + t[1] + '</div>';
        }).join('') + '</div>' +
        '<input class="search-input" id="ord-search" placeholder="搜索工单号 / 设备编号 / 工位 / 报修人 / 故障…" value="' + esc(state.kw) + '"></div>' +
      '<div class="card"><table class="data-table"><thead><tr>' +
        '<th>工单号</th><th>产线 / 工位</th><th>设备编号</th><th>故障现象</th><th>报修人</th><th>等级</th><th>状态</th><th>维修员</th><th>提交时间</th><th>操作</th>' +
        '</tr></thead><tbody id="ord-body"></tbody></table></div>';

    $('#ord-body').innerHTML = list.length ? list.map(function (o) {
      var ops = '<button class="btn text sm" data-detail="' + o.id + '">详情</button>';
      if (o.status === 'pending') ops = '<button class="btn primary sm" data-assign="' + o.id + '">指派维修</button>' + ops;
      return '<tr>' +
        '<td class="mono">' + esc(o.no) + '</td>' +
        '<td>' + lineTag(o.line) + '<div class="muted">' + esc(o.workstation) + '</div></td>' +
        '<td><b>' + esc(o.equipNo) + '</b><div class="muted">' + DB.getEquipType(o.equipType).icon + ' ' + esc(DB.getEquipType(o.equipType).name) + '</div></td>' +
        '<td class="ellipsis" title="' + esc(o.fault) + '">' + esc(o.fault) + '</td>' +
        '<td>' + esc(o.reporter) + '</td>' +
        '<td>' + (o.level === 'urgent' ? '<span class="urgent-tag">紧急·停机</span>' : '<span class="normal-tag">一般</span>') + '</td>' +
        '<td>' + statusTag(o.status) + '<div style="margin-top:4px">' + modeTag(o) + '</div></td>' +
        '<td>' + (o.workerId ? esc(DB.getWorker(o.workerId).name) + '<div class="muted">' + esc(DB.getWorker(o.workerId).skill) + '</div>' : '<span class="muted">待接单</span>') + '</td>' +
        '<td class="muted nowrap">' + DB.fmtTime(o.createTime) + '</td>' +
        '<td class="nowrap">' + ops + '</td></tr>';
    }).join('') : '<tr><td colspan="10" class="table-empty">没有符合条件的工单</td></tr>';

    $all('.f-tab', c).forEach(function (t) {
      t.onclick = function () { state.orderFilter = t.dataset.s; renderPage(); };
    });
    $('#ord-search').oninput = function () { state.kw = this.value; $('#ord-body') && renderOrdersLive(); };
    function renderOrdersLive() {
      var l2 = DB.listOrders(state.orderFilter);
      var k2 = state.kw.trim().toLowerCase();
      if (k2) l2 = l2.filter(function (o) {
        return [o.no, o.equipNo, o.workstation, o.reporter, o.fault, DB.getLine(o.line).name, DB.getEquipType(o.equipType).name, o.workerId ? DB.getWorker(o.workerId).name : ''].join(' ').toLowerCase().indexOf(k2) !== -1;
      });
      $('#ord-body').innerHTML = l2.length ? l2.map(function (o) {
        var ops = '<button class="btn text sm" data-detail="' + o.id + '">详情</button>';
        if (o.status === 'pending') ops = '<button class="btn primary sm" data-assign="' + o.id + '">指派维修</button>' + ops;
        return '<tr><td class="mono">' + esc(o.no) + '</td><td>' + lineTag(o.line) + '<div class="muted">' + esc(o.workstation) + '</div></td>' +
          '<td><b>' + esc(o.equipNo) + '</b><div class="muted">' + DB.getEquipType(o.equipType).icon + ' ' + esc(DB.getEquipType(o.equipType).name) + '</div></td>' +
          '<td class="ellipsis">' + esc(o.fault) + '</td><td>' + esc(o.reporter) + '</td>' +
          '<td>' + (o.level === 'urgent' ? '<span class="urgent-tag">紧急</span>' : '<span class="normal-tag">一般</span>') + '</td>' +
          '<td>' + statusTag(o.status) + '</td>' +
          '<td>' + (o.workerId ? esc(DB.getWorker(o.workerId).name) : '<span class="muted">待接单</span>') + '</td>' +
          '<td class="muted nowrap">' + DB.fmtTime(o.createTime) + '</td><td class="nowrap">' + ops + '</td></tr>';
      }).join('') : '<tr><td colspan="10" class="table-empty">没有符合条件的工单</td></tr>';
      bindRowBtns();
    }
    bindRowBtns();
    function bindRowBtns() {
      $all('#ord-body [data-assign]').forEach(function (b) {
        b.onclick = function () { openAssignDialog(b.dataset.assign); };
      });
      $all('#ord-body [data-detail]').forEach(function (b) {
        b.onclick = function () { openOrderDetail(b.dataset.detail); };
      });
    }
  }

  function renderRecords(c) {
    var list = DB.listOrders('done');
    c.innerHTML = '<div class="card"><div class="card-title">维修记录（' + list.length + '）<span class="muted" style="font-weight:400;font-size:12px">已闭环工单的处理结果、停机时长与报修人评价</span></div>' +
      '<table class="data-table"><thead><tr><th>工单号</th><th>设备编号</th><th>维修员</th><th>接单方式</th><th>处理结果</th><th>停机时长</th><th>评价</th><th>完成时间</th><th>操作</th></tr></thead>' +
      '<tbody>' + (list.length ? list.map(function (o) {
        return '<tr>' +
          '<td class="mono">' + esc(o.no) + '</td>' +
          '<td><b>' + esc(o.equipNo) + '</b></td>' +
          '<td>' + esc(DB.getWorker(o.workerId) ? DB.getWorker(o.workerId).name : '—') + '</td>' +
          '<td>' + (o.mode === 'assign' ? '<span class="mode-tag assign">指派</span>' : '<span class="mode-tag grab">抢单</span>') + '</td>' +
          '<td class="ellipsis" title="' + esc(o.result) + '">' + esc(o.result) + '</td>' +
          '<td class="nowrap">' + (o.downtimeMin ? DB.fmtDuration(o.downtimeMin) : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (o.rating > 0 ? starsHTML(o.rating) : '<span class="muted">未评</span>') + '</td>' +
          '<td class="muted nowrap">' + DB.fmtTime(o.completeTime) + '</td>' +
          '<td><button class="btn text sm" data-detail="' + o.id + '">详情</button></td></tr>';
      }).join('') : '<tr><td colspan="9" class="table-empty">暂无已完成工单</td></tr>') + '</tbody></table></div>';
    $all('[data-detail]', c).forEach(function (b) {
      b.onclick = function () { openOrderDetail(b.dataset.detail); };
    });
  }

  /* ============================================================
   * 管理员 - 维修人员
   * ============================================================ */
  function renderWorkers(c) {
    var workers = DB.listWorkers();
    c.innerHTML = '<div class="card" style="padding-bottom:8px"><div class="card-title">维修人员配置 <button class="btn primary sm" id="wk-add">＋ 新增人员</button></div></div>' +
      '<div class="worker-grid">' + workers.map(function (w) {
        var busy = DB.workerBusy(w.id);
        var doing = DB.listByWorker(w.id).filter(function (o) { return o.status === 'processing'; }).length;
        return '<div class="worker-card">' +
          '<div class="wc-head"><div class="wc-avatar">' + w.name.charAt(0) + '</div>' +
            '<div><b>' + esc(w.name) + '</b><div class="worker-skill">' + esc(w.skill) + ' · ' + esc(w.phone) + '</div></div>' +
            '<span class="wc-busy' + (busy ? ' doing' : '') + '">' + (busy ? '处理中 ' + doing : '空闲') + '</span></div>' +
          '<div class="wc-desc">' + esc(w.desc || '—') + '<div class="muted" style="margin-top:4px">负责范围：' + esc(w.scope || '—') + '</div></div>' +
          '<div class="wc-stats"><div><b>' + w.done + '</b><span>累计完成</span></div><div><b>' + doing + '</b><span>进行中</span></div><div><b>' + w.rating.toFixed(1) + '</b><span>评分</span></div></div>' +
          '<div class="wc-foot">' + (busy ? '' : '<button class="btn danger sm" data-wkdel="' + w.id + '">移除</button>') + '</div>' +
        '</div>';
      }).join('') + '</div>';
    $('#wk-add').onclick = openWorkerDialog;
    $all('[data-wkdel]', c).forEach(function (b) {
      b.onclick = function () {
        var w = DB.getWorker(b.dataset.wkdel);
        if (confirm('确认移除维修人员「' + w.name + '」？')) { DB.removeWorker(w.id); toast('已移除'); refreshAll(); }
      };
    });
  }

  /* ============================================================
   * 通用弹窗
   * ============================================================ */
  function openDialog(opt) {
    $('#dialog-title').textContent = opt.title || '提示';
    $('#dialog-body').innerHTML = opt.body || '';
    $('#dialog-foot').innerHTML = opt.foot || '<button class="btn" data-close="1">关闭</button>';
    $('#dialog-box').className = 'dialog' + (opt.wide ? ' wide' : '');
    $('#dialog-mask').classList.add('show');
    if (opt.onShow) opt.onShow();
    $all('#dialog-foot [data-close]').forEach(function (b) {
      b.onclick = closeDialog;
    });
  }
  function closeDialog() { $('#dialog-mask').classList.remove('show'); }
  function showViewer(src) {
    $('#img-viewer-el').src = src;
    $('#img-viewer').classList.add('show');
  }

  /* ---------- 工单详情（三角色共用，按角色显示操作） ---------- */
  function openOrderDetail(id) {
    var o = DB.getOrder(id);
    if (!o) return;
    state.detailId = id;
    var r = state.role;

    var steps = [
      { name: '待处理', done: true },
      { name: '处理中', done: o.status === 'processing' || o.status === 'done' },
      { name: '已完成', done: o.status === 'done' }
    ];
    var stepsHtml = '<div class="steps-3">' + steps.map(function (s2, i) {
      return '<div class="step3 ' + (s2.done ? 'done' : '') + '"><div class="step3-dot">' + (s2.done ? '✓' : i + 1) + '</div><span>' + s2.name + '</span>' +
        (i < 2 ? '<div class="step3-bar"></div>' : '') + '</div>';
    }).join('') + '</div>';

    var rows = [
      ['所属产线', DB.getLine(o.line).name],
      ['工位', o.workstation],
      ['设备类型', DB.getEquipType(o.equipType).icon + ' ' + DB.getEquipType(o.equipType).name],
      ['设备编号', o.equipNo],
      ['故障等级', o.level === 'urgent' ? '紧急·停机' : '一般故障'],
      ['报修人', o.reporter + (o.phone ? '（' + o.phone + '）' : '')],
      ['提交时间', DB.fmtTime(o.createTime)],
      ['接单时间', o.acceptTime ? DB.fmtTime(o.acceptTime) : '—'],
      ['完成时间', o.completeTime ? DB.fmtTime(o.completeTime) : '—'],
      ['接单方式', o.status === 'pending' ? '待接单' : (o.mode === 'assign' ? '管理员指派' : '维修员抢单')],
      ['维修人员', o.workerId ? DB.getWorker(o.workerId).name + '（' + DB.getWorker(o.workerId).skill + '）' : '—'],
      ['停机时长', o.downtimeMin ? DB.fmtDuration(o.downtimeMin) : '—']
    ];

    var body =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><b class="mono" style="font-size:15px">' + esc(o.no) + '</b>' +
        statusTag(o.status) + (o.level === 'urgent' ? '<span class="urgent-tag">紧急·停机</span>' : '') + '</div>' +
      stepsHtml +
      '<div class="info-rows">' + rows.map(function (r2) {
        return '<div class="info-row"><span>' + r2[0] + '</span><b>' + esc(r2[1]) + '</b></div>';
      }).join('') + '</div>' +
      '<div class="info-block"><h4>故障现象</h4><p>' + esc(o.fault) + '</p></div>';

    if (o.images && o.images.length) {
      body += '<div class="detail-imgs">' + o.images.map(function (img) {
        return '<img src="' + img + '" data-img="' + img + '">';
      }).join('') + '</div>';
    }
    if (o.records && o.records.length) {
      body += '<div class="info-block blue"><h4>📝 处理过程记录（' + o.records.length + ' 条）</h4>' +
        o.records.map(function (rc) {
          return '<p class="record-line"><i>' + DB.fmtTime(rc.t) + '</i>' + esc(rc.text) + '</p>';
        }).join('') + '</div>';
    }
    // 维修员处理中：可添加记录
    if (r.type === 'repairman' && o.status === 'processing' && o.workerId === r.workerId) {
      body += '<div class="info-block blue"><h4>➕ 添加处理记录</h4>' +
        '<textarea class="f-textarea" id="rec-text" maxlength="200" placeholder="记录现场排查情况、处理措施、更换配件…" style="margin-bottom:10px"></textarea>' +
        '<button class="btn sm" id="rec-add">提交记录</button></div>';
    }
    if (o.status === 'done') {
      body += '<div class="info-block green"><h4>✅ 处理结果</h4><p>' + esc(o.result) + '</p>' +
        (o.downtimeMin ? '<p style="margin-top:5px">⏱️ 设备停机时长：<b>' + DB.fmtDuration(o.downtimeMin) + '</b></p>' : '') + '</div>';
    }
    if (o.rating > 0) {
      body += '<div class="info-block yellow"><h4>💬 报修人评价 ' + starsHTML(o.rating) + '</h4><p>' + esc(o.ratingText || '感谢反馈') + '</p>' +
        (o.workerReply ? '<div class="info-block blue" style="margin:8px 0 0"><h4>🔧 维修员回复</h4><p>' + esc(o.workerReply) + '</p></div>' : '') + '</div>';
    }
    body += '<h4 style="font-size:14px;margin:14px 0 10px">流转记录（全过程留痕）</h4><div class="timeline">' +
      o.timeline.slice().reverse().map(function (t) {
        return '<div class="tl-item"><div class="tl-dot"></div><div class="tl-content"><b>' + esc(t.action) + '</b>' +
          '<span>' + DB.fmtTime(t.t) + '</span>' + (t.note ? '<p>' + esc(t.note) + '</p>' : '') + '</div></div>';
      }).join('') + '</div>';

    // 底部操作按角色
    var foot = '<button class="btn" data-close="1">关闭</button>';
    if (o.status === 'pending' && r.type === 'repairman') {
      foot = '<button class="btn" data-close="1">关闭</button><button class="btn primary" id="dlg-grab">🔧 我要抢单</button>';
    }
    if (o.status === 'pending' && r.type === 'admin') {
      foot = '<button class="btn" data-close="1">关闭</button><button class="btn primary" id="dlg-assign">📨 指派维修员</button>';
    }
    if (o.status === 'processing' && r.type === 'repairman' && o.workerId === r.workerId) {
      foot = '<button class="btn" data-close="1">关闭</button><button class="btn success" id="dlg-complete">✅ 完成维修</button>';
    }
    var myIds = getMyIds(MY_ORDER_KEY);
    if (o.status === 'done' && r.type === 'operator' && myIds.indexOf(o.id) >= 0 && o.rating === 0) {
      foot = '<button class="btn" data-close="1">关闭</button><button class="btn warning" id="dlg-rate">⭐ 立即评价</button>';
    }

    openDialog({ title: '工单详情', wide: true, body: body, foot: foot, onShow: function () {
      $all('#dialog-body [data-img]').forEach(function (img) {
        img.onclick = function () { showViewer(img.dataset.img); };
      });
      var grab = $('#dlg-grab');
      if (grab) grab.onclick = function () { closeDialog(); doGrab(id); };
      var asg = $('#dlg-assign');
      if (asg) asg.onclick = function () { closeDialog(); openAssignDialog(id); };
      var comp = $('#dlg-complete');
      if (comp) comp.onclick = function () { closeDialog(); openCompleteDialog(id); };
      var rate = $('#dlg-rate');
      if (rate) rate.onclick = function () { closeDialog(); openRateDialog(id); };
      var recAdd = $('#rec-add');
      if (recAdd) recAdd.onclick = function () {
        var txt = $('#rec-text').value.trim();
        if (!txt) { toast('请填写处理记录'); return; }
        DB.addRecord(id, txt);
        toast('记录已提交');
        openOrderDetail(id);
      };
    }});
  }

  /* ---------- 管理员指派 ---------- */
  function openAssignDialog(orderId) {
    var o = DB.getOrder(orderId);
    if (!o || o.status !== 'pending') { toast('该工单已被接单'); return; }
    var body = '<div class="fb-quote">工单 <b class="mono">' + esc(o.no) + '</b>：' + esc(DB.getEquipType(o.equipType).name) +
      ' · ' + esc(o.equipNo) + '（' + esc(DB.getLine(o.line).name) + '）<br>选择维修人员后将立即通知对方接单处理：</div>' +
      DB.listWorkers().map(function (w) {
        var busy = DB.workerBusy(w.id);
        return '<div class="pick-row' + (busy ? ' busy' : '') + '" data-wk="' + w.id + '">' +
          '<div class="wc-avatar" style="width:38px;height:38px;font-size:15px">' + w.name.charAt(0) + '</div>' +
          '<div style="flex:1"><b>' + esc(w.name) + ' · ' + esc(w.skill) + '</b>' +
          '<div class="muted">负责：' + esc(w.scope || '—') + ' ｜ 累计完成 ' + w.done + ' 单 ｜ ⭐' + w.rating.toFixed(1) + '</div></div>' +
          '<span class="wc-busy' + (busy ? ' doing' : '') + '">' + (busy ? '处理中' : '可指派') + '</span></div>';
      }).join('');
    openDialog({ title: '指派维修人员', body: body, foot: '<button class="btn" data-close="1">取消</button>', onShow: function () {
      $all('#dialog-body .pick-row').forEach(function (el) {
        el.onclick = function () {
          if (DB.assign(orderId, el.dataset.wk)) {
            closeDialog();
            toast('已指派 ' + DB.getWorker(el.dataset.wk).name + '，通知已发送');
            refreshAll();
          } else {
            closeDialog();
            toast('指派失败，工单可能已被接单');
            refreshAll();
          }
        };
      });
    }});
  }

  /* ---------- 维修员完成工单 ---------- */
  function openCompleteDialog(orderId) {
    var body =
      '<label class="login-label">维修结果 / 处理措施 <em>*</em></label>' +
      '<textarea class="f-textarea" id="cp-note" maxlength="200" placeholder="如：更换XX配件，调试正常，试生产无异常…"></textarea>' +
      '<label class="login-label" style="margin-top:14px">设备停机时长（分钟）</label>' +
      '<input class="f-input" id="cp-down" type="number" min="0" placeholder="如：40（未停机填 0）">';
    openDialog({
      title: '完成维修', body: body,
      foot: '<button class="btn" data-close="1">取消</button><button class="btn success" id="cp-ok">✅ 确认完成</button>',
      onShow: function () {
        $('#cp-ok').onclick = function () {
          var result = $('#cp-note').value.trim();
          var down = Number($('#cp-down').value) || 0;
          if (!result) { toast('请填写维修结果'); return; }
          if (DB.complete(orderId, result, down)) {
            closeDialog();
            toast('工单已完成，报修人将收到通知');
            state.orderFilter = 'done';
            refreshAll();
          }
        };
      }
    });
  }

  /* ---------- 操作工评价 ---------- */
  function openRateDialog(orderId) {
    state.rateScore = 0;
    function starsLine() {
      var html = '';
      for (var i = 1; i <= 5; i++) {
        html += '<span class="star' + (i <= state.rateScore ? ' on' : '') + '" data-v="' + i + '">★</span>';
      }
      return html;
    }
    var body =
      '<div class="star-pick" id="rt-stars" style="text-align:center;font-size:34px;letter-spacing:8px;margin-bottom:14px">' + starsLine() + '</div>' +
      '<textarea class="f-textarea" id="rt-text" maxlength="200" placeholder="说说维修响应速度、修复效果…"></textarea>';
    openDialog({
      title: '维修服务评价', body: body,
      foot: '<button class="btn" data-close="1">取消</button><button class="btn warning" id="rt-ok">提交评价</button>',
      onShow: function () {
        function paint() {
          $all('#rt-stars .star').forEach(function (s2) {
            s2.classList.toggle('on', Number(s2.dataset.v) <= state.rateScore);
          });
        }
        paint();
        $all('#rt-stars .star').forEach(function (s2) {
          s2.onclick = function () { state.rateScore = Number(s2.dataset.v); paint(); };
        });
        $('#rt-ok').onclick = function () {
          if (!state.rateScore) { toast('请先选择星级评分'); return; }
          if (DB.rate(orderId, state.rateScore, $('#rt-text').value.trim())) {
            closeDialog();
            toast('感谢您的评价！');
            refreshAll();
          }
        };
      }
    });
  }

  /* ---------- 维修员回复评价 ---------- */
  function openRatingReplyDialog(orderId) {
    var body = '<textarea class="f-textarea" id="rr-text" maxlength="200" placeholder="回复将展示给报修人，如：感谢认可，后续我们会加强该设备的日常点检…"></textarea>';
    openDialog({
      title: '回复报修人评价', body: body,
      foot: '<button class="btn" data-close="1">取消</button><button class="btn primary" id="rr-ok">发送回复</button>',
      onShow: function () {
        $('#rr-ok').onclick = function () {
          var txt = $('#rr-text').value.trim();
          if (!txt) { toast('请填写回复内容'); return; }
          if (DB.replyRating(orderId, txt)) { closeDialog(); toast('回复已发送'); refreshAll(); }
        };
      }
    });
  }

  /* ---------- 管理员回复反馈 ---------- */
  function openFeedbackDialog(fbId) {
    var f = DB.listFeedbacks().filter(function (x) { return x.id === fbId; })[0];
    if (!f) return;
    var body = '<div class="fb-quote"><b>' + esc(f.name) + '（' + (ROLE_META[f.role] ? ROLE_META[f.role].name : '用户') + '）：</b>' + esc(f.content) + '</div>' +
      '<textarea class="f-textarea" id="fr-text" maxlength="200" placeholder="回复将在用户端「我的反馈」中展示…">' + esc(f.reply || '') + '</textarea>';
    openDialog({
      title: '回复试用反馈', body: body,
      foot: '<button class="btn" data-close="1">取消</button><button class="btn primary" id="fr-ok">发送回复</button>',
      onShow: function () {
        $('#fr-ok').onclick = function () {
          var txt = $('#fr-text').value.trim();
          if (!txt) { toast('请填写回复内容'); return; }
          DB.replyFeedback(fbId, txt);
          closeDialog();
          toast('回复已发送，用户端可见');
          refreshAll();
        };
      }
    });
  }

  /* ---------- 新增维修员 ---------- */
  function openWorkerDialog() {
    var body =
      '<label class="login-label">姓名 <em>*</em></label><input class="f-input" id="wk-name" placeholder="请输入姓名">' +
      '<label class="login-label">联系电话 <em>*</em></label><input class="f-input" id="wk-phone" type="tel" maxlength="11" placeholder="11 位手机号">' +
      '<label class="login-label">工种 <em>*</em></label><select class="f-input" id="wk-skill">' +
        ['机修钳工', '电气工程师', '检测设备', '综合维修'].map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>' +
      '<label class="login-label">负责设备 / 范围</label><input class="f-input" id="wk-scope" placeholder="如：注塑机 / 冲压机">' +
      '<label class="login-label">个人简介</label><input class="f-input" id="wk-desc" placeholder="如：8年设备维修经验，持钳工证">';
    openDialog({
      title: '新增维修人员', body: body,
      foot: '<button class="btn" data-close="1">取消</button><button class="btn primary" id="wk-ok">确认添加</button>',
      onShow: function () {
        $('#wk-ok').onclick = function () {
          var name = $('#wk-name').value.trim();
          var phone = $('#wk-phone').value.trim();
          if (!name) { toast('请填写姓名'); return; }
          if (!/^1\d{10}$/.test(phone)) { toast('请填写正确的 11 位手机号'); return; }
          DB.addWorker({
            name: name,
            phone: phone.slice(0, 3) + '****' + phone.slice(7),
            skill: $('#wk-skill').value,
            scope: $('#wk-scope').value.trim(),
            desc: $('#wk-desc').value.trim()
          });
          closeDialog();
          toast('已添加维修人员：' + name);
          refreshAll();
        };
      }
    });
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  async function init() {
    initLogin();

    // 初始化云端数据
    var tip = document.createElement('div');
    tip.id = 'init-tip';
    tip.style.cssText = 'position:fixed;top:0;left:0;right:0;text-align:center;padding:8px;background:#3b82f6;color:#fff;font-size:14px;z-index:99999';
    tip.textContent = '正在同步设备数据…';
    document.body.appendChild(tip);
    try { await DB.init(); } catch (e) { tip.textContent = '⚠ 数据同步失败，部分功能可能不可用'; tip.style.background = '#ef4444'; setTimeout(function(){tip.remove();}, 3000); }
    tip.remove();

    $('#btn-logout').onclick = function () {
      if (confirm('确认退出登录？')) logout();
    };
    $('#btn-reset').onclick = function () {
      if (confirm('确认重置为初始演示数据？当前所有工单、维修员、公告、反馈将恢复默认。')) {
        DB.reset();
        toast('演示数据已重置');
        refreshAll();
      }
    };
    $('#dialog-close').onclick = closeDialog;
    $('#dialog-mask').addEventListener('click', function (e) {
      if (e.target === this) closeDialog();
    });
    $('#img-viewer').addEventListener('click', function () { this.classList.remove('show'); });

    $('#top-bell').onclick = function () {
      var t = state.role.type;
      if (t === 'repairman') goPage('wall');
      else if (t === 'admin') goPage(badgeValue('pending') ? 'orders' : 'feedback', 'pending');
      else goPage('mine');
    };

    // 二维码扫码路由（短码 eq=编号 或全码携带设备信息）
    var scanPayload = readScanPayload();
    if (scanPayload) state.pendingScanNo = scanPayload.no;

    // 自动登录
    var saved = DB.getRole();
    if (saved && ROLE_META[saved.type]) enterShell(saved);
    else {
      $('#login-page').style.display = 'flex';
      if (scanPayload) showLoginScanTip(scanPayload);
    }

    // 已打开页面时再扫码（微信/相机识别新二维码会带 hash 打开）
    window.addEventListener('hashchange', function () {
      var p = readScanPayload();
      if (!p) return;
      state.pendingScanNo = p.no;
      if (!state.role) {
        $('#login-page').style.display = 'flex';
        $('#app-shell').style.display = 'none';
        showLoginScanTip(p);
        return;
      }
      if (state.role.type !== 'operator') {
        toast('扫码报修仅限操作工身份使用');
        clearScan();
        return;
      }
      applyPendingScan();
    });

    // 定时刷新铃铛 + 云端数据轮询（跨设备同步）
    var _poll = 0;
    setInterval(function () {
      if (state.role) renderBell();
      _poll++;
      if (_poll >= 7 && state.role) { // ~21秒拉取一次云端数据
        _poll = 0;
        DB.refresh().then(function (changed) {
          if (!changed) return;
          renderBell();
          if (['home', 'wall', 'mine', 'orders', 'myrepairs', 'stats', 'equip', 'records'].indexOf(state.page) >= 0) {
            renderPage();
          }
        }).catch(function () {});
      }
    }, 3000);
    renderBell();
  }

  document.addEventListener('DOMContentLoaded', function () { init(); });
})();
