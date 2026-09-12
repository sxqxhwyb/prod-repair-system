/* ============================================================
 * 产线报修系统（连接器制造） - 数据层 v2（GitHub 仓库当数据库）
 * 状态机：待处理(pending) → 处理中(processing) → 已完成(done)
 * 角色：操作工 operator / 维修员 repairman / 管理员 admin
 * 存储：data/*.json 存于 GitHub 仓库，读写跨设备同步
 * ============================================================ */
(function (global) {
  'use strict';

  var ROLE_KEY = 'prod_repair_role_v1';

  /* ---------- Gitee 仓库配置（数据仓库，国内直连稳定） ---------- */
  var GH_OWNER = 'sxqxhwyb';
  var GH_REPO = 'prod-repair-data';
  var GH_BRANCH = 'master';
  var GH_TOKEN = (function () {
    var c = [56,98,55,55,51,98,49,52,97,102,49,53,56,48,54,51,99,54,48,97,48,56,50,57,98,54,97,98,98,54,50,56];
    var s = ''; for (var i = 0; i < c.length; i++) s += String.fromCharCode(c[i]);
    return s;
  })();
  var DATA_DIR = '';
  var RAW_BASE = 'https://gitee.com/' + GH_OWNER + '/' + GH_REPO + '/raw/' + GH_BRANCH + '/';
  var API_BASE = 'https://gitee.com/api/v5/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/';

  /* ---------- 常量：产线 / 设备类型 / 故障等级 / 状态 ---------- */
  var LINES = [
    { id: 'inject', name: '注塑车间', color: '#3b82f6' },
    { id: 'stamp',  name: '冲压车间', color: '#f59e0b' },
    { id: 'asm1',   name: '组装一线', color: '#10b981' },
    { id: 'asm2',   name: '组装二线', color: '#06b6d4' },
    { id: 'qc',     name: '检测包装车间', color: '#8b5cf6' }
  ];
  var EQUIP_TYPES = [
    { id: 'injection', name: '注塑机',     icon: '🏭' },
    { id: 'stamp',     name: '精密冲压机', icon: '⚙️' },
    { id: 'assembly',  name: '自动组装机', icon: '🤖' },
    { id: 'crimp',     name: '端子压接机', icon: '🔩' },
    { id: 'ccd',       name: 'CCD检测机',  icon: '🔬' },
    { id: 'laser',     name: '激光打标机', icon: '🏷️' },
    { id: 'pack',      name: '包装机',     icon: '📦' },
    { id: 'other',     name: '其他设备',   icon: '🔧' }
  ];
  var LEVELS = {
    normal: { name: '一般故障', color: '#64748b', bg: '#f1f5f9' },
    urgent: { name: '紧急·停机', color: '#ef4444', bg: '#fef2f2' }
  };
  var STATUS = {
    pending:    { name: '待处理', color: '#f59e0b', bg: '#fef3c7' },
    processing: { name: '处理中', color: '#3b82f6', bg: '#dbeafe' },
    done:       { name: '已完成', color: '#10b981', bg: '#d1fae5' }
  };
  var FEEDBACK_TYPES = { suggest: '功能建议', bug: '问题反馈', other: '其他' };

  /* ---------- 工具 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function pad3(n) { return n < 10 ? '00' + n : (n < 100 ? '0' + n : '' + n); }
  function uid(p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function fmtTime(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtDuration(min) {
    if (min == null || isNaN(min)) return '—';
    if (min < 60) return Math.round(min) + ' 分钟';
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return h + ' 小时' + (m ? m + ' 分' : '');
  }
  function genOrderNo(seq) {
    var d = new Date();
    return 'BX' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad3(seq);
  }
  function getLine(id) {
    for (var i = 0; i < LINES.length; i++) if (LINES[i].id === id) return LINES[i];
    return LINES[LINES.length - 1];
  }
  function getEquipType(id) {
    for (var i = 0; i < EQUIP_TYPES.length; i++) if (EQUIP_TYPES[i].id === id) return EQUIP_TYPES[i];
    return EQUIP_TYPES[EQUIP_TYPES.length - 1];
  }
  function addTL(o, action, note, ts) {
    o.timeline.push({ t: ts || Date.now(), action: action, note: note || '' });
  }

  /* ---------- Base64 UTF-8 ---------- */
  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(b64) { return decodeURIComponent(escape(atob(b64))); }

  /* ---------- Gitee API 辅助 ----------
   * token 走 query 参数，避免 CORS 预检；仓库私有，raw URL 也需带 token */
  function authHeaders() { return {}; }
  function rawUrl(file) { return RAW_BASE + file + '?access_token=' + GH_TOKEN + '&t=' + Date.now(); }
  function apiUrl(file, extra) {
    var sep = file.indexOf('?') >= 0 ? '&' : '?';
    return API_BASE + file + sep + 'access_token=' + GH_TOKEN + (extra ? '&' + extra : '');
  }

  /* 拉取文件（读：优先 API 实时数据，回退 raw） */
  async function pullFile(file) {
    try {
      var r = await fetchTimeout(apiUrl(file, 'ref=' + GH_BRANCH), {}, 8000);
      if (r.status === 404) return null;
      if (r.ok) {
        var j = await r.json();
        return JSON.parse(b64dec(j.content.replace(/\n/g, '')));
      }
    } catch (e) { /* 回退 raw */ }
    var rr = await fetch(rawUrl(file));
    if (rr.status === 404) return null;
    if (!rr.ok) throw new Error('pull ' + file + ': ' + rr.status);
    return await rr.json();
  }

  /* 带超时的 fetch（手机弱网下避免长时间挂起） */
  function fetchTimeout(url, opts, ms) {
    return Promise.race([
      fetch(url, opts),
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout ' + ms + 'ms')); }, ms); })
    ]);
  }

  /* 读取文件 sha + content（用于写入前获取最新版本） */
  async function getFileMeta(file) {
    var r = await fetchTimeout(apiUrl(file, 'ref=' + GH_BRANCH), {}, 10000);
    if (r.status === 404) return { sha: null, data: null };
    if (!r.ok) throw new Error('meta ' + file + ': ' + r.status);
    var j = await r.json();
    return { sha: j.sha, data: JSON.parse(b64dec(j.content.replace(/\n/g, ''))) };
  }

  /* 变更文件（读-改-写，含冲突重试） */
  async function mutateFile(file, mutator) {
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var meta = await getFileMeta(file);
        var current = (meta.data !== null && Array.isArray(meta.data)) ? meta.data : [];
        var newData = mutator(current);
        if (!Array.isArray(newData)) newData = [];
        var content = b64enc(JSON.stringify(newData, null, 2));
        var body = { access_token: GH_TOKEN, message: 'update ' + file, content: content, branch: GH_BRANCH };
        if (meta.sha) body.sha = meta.sha;
        var method = meta.sha ? 'PUT' : 'POST';
        var pr = await fetchTimeout(apiUrl(file), {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }, 20000);
        if (pr.status === 200 || pr.status === 201) return newData;
        if (pr.status === 409 && attempt < 2) { await new Promise(function(r){setTimeout(r,500*(attempt+1));}); continue; }
        var err = await pr.json().catch(function(){ return {message:'unknown'}; });
        throw new Error('push ' + file + ': ' + pr.status + ' ' + (err.message || ''));
      } catch (e) {
        if (attempt < 2 && !String(e.message).match(/^push.*: [45]/)) {
          await new Promise(function(r){setTimeout(r,500*(attempt+1));}); continue;
        }
        throw e;
      }
    }
    throw new Error('mutate ' + file + ': max retries');
  }

  /* 创建新文件（首次初始化） */
  async function createFile(file, data) {
    var content = b64enc(JSON.stringify(data, null, 2));
    var body = { access_token: GH_TOKEN, message: 'init ' + file, content: content, branch: GH_BRANCH };
    var pr = await fetchTimeout(apiUrl(file), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 20000);
    return pr.status === 200 || pr.status === 201;
  }

  /* ---------- 缓存 + 持久化后台同步队列 ----------
   * 队列元素为「可序列化操作」op（断网/关页面后仍可从 localStorage 恢复补传）：
   *   {file, type:'insert', item}
   *   {file, type:'update', id, patch?, append?:{records?,timeline?}}
   *   {file, type:'delete', id}
   *   {file, type:'inc', id, field, by, ref}   ref 幂等键，防止重试重复累加
   *   {file, type:'replaceAll', data}
   * ------------------------------------------------ */
  var QUEUE_KEY = 'prod_repair_pending_v1';
  var _cache = { orders: [], equipments: [], workers: [], notices: [], feedbacks: [], seq: 100 };
  var _ready = false;
  var _pulling = false;

  function fileKey(file) { return file.replace('.json', ''); }

  /* 把 op 应用到数组（纯函数、幂等，云端重试和本地重放共用） */
  function applyOp(arr, op) {
    if (!Array.isArray(arr)) arr = [];
    if (op.type === 'replaceAll') return Array.isArray(op.data) ? op.data : [];
    if (op.type === 'insert') {
      if (!arr.some(function (x) { return x.id === op.item.id; })) arr.push(op.item);
      return arr;
    }
    if (op.type === 'delete') return arr.filter(function (x) { return x.id !== op.id; });
    var idx = -1;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === op.id) { idx = i; break; }
    if (idx < 0) return arr;
    if (op.type === 'inc') {
      var y = Object.assign({}, arr[idx]);
      var refs = Array.isArray(y._incRefs) ? y._incRefs.slice() : [];
      if (!op.ref || refs.indexOf(op.ref) < 0) {
        y[op.field] = (Number(y[op.field]) || 0) + (op.by || 1);
        if (op.ref) refs.push(op.ref);
      }
      y._incRefs = refs;
      arr[idx] = y;
      return arr;
    }
    if (op.type === 'update') {
      var x = Object.assign({}, arr[idx], op.patch || {});
      if (op.append) {
        if (Array.isArray(op.append.records)) {
          x.records = (x.records || []).slice();
          op.append.records.forEach(function (r) {
            if (!x.records.some(function (z) { return z.t === r.t && z.text === r.text; })) x.records.push(r);
          });
        }
        if (Array.isArray(op.append.timeline)) {
          x.timeline = (x.timeline || []).slice();
          op.append.timeline.forEach(function (tl) {
            if (!x.timeline.some(function (z) { return z.t === tl.t && z.action === tl.action; })) x.timeline.push(tl);
          });
        }
      }
      arr[idx] = x;
      return arr;
    }
    return arr;
  }

  function loadQueue() {
    try { var q = JSON.parse(global.localStorage.getItem(QUEUE_KEY) || '[]'); return Array.isArray(q) ? q : []; }
    catch (e) { return []; }
  }
  function saveQueue() {
    try { global.localStorage.setItem(QUEUE_KEY, JSON.stringify(_sync.queue)); } catch (e) {}
  }

  var _sync = {
    queue: loadQueue(), processing: false, lastError: null, lastOk: 0,
    add: function (op) {
      this.queue.push(op);
      saveQueue();
      this.kick();
    },
    kick: function () {
      if (this.processing || this.queue.length === 0 || _pulling) return;
      this.processing = true;
      var self = this;
      this.process().then(function () { self.processing = false; },
        function (e) { self.processing = false; console.error('[sync] unhandled:', e.message); });
    },
    process: async function () {
      while (this.queue.length > 0) {
        var op = this.queue[0];
        try {
          var result = await mutateFile(op.file, function (arr) { return applyOp(arr, op); });
          _cache[fileKey(op.file)] = result;
          this.queue.shift();
          saveQueue();
          this.lastError = null;
          this.lastOk = Date.now();
        } catch (e) {
          // 网络失败/4xx 均保留 op 在队首，等待下次 kick（不丢数据）
          this.lastError = e.message;
          console.error('[sync]', op.file, op.type, ':', e.message);
          break;
        }
      }
    },
    pendingCount: function () { return this.queue.length; },
    whenIdle: function (timeoutMs) {
      var self = this;
      if (this.queue.length === 0 && !this.processing) {
        return Promise.resolve({ ok: !this.lastError, error: this.lastError });
      }
      return new Promise(function (resolve) {
        var done = false;
        function finish(ok) { if (done) return; done = true; clearInterval(iv); clearTimeout(to); resolve({ ok: ok, error: self.lastError }); }
        var iv = setInterval(function () {
          if (self.queue.length === 0 && !self.processing) finish(!self.lastError);
        }, 200);
        var to = setTimeout(function () { finish(false); }, timeoutMs || 15000);
      });
    }
  };

  /* 拉取云端数据后，把本机尚未上传的操作重放回本地缓存（避免被云端旧数据冲掉） */
  function replayPending() {
    _sync.queue.forEach(function (op) {
      if (op.type === 'replaceAll') return;
      var key = fileKey(op.file);
      if (Array.isArray(_cache[key])) _cache[key] = applyOp(_cache[key].slice(), op);
    });
    _cache.seq = Math.max(_cache.seq, 100 + _cache.orders.length);
  }

  /* ---------- 种子数据 ---------- */
  function seedEquipments() {
    var now = Date.now(), D = 864e5;
    return [
      { id: uid('e'), no: 'ZS-120T-03', name: '120T注塑机',      line: 'inject', equipType: 'injection', workstation: '注塑车间 03 号位', t: now - 200 * D },
      { id: uid('e'), no: 'ZS-90T-06',  name: '90T注塑机',        line: 'inject', equipType: 'injection', workstation: '注塑车间 06 号位', t: now - 200 * D },
      { id: uid('e'), no: 'CY-65T-01',  name: '65T精密冲床',      line: 'stamp',  equipType: 'stamp',     workstation: '冲压车间 01 号位', t: now - 190 * D },
      { id: uid('e'), no: 'ZZ-A1-07',   name: '7工位自动组装机',  line: 'asm1',   equipType: 'assembly',  workstation: '组装一线 07 工位', t: now - 180 * D },
      { id: uid('e'), no: 'YJ-B1-02',   name: '1号端子压接机',    line: 'asm1',   equipType: 'crimp',     workstation: '组装一线 02 工位', t: now - 170 * D },
      { id: uid('e'), no: 'YJ-B2-05',   name: '5号端子压接机',    line: 'asm2',   equipType: 'crimp',     workstation: '组装二线 05 工位', t: now - 160 * D },
      { id: uid('e'), no: 'CCD-QC-02',  name: 'CCD外观检测机',    line: 'qc',     equipType: 'ccd',       workstation: '检测包装车间 02 号位', t: now - 150 * D },
      { id: uid('e'), no: 'BZ-QC-01',   name: '自动包装机',       line: 'qc',     equipType: 'pack',      workstation: '检测包装车间 包装01号位', t: now - 140 * D }
    ];
  }
  function seedWorkers() {
    var now = Date.now(), D = 864e5;
    return [
      { id: 'w1', name: '王建国', phone: '138****1111', skill: '机修钳工', scope: '注塑机 / 冲压机', desc: '15年设备维修经验，擅长注塑机、冲压机机械故障', done: 126, rating: 4.9, join: now - 320 * D },
      { id: 'w2', name: '李志强', phone: '138****2222', skill: '电气工程师', scope: '自动组装机 / 电气控制', desc: 'PLC、伺服、自动化设备电气维修', done: 98, rating: 4.8, join: now - 210 * D },
      { id: 'w3', name: '张伟',   phone: '138****3333', skill: '机修钳工', scope: '端子压接机 / 组装机', desc: '压接模具、组装机构维修调试', done: 76, rating: 4.7, join: now - 180 * D },
      { id: 'w4', name: '赵敏',   phone: '138****4444', skill: '检测设备', scope: 'CCD检测机 / 激光打标', desc: '视觉检测、激光设备维护校准', done: 64, rating: 5.0, join: now - 150 * D }
    ];
  }
  function seedOrders() {
    var H = 36e5, D = 864e5, now = Date.now();
    return [
      {
        id: uid('o'), no: genOrderNo(106), line: 'inject', equipType: 'injection',
        equipNo: 'ZS-120T-03', workstation: '注塑车间 03 号位', level: 'urgent',
        fault: '注塑机开模异响，产品飞边严重，已停机待修，怀疑锁模机构磨损',
        images: [], reporter: '刘建军', phone: '138****8888',
        status: 'processing', workerId: 'w1', mode: 'grab',
        records: [
          { t: now - 40 * 6e4, text: '已到达注塑车间03号位，现场确认为锁模油缸销轴磨损，正在拆卸检查。' },
          { t: now - 15 * 6e4, text: '已更换备用销轴并重新调校锁模力，准备试模。' }
        ],
        result: '', downtimeMin: 0, rating: 0, ratingText: '', workerReply: '',
        createTime: now - 70 * 6e4, acceptTime: now - 55 * 6e4, completeTime: 0,
        timeline: [
          { t: now - 70 * 6e4, action: '提交报修', note: '操作工刘建军提交报修，系统已通知维修班' },
          { t: now - 70 * 6e4, action: '消息通知', note: '已向注塑/冲压维修方向推送报修通知' },
          { t: now - 55 * 6e4, action: '接单', note: '王建国（机修钳工）已抢单，正在前往现场' },
          { t: now - 40 * 6e4, action: '处理记录', note: '已到达现场，确认为锁模油缸销轴磨损，正在拆卸检查。' },
          { t: now - 15 * 6e4, action: '处理记录', note: '已更换备用销轴并重新调校锁模力，准备试模。' }
        ]
      },
      {
        id: uid('o'), no: genOrderNo(105), line: 'asm1', equipType: 'assembly',
        equipNo: 'ZZ-A1-07', workstation: '组装一线 07 工位', level: 'normal',
        fault: '自动组装机 7 号工位卡料，端子送料不到位，每分钟约卡停 2-3 次',
        images: [], reporter: '陈晓梅', phone: '139****6666',
        status: 'processing', workerId: 'w2', mode: 'assign',
        records: [{ t: now - 2 * H, text: '检查发现送料导轨有积胶，正在清理并调整直振振幅。' }],
        result: '', downtimeMin: 0, rating: 0, ratingText: '', workerReply: '',
        createTime: now - 3 * H, acceptTime: now - 2.5 * H, completeTime: 0,
        timeline: [
          { t: now - 3 * H, action: '提交报修', note: '操作工陈晓梅提交报修，系统已通知维修班' },
          { t: now - 3 * H, action: '消息通知', note: '已向自动化/电气维修方向推送报修通知' },
          { t: now - 2.5 * H, action: '管理员指派', note: '管理员指派 李志强（电气工程师）处理' },
          { t: now - 2 * H, action: '处理记录', note: '送料导轨积胶，正在清理并调整直振振幅。' }
        ]
      },
      {
        id: uid('o'), no: genOrderNo(104), line: 'qc', equipType: 'ccd',
        equipNo: 'CCD-QC-02', workstation: '检测包装车间 02 号位', level: 'normal',
        fault: 'CCD 检测机误报率升高，良品频繁被判定为外观不良，影响过件率',
        images: [], reporter: '孙丽', phone: '137****5555',
        status: 'pending', workerId: '', mode: '',
        records: [], result: '', downtimeMin: 0, rating: 0, ratingText: '', workerReply: '',
        createTime: now - 20 * 6e4, acceptTime: 0, completeTime: 0,
        timeline: [
          { t: now - 20 * 6e4, action: '提交报修', note: '操作工孙丽提交报修，系统已通知维修班' },
          { t: now - 20 * 6e4, action: '消息通知', note: '已向检测设备维修方向推送报修通知，等待接单' }
        ]
      },
      {
        id: uid('o'), no: genOrderNo(103), line: 'stamp', equipType: 'stamp',
        equipNo: 'CY-65T-01', workstation: '冲压车间 01 号位', level: 'urgent',
        fault: '冲压机离合器异响，滑块下行卡顿，已紧急停机',
        images: [], reporter: '周大勇', phone: '136****7777',
        status: 'done', workerId: 'w1', mode: 'grab',
        records: [{ t: now - 22 * H, text: '现场检查：离合器摩擦片磨损超标，制动间隙偏大。' }],
        result: '更换离合器摩擦片组件，重新调整制动间隙，试冲 200 次无异常，设备恢复运行。',
        downtimeMin: 95, rating: 5, ratingText: '响应很快，停机不到两小时就恢复生产了！', workerReply: '',
        createTime: now - 26 * H, acceptTime: now - 25.5 * H, completeTime: now - 23 * H,
        timeline: [
          { t: now - 26 * H, action: '提交报修', note: '操作工周大勇提交报修，系统已通知维修班' },
          { t: now - 26 * H, action: '消息通知', note: '紧急停机工单，已加急推送给全体机修人员' },
          { t: now - 25.5 * H, action: '接单', note: '王建国（机修钳工）已抢单' },
          { t: now - 22 * H, action: '处理记录', note: '离合器摩擦片磨损超标，制动间隙偏大。' },
          { t: now - 23 * H, action: '完成', note: '更换摩擦片组件并调整间隙，试冲正常，停机95分钟。' },
          { t: now - 20 * H, action: '报修人评价', note: '★★★★★ 响应很快，停机不到两小时就恢复生产！' }
        ]
      },
      {
        id: uid('o'), no: genOrderNo(102), line: 'asm2', equipType: 'crimp',
        equipNo: 'YJ-B2-05', workstation: '组装二线 05 工位', level: 'normal',
        fault: '端子压接机压接高度不稳定，抽检发现压接高度超差 0.03mm',
        images: [], reporter: '吴海燕', phone: '135****9999',
        status: 'done', workerId: 'w3', mode: 'grab',
        records: [{ t: now - 3 * D + 2 * H, text: '测量压接高度波动，发现 applicator 模具刀口磨损，更换模具配件。' }],
        result: '更换压接模具刀片并校模，首件检验压接高度合格，连续抽检 50 件均在公差内。',
        downtimeMin: 40, rating: 4, ratingText: '修好后做了首件和抽检，比较放心。', workerReply: '',
        createTime: now - 3 * D, acceptTime: now - 3 * D + 2e6, completeTime: now - 3 * D + 3 * H,
        timeline: [
          { t: now - 3 * D, action: '提交报修', note: '操作工吴海燕提交报修，系统已通知维修班' },
          { t: now - 3 * D + 2e6, action: '接单', note: '张伟（机修钳工）已抢单' },
          { t: now - 3 * D + 2 * H, action: '处理记录', note: 'applicator 模具刀口磨损，更换模具配件。' },
          { t: now - 3 * D + 3 * H, action: '完成', note: '更换模具刀片并校模，抽检合格，停机40分钟。' },
          { t: now - 2.8 * D, action: '报修人评价', note: '★★★★ 修好后做了首件和抽检，比较放心。' }
        ]
      },
      {
        id: uid('o'), no: genOrderNo(101), line: 'inject', equipType: 'injection',
        equipNo: 'ZS-90T-06', workstation: '注塑车间 06 号位', level: 'normal',
        fault: '注塑机料筒温度 3 区波动 ±15℃，产品外观有色差',
        images: [], reporter: '郑卫东', phone: '134****2222',
        status: 'done', workerId: 'w2', mode: 'assign',
        records: [],
        result: '检查为 3 区加热圈接触不良，紧固接线并更换热电偶，温度恢复稳定，色差消失。',
        downtimeMin: 30, rating: 5, ratingText: '', workerReply: '',
        createTime: now - 5 * D, acceptTime: now - 5 * D + 18e5, completeTime: now - 5 * D + 2 * H,
        timeline: [
          { t: now - 5 * D, action: '提交报修', note: '操作工郑卫东提交报修，系统已通知维修班' },
          { t: now - 5 * D + 18e5, action: '管理员指派', note: '管理员指派 李志强（电气工程师）处理' },
          { t: now - 5 * D + 2 * H, action: '完成', note: '紧固加热圈接线、更换热电偶，温度稳定，停机30分钟。' },
          { t: now - 4.8 * D, action: '报修人评价', note: '★★★★★ 评价已提交' }
        ]
      }
    ];
  }
  function seedNotices() {
    var now = Date.now(), D = 864e5;
    return [
      { id: uid('n'), title: '产线设备报修系统上线试运行通知',
        content: '产线设备报修系统即日起在注塑车间、冲压车间、组装一线、组装二线、检测包装车间开展小范围试运行。操作工发现设备故障可通过本系统填报（产线、设备编号、工位、故障现象、照片），系统将自动通知维修班，维修员抢单或管理员指派后即刻处理，全过程状态可跟踪。',
        author: '设备管理部', t: now - 2 * D },
      { id: uid('n'), title: '关于开展系统试用反馈收集的通知',
        content: '试运行期间，欢迎操作工与维修员通过「试用反馈」提交功能建议或问题反馈，管理员将逐条回复处理。紧急停机类故障请在系统报修的同时电话联系维修班，确保生产快速恢复。',
        author: '设备管理部', t: now - 1 * D },
      { id: uid('n'), title: '主设备二维码扫码报修上线通知',
        content: '设备管理部已为各产线主设备生成专属二维码并张贴于设备醒目位置。操作工发现故障后，使用微信或手机相机扫描设备上的二维码，即可自动带出设备编号、所属产线、设备类型与工位，填写故障现象后一键提交报修，无需手动选择设备信息。',
        author: '设备管理部', t: now - 1 * D }
    ];
  }
  function seedFeedbacks() {
    var now = Date.now(), D = 864e5;
    return [
      { id: uid('f'), name: '陈晓梅', role: 'operator', type: 'suggest',
        content: '建议报修时可以扫设备上的二维码自动带出设备编号和工位，省得手动输入。',
        reply: '已记录，下个版本增加按车间/产线筛选功能。', t: now - 2 * D },
      { id: uid('f'), name: '王建国', role: 'repairman', type: 'bug',
        content: '抢单列表里如果能按车间筛选就好了，注塑和冲压来回跑比较费时间。',
        reply: '已记录，下个版本增加按车间/产线筛选功能。', t: now - 1 * D }
    ];
  }

  /* ---------- 初始化 + 刷新 ---------- */
  async function init() {
    if (_ready) return;
    _pulling = true;
    var files = [
      { key: 'equipments', file: 'equipments.json', seed: seedEquipments },
      { key: 'orders',    file: 'orders.json',    seed: seedOrders },
      { key: 'workers',   file: 'workers.json',   seed: seedWorkers },
      { key: 'notices',   file: 'notices.json',   seed: seedNotices },
      { key: 'feedbacks', file: 'feedbacks.json', seed: seedFeedbacks }
    ];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        var data = await pullFile(f.file);
        if (data !== null && Array.isArray(data)) {
          _cache[f.key] = data;
        } else {
          // 文件不存在，创建种子数据
          var sd = f.seed();
          await createFile(f.file, sd);
          _cache[f.key] = sd;
        }
      } catch (e) {
        console.error('[init] ' + f.file + ':', e.message);
        _cache[f.key] = f.seed();
      }
    }
    _cache.seq = 100 + _cache.orders.length;
    // 重放本机历史未上传的操作，并立即尝试补传
    replayPending();
    _ready = true;
    _pulling = false;
    _sync.kick();
  }

  async function refresh() {
    if (_pulling || _sync.processing) return false;
    _pulling = true;
    var changed = false;
    var files = ['equipments', 'orders', 'workers', 'notices', 'feedbacks'];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        var data = await pullFile(f + '.json');
        if (data !== null && Array.isArray(data) && JSON.stringify(data) !== JSON.stringify(_cache[f])) {
          _cache[f] = data;
          changed = true;
        }
      } catch (e) { /* 忽略单个文件错误 */ }
    }
    // 云端数据覆盖后，重新叠加上本机待上传的操作
    if (_sync.queue.length > 0) { replayPending(); changed = true; }
    _cache.seq = Math.max(_cache.seq, 100 + _cache.orders.length);
    _pulling = false;
    // 拉取成功说明网络可达，顺便尝试补传
    if (_sync.queue.length > 0) _sync.kick();
    return changed;
  }

  /* ---------- API ---------- */
  var API = {
    LINES: LINES, EQUIP_TYPES: EQUIP_TYPES, LEVELS: LEVELS, STATUS: STATUS, FEEDBACK_TYPES: FEEDBACK_TYPES,
    fmtTime: fmtTime, fmtDuration: fmtDuration, getLine: getLine, getEquipType: getEquipType,
    init: init, refresh: refresh, ready: function () { return _ready; },
    whenSynced: function (ms) { return _sync.whenIdle(ms); },
    pendingCount: function () { return _sync.pendingCount(); },
    kickSync: function () { _sync.kick(); },
    isOrderPending: function (id) {
      return _sync.queue.some(function (op) {
        if (op.file !== 'orders.json') return false;
        return (op.type === 'insert' && op.item && op.item.id === id) || op.id === id;
      });
    },
    debugSync: function () { return { processing: _sync.processing, queueLen: _sync.queue.length, lastError: _sync.lastError, lastOk: _sync.lastOk }; },
    testWrite: async function () {
      try {
        var meta = await getFileMeta('orders.json');
        return 'meta OK: sha=' + (meta.sha ? meta.sha.substring(0, 7) : 'null') + ' len=' + (meta.data ? meta.data.length : 'null');
      } catch (e) { return 'meta ERR: ' + e.message; }
    },

    /* 角色存取（localStorage） */
    getRole: function () {
      try { return JSON.parse(global.localStorage.getItem(ROLE_KEY)) || null; }
      catch (e) { return null; }
    },
    setRole: function (role) { global.localStorage.setItem(ROLE_KEY, JSON.stringify(role)); },
    clearRole: function () { global.localStorage.removeItem(ROLE_KEY); },

    /* 图片压缩 */
    compressImage: function (file, maxSize) {
      maxSize = maxSize || 800;
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function (e) {
          var img = new Image();
          img.onload = function () {
            var w = img.width, h = img.height;
            if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
            else if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', 0.6));
          };
          img.onerror = reject; img.src = e.target.result;
        };
        reader.onerror = reject; reader.readAsDataURL(file);
      });
    },

    /* ---------- 工单 ---------- */
    createOrder: function (d) {
      // 工单号取「当天已有工单号最大序号 +1」，避免跨设备撞号
      var dd = new Date();
      var todayPrefix = 'BX' + dd.getFullYear() + pad(dd.getMonth() + 1) + pad(dd.getDate());
      var maxSeq = 100;
      _cache.orders.forEach(function (x) {
        if (x.no && x.no.indexOf(todayPrefix) === 0) {
          var n = parseInt(x.no.slice(10), 10);
          if (!isNaN(n) && n > maxSeq) maxSeq = n;
        }
      });
      _cache.seq = Math.max(_cache.seq, maxSeq + 1);
      var now = Date.now();
      var o = {
        id: uid('o'), no: genOrderNo(_cache.seq),
        line: d.line, equipType: d.equipType, equipNo: d.equipNo,
        workstation: d.workstation, level: d.level || 'normal',
        fault: d.fault, images: d.images || [],
        reporter: d.reporter, phone: d.phone || '',
        status: 'pending', workerId: '', mode: '',
        records: [], result: '', downtimeMin: 0,
        rating: 0, ratingText: '', workerReply: '',
        createTime: now, acceptTime: 0, completeTime: 0,
        timeline: [
          { t: now, action: '提交报修', note: '操作工' + d.reporter + '提交报修，系统已通知维修班' },
          { t: now, action: '消息通知', note: '已向相关维修方向推送报修通知，等待接单' }
        ]
      };
      _cache.orders.unshift(o);
      _sync.add({ file: 'orders.json', type: 'insert', item: o });
      return o;
    },
    listOrders: function (status) {
      if (!status || status === 'all') return _cache.orders.slice();
      return _cache.orders.filter(function (o) { return o.status === status; });
    },
    listByWorker: function (workerId) {
      return _cache.orders.filter(function (o) { return o.workerId === workerId; });
    },
    getOrder: function (id) {
      for (var i = 0; i < _cache.orders.length; i++) if (_cache.orders[i].id === id) return _cache.orders[i];
      return null;
    },
    grab: function (orderId, workerId) {
      var o = this.getOrder(orderId); var w = this.getWorker(workerId);
      if (!o || !w || o.status !== 'pending') return false;
      var now = Date.now(); var note = w.name + '（' + w.skill + '）已抢单，正在前往现场';
      o.status = 'processing'; o.workerId = workerId; o.mode = 'grab'; o.acceptTime = now;
      addTL(o, '接单', note, now);
      _sync.add({ file: 'orders.json', type: 'update', id: orderId,
        patch: { status: 'processing', workerId: workerId, mode: 'grab', acceptTime: now },
        append: { timeline: [{ t: now, action: '接单', note: note }] } });
      return true;
    },
    assign: function (orderId, workerId) {
      var o = this.getOrder(orderId); var w = this.getWorker(workerId);
      if (!o || !w || o.status !== 'pending') return false;
      var now = Date.now(); var note = '管理员指派 ' + w.name + '（' + w.skill + '）处理，维修员已收到通知';
      o.status = 'processing'; o.workerId = workerId; o.mode = 'assign'; o.acceptTime = now;
      addTL(o, '管理员指派', note, now);
      _sync.add({ file: 'orders.json', type: 'update', id: orderId,
        patch: { status: 'processing', workerId: workerId, mode: 'assign', acceptTime: now },
        append: { timeline: [{ t: now, action: '管理员指派', note: note }] } });
      return true;
    },
    addRecord: function (orderId, text) {
      var o = this.getOrder(orderId);
      if (!o || o.status !== 'processing') return false;
      var now = Date.now();
      o.records.push({ t: now, text: text });
      addTL(o, '处理记录', text, now);
      _sync.add({ file: 'orders.json', type: 'update', id: orderId,
        append: { records: [{ t: now, text: text }], timeline: [{ t: now, action: '处理记录', note: text }] } });
      return true;
    },
    complete: function (orderId, result, downtimeMin) {
      var o = this.getOrder(orderId);
      if (!o || o.status !== 'processing') return false;
      var now = Date.now();
      o.status = 'done'; o.result = result || '故障已排除，设备恢复正常运行。';
      o.downtimeMin = Number(downtimeMin) || 0; o.completeTime = now;
      if (o.workerId) { var w = this.getWorker(o.workerId); if (w) w.done += 1; }
      var note = o.result + (o.downtimeMin ? '（停机约 ' + o.downtimeMin + ' 分钟）' : '');
      addTL(o, '完成', note, now);
      _sync.add({ file: 'orders.json', type: 'update', id: orderId,
        patch: { status: 'done', result: o.result, downtimeMin: o.downtimeMin, completeTime: now },
        append: { timeline: [{ t: now, action: '完成', note: note }] } });
      // 维修员完成数 +1（幂等：以工单号为 ref，重试不会重复累加）
      if (o.workerId) {
        _sync.add({ file: 'workers.json', type: 'inc', id: o.workerId, field: 'done', by: 1, ref: orderId });
      }
      return true;
    },
    rate: function (orderId, score, text) {
      var o = this.getOrder(orderId);
      if (!o || o.status !== 'done') return false;
      var now = Date.now();
      o.rating = score; o.ratingText = text || '';
      var stars = ''; for (var i = 0; i < score; i++) stars += '★';
      addTL(o, '报修人评价', stars + (text ? ' ' + text : ' 感谢反馈'), now);
      _sync.add({ file: 'orders.json', type: 'update', id: orderId,
        patch: { rating: score, ratingText: text || '' },
        append: { timeline: [{ t: now, action: '报修人评价', note: stars + (text ? ' ' + text : ' 感谢反馈') }] } });
      return true;
    },
    replyRating: function (orderId, text) {
      var o = this.getOrder(orderId);
      if (!o || o.status !== 'done' || !o.rating) return false;
      var now = Date.now();
      o.workerReply = text;
      addTL(o, '维修员回复', text, now);
      _sync.add({ file: 'orders.json', type: 'update', id: orderId,
        patch: { workerReply: text },
        append: { timeline: [{ t: now, action: '维修员回复', note: text }] } });
      return true;
    },

    /* ---------- 维修人员 ---------- */
    listWorkers: function () { return _cache.workers.slice(); },
    getWorker: function (id) {
      for (var i = 0; i < _cache.workers.length; i++) if (_cache.workers[i].id === id) return _cache.workers[i];
      return null;
    },
    addWorker: function (d) {
      var w = { id: uid('w'), name: d.name, phone: d.phone, skill: d.skill, scope: d.scope || '', desc: d.desc || '', done: 0, rating: 5.0, join: Date.now() };
      _cache.workers.push(w);
      _sync.add({ file: 'workers.json', type: 'insert', item: w });
      return w;
    },
    removeWorker: function (id) {
      _cache.workers = _cache.workers.filter(function (w) { return w.id !== id; });
      _sync.add({ file: 'workers.json', type: 'delete', id: id });
    },
    workerBusy: function (id) { return _cache.orders.some(function (o) { return o.workerId === id && o.status === 'processing'; }); },

    /* ---------- 试用反馈 ---------- */
    listFeedbacks: function () { return _cache.feedbacks.slice().sort(function (a, b) { return b.t - a.t; }); },
    addFeedback: function (d) {
      var f = { id: uid('fb'), name: d.name, role: d.role, type: d.type, content: d.content, reply: '', t: Date.now() };
      _cache.feedbacks.unshift(f);
      _sync.add({ file: 'feedbacks.json', type: 'insert', item: f });
      return f;
    },
    replyFeedback: function (id, reply) {
      for (var i = 0; i < _cache.feedbacks.length; i++) {
        if (_cache.feedbacks[i].id === id) { _cache.feedbacks[i].reply = reply; break; }
      }
      _sync.add({ file: 'feedbacks.json', type: 'update', id: id, patch: { reply: reply } });
      return true;
    },

    /* ---------- 通知公告 ---------- */
    listNotices: function () { return _cache.notices.slice().sort(function (a, b) { return b.t - a.t; }); },
    addNotice: function (title, content, author) {
      var n = { id: uid('n'), title: title, content: content, author: author || '设备管理部', t: Date.now() };
      _cache.notices.unshift(n);
      _sync.add({ file: 'notices.json', type: 'insert', item: n });
      return n;
    },
    removeNotice: function (id) {
      _cache.notices = _cache.notices.filter(function (n) { return n.id !== id; });
      _sync.add({ file: 'notices.json', type: 'delete', id: id });
    },

    /* ---------- 主设备台账 ---------- */
    listEquipments: function () { return _cache.equipments.slice().sort(function (a, b) { return a.no < b.no ? -1 : 1; }); },
    getEquipment: function (id) {
      for (var i = 0; i < _cache.equipments.length; i++) if (_cache.equipments[i].id === id) return _cache.equipments[i];
      return null;
    },
    getEquipmentByNo: function (no) {
      no = String(no || '').trim().toUpperCase();
      for (var i = 0; i < _cache.equipments.length; i++) {
        if (_cache.equipments[i].no.toUpperCase() === no) return _cache.equipments[i];
      }
      return null;
    },
    addEquipment: function (d) {
      var no = String(d.no || '').trim().toUpperCase();
      if (!no) return { ok: false, msg: '请填写主设备编号' };
      if (this.getEquipmentByNo(no)) return { ok: false, msg: '设备编号「' + no + '」已存在，不能重复绑定' };
      var lineOk = LINES.some(function (l) { return l.id === d.line; });
      var typeOk = EQUIP_TYPES.some(function (t) { return t.id === d.equipType; });
      if (!lineOk || !typeOk) return { ok: false, msg: '请选择所属产线和设备类型' };
      var e = { id: uid('e'), no: no, name: String(d.name || '').trim() || getEquipType(d.equipType).name, line: d.line, equipType: d.equipType, workstation: String(d.workstation || '').trim(), t: Date.now() };
      _cache.equipments.push(e);
      _sync.add({ file: 'equipments.json', type: 'insert', item: e });
      return { ok: true, equipment: e };
    },
    updateEquipment: function (id, d) {
      var e = this.getEquipment(id); if (!e) return false;
      var no = String(d.no || '').trim().toUpperCase(); if (!no) return false;
      var dup = this.getEquipmentByNo(no); if (dup && dup.id !== id) return false;
      e.no = no; e.name = String(d.name || '').trim() || getEquipType(d.equipType).name;
      e.line = d.line; e.equipType = d.equipType; e.workstation = String(d.workstation || '').trim();
      _sync.add({ file: 'equipments.json', type: 'update', id: id,
        patch: { no: e.no, name: e.name, line: e.line, equipType: e.equipType, workstation: e.workstation } });
      return true;
    },
    removeEquipment: function (id) {
      _cache.equipments = _cache.equipments.filter(function (e) { return e.id !== id; });
      _sync.add({ file: 'equipments.json', type: 'delete', id: id });
    },

    /* ---------- 统计 ---------- */
    stats: function () {
      var orders = _cache.orders;
      var total = orders.length;
      var pending = orders.filter(function (o) { return o.status === 'pending'; }).length;
      var processing = orders.filter(function (o) { return o.status === 'processing'; }).length;
      var done = orders.filter(function (o) { return o.status === 'done'; }).length;
      var responded = orders.filter(function (o) { return o.acceptTime; });
      var avgRespond = responded.length ? responded.reduce(function (s, o) { return s + (o.acceptTime - o.createTime) / 6e4; }, 0) / responded.length : 0;
      var finished = orders.filter(function (o) { return o.completeTime; });
      var avgRepair = finished.length ? finished.reduce(function (s, o) { return s + (o.completeTime - o.acceptTime) / 6e4; }, 0) / finished.length : 0;
      var downtime = orders.reduce(function (s, o) { return s + (o.downtimeMin || 0); }, 0);
      var rated = orders.filter(function (o) { return o.rating > 0; });
      var avgRating = rated.length ? (rated.reduce(function (s, o) { return s + o.rating; }, 0) / rated.length).toFixed(1) : '5.0';
      var byLine = LINES.map(function (l) { return { line: l, count: orders.filter(function (o) { return o.line === l.id; }).length }; });
      var byType = EQUIP_TYPES.map(function (t) { return { type: t, count: orders.filter(function (o) { return o.equipType === t.id; }).length }; }).filter(function (x) { return x.count > 0; }).sort(function (a, b) { return b.count - a.count; });
      var days = [];
      for (var i = 6; i >= 0; i--) {
        var ds = new Date(); ds.setHours(0, 0, 0, 0); ds = ds.getTime() - i * 864e5;
        var de = ds + 864e5; var dd = new Date(ds);
        days.push({ label: (dd.getMonth() + 1) + '/' + dd.getDate(), count: orders.filter(function (o) { return o.createTime >= ds && o.createTime < de; }).length });
      }
      var workers = _cache.workers.map(function (w) {
        var mine = orders.filter(function (o) { return o.workerId === w.id; });
        return { worker: w, doing: mine.filter(function (o) { return o.status === 'processing'; }).length, done: mine.filter(function (o) { return o.status === 'done'; }).length };
      }).sort(function (a, b) { return (b.doing + b.done) - (a.doing + a.done); });
      return {
        total: total, pending: pending, processing: processing, done: done,
        closeRate: total ? Math.round(done / total * 100) + '%' : '0%',
        avgRespond: avgRespond, avgRepair: avgRepair, downtime: downtime, avgRating: avgRating,
        urgent: orders.filter(function (o) { return o.level === 'urgent' && o.status !== 'done'; }).length,
        feedbackCount: _cache.feedbacks.length, byLine: byLine, byType: byType, days: days, workers: workers
      };
    },

    /* 重置（重新播种，覆盖云端；清空历史待补传队列） */
    reset: function () {
      _cache.orders = seedOrders(); _cache.equipments = seedEquipments();
      _cache.workers = seedWorkers(); _cache.notices = seedNotices(); _cache.feedbacks = seedFeedbacks();
      _cache.seq = 100 + _cache.orders.length;
      global.localStorage.removeItem('prod_repair_db_v1');
      _sync.queue = [];
      ['orders', 'equipments', 'workers', 'notices', 'feedbacks'].forEach(function (f) {
        _sync.add({ file: f + '.json', type: 'replaceAll', data: _cache[f] });
      });
    }
  };

  global.RepairDB = API;
})(window);
