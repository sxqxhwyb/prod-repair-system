/* ============================================================
 * 产线报修系统（连接器制造） - 数据层
 * 状态机：待处理(pending) → 处理中(processing) → 已完成(done)
 * 角色：操作工 operator / 维修员 repairman / 管理员 admin
 * ============================================================ */
(function (global) {
  'use strict';

  var DB_KEY = 'prod_repair_db_v1';
  var ROLE_KEY = 'prod_repair_role_v1';

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

  // 待处理 → 处理中 → 已完成
  var STATUS = {
    pending:    { name: '待处理', color: '#f59e0b', bg: '#fef3c7' },
    processing: { name: '处理中', color: '#3b82f6', bg: '#dbeafe' },
    done:       { name: '已完成', color: '#10b981', bg: '#d1fae5' }
  };

  var FEEDBACK_TYPES = {
    suggest: '功能建议',
    bug: '问题反馈',
    other: '其他'
  };

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

  /* ---------- 演示数据 ---------- */
  function seed() {
    var H = 3600 * 1000, D = 24 * H, now = Date.now();

    var workers = [
      { id: 'w1', name: '王建国', phone: '138****1111', skill: '机修钳工', scope: '注塑机 / 冲压机', desc: '15年设备维修经验，擅长注塑机、冲压机机械故障', done: 126, rating: 4.9, join: now - 320 * D },
      { id: 'w2', name: '李志强', phone: '138****2222', skill: '电气工程师', scope: '自动组装机 / 电气控制', desc: 'PLC、伺服、自动化设备电气维修', done: 98, rating: 4.8, join: now - 210 * D },
      { id: 'w3', name: '张伟',   phone: '138****3333', skill: '机修钳工', scope: '端子压接机 / 组装机', desc: '压接模具、组装机构维修调试', done: 76, rating: 4.7, join: now - 180 * D },
      { id: 'w4', name: '赵敏',   phone: '138****4444', skill: '检测设备', scope: 'CCD检测机 / 激光打标', desc: '视觉检测、激光设备维护校准', done: 64, rating: 5.0, join: now - 150 * D }
    ];

    var orders = [
      {
        id: uid('o'), no: genOrderNo(106), line: 'inject', equipType: 'injection',
        equipNo: 'ZS-120T-03', workstation: '注塑车间 03 号位', level: 'urgent',
        fault: '注塑机开模异响，产品飞边严重，已停机待修，怀疑锁模机构磨损',
        images: [], reporter: '刘建军', phone: '138****8888',
        status: 'processing', workerId: 'w1', mode: 'grab',
        records: [
          { t: now - 40 * 60000, text: '已到达注塑车间03号位，现场确认为锁模油缸销轴磨损，正在拆卸检查。' },
          { t: now - 15 * 60000, text: '已更换备用销轴并重新调校锁模力，准备试模。' }
        ],
        result: '', downtimeMin: 0, rating: 0, ratingText: '',
        createTime: now - 70 * 60000, acceptTime: now - 55 * 60000, completeTime: 0,
        timeline: [
          { t: now - 70 * 60000, action: '提交报修', note: '操作工刘建军提交报修，系统已通知维修班' },
          { t: now - 70 * 60000, action: '消息通知', note: '已向注塑/冲压维修方向推送报修通知' },
          { t: now - 55 * 60000, action: '接单', note: '王建国（机修钳工）已抢单，正在前往现场' },
          { t: now - 40 * 60000, action: '处理记录', note: '已到达现场，确认为锁模油缸销轴磨损，正在拆卸检查。' },
          { t: now - 15 * 60000, action: '处理记录', note: '已更换备用销轴并重新调校锁模力，准备试模。' }
        ]
      },
      {
        id: uid('o'), no: genOrderNo(105), line: 'asm1', equipType: 'assembly',
        equipNo: 'ZZ-A1-07', workstation: '组装一线 07 工位', level: 'normal',
        fault: '自动组装机 7 号工位卡料，端子送料不到位，每分钟约卡停 2-3 次',
        images: [], reporter: '陈晓梅', phone: '139****6666',
        status: 'processing', workerId: 'w2', mode: 'assign',
        records: [
          { t: now - 2 * H, text: '检查发现送料导轨有积胶，正在清理并调整直振振幅。' }
        ],
        result: '', downtimeMin: 0, rating: 0, ratingText: '',
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
        records: [], result: '', downtimeMin: 0, rating: 0, ratingText: '',
        createTime: now - 20 * 60000, acceptTime: 0, completeTime: 0,
        timeline: [
          { t: now - 20 * 60000, action: '提交报修', note: '操作工孙丽提交报修，系统已通知维修班' },
          { t: now - 20 * 60000, action: '消息通知', note: '已向检测设备维修方向推送报修通知，等待接单' }
        ]
      },
      {
        id: uid('o'), no: genOrderNo(103), line: 'stamp', equipType: 'stamp',
        equipNo: 'CY-65T-01', workstation: '冲压车间 01 号位', level: 'urgent',
        fault: '冲压机离合器异响，滑块下行卡顿，已紧急停机',
        images: [], reporter: '周大勇', phone: '136****7777',
        status: 'done', workerId: 'w1', mode: 'grab',
        records: [
          { t: now - 22 * H, text: '现场检查：离合器摩擦片磨损超标，制动间隙偏大。' }
        ],
        result: '更换离合器摩擦片组件，重新调整制动间隙，试冲 200 次无异常，设备恢复运行。',
        downtimeMin: 95, rating: 5, ratingText: '响应很快，停机不到两小时就恢复生产了！',
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
        records: [
          { t: now - 3 * D + 2 * H, text: '测量压接高度波动，发现 applicator 模具刀口磨损，更换模具配件。' }
        ],
        result: '更换压接模具刀片并校模，首件检验压接高度合格，连续抽检 50 件均在公差内。',
        downtimeMin: 40, rating: 4, ratingText: '修好后做了首件和抽检，比较放心。',
        createTime: now - 3 * D, acceptTime: now - 3 * D + 20 * 60000, completeTime: now - 3 * D + 3 * H,
        timeline: [
          { t: now - 3 * D, action: '提交报修', note: '操作工吴海燕提交报修，系统已通知维修班' },
          { t: now - 3 * D + 20 * 60000, action: '接单', note: '张伟（机修钳工）已抢单' },
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
        downtimeMin: 30, rating: 5, ratingText: '',
        createTime: now - 5 * D, acceptTime: now - 5 * D + 30 * 60000, completeTime: now - 5 * D + 2 * H,
        timeline: [
          { t: now - 5 * D, action: '提交报修', note: '操作工郑卫东提交报修，系统已通知维修班' },
          { t: now - 5 * D + 30 * 60000, action: '管理员指派', note: '管理员指派 李志强（电气工程师）处理' },
          { t: now - 5 * D + 2 * H, action: '完成', note: '紧固加热圈接线、更换热电偶，温度稳定，停机30分钟。' },
          { t: now - 4.8 * D, action: '报修人评价', note: '★★★★★ 评价已提交' }
        ]
      }
    ];

    var feedbacks = [
      { id: uid('f'), name: '陈晓梅', role: 'operator', type: 'suggest',
        content: '建议报修时可以扫设备上的二维码自动带出设备编号和工位，省得手动输入。',
        reply: '', t: now - 2 * D },
      { id: uid('f'), name: '王建国', role: 'repairman', type: 'bug',
        content: '抢单列表里如果能按车间筛选就好了，注塑和冲压来回跑比较费时间。',
        reply: '已记录，下个版本增加按车间/产线筛选功能。', t: now - 1 * D }
    ];

    var notices = [
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

    // 主设备台账：二维码与主设备编号一一绑定
    var equipments = [
      { id: uid('e'), no: 'ZS-120T-03', name: '120T注塑机',       line: 'inject', equipType: 'injection', workstation: '注塑车间 03 号位', t: now - 200 * D },
      { id: uid('e'), no: 'ZS-90T-06',  name: '90T注塑机',        line: 'inject', equipType: 'injection', workstation: '注塑车间 06 号位', t: now - 200 * D },
      { id: uid('e'), no: 'CY-65T-01',  name: '65T精密冲床',      line: 'stamp',  equipType: 'stamp',     workstation: '冲压车间 01 号位', t: now - 190 * D },
      { id: uid('e'), no: 'ZZ-A1-07',   name: '7工位自动组装机',  line: 'asm1',   equipType: 'assembly',  workstation: '组装一线 07 工位', t: now - 180 * D },
      { id: uid('e'), no: 'YJ-B1-02',   name: '1号端子压接机',    line: 'asm1',   equipType: 'crimp',     workstation: '组装一线 02 工位', t: now - 170 * D },
      { id: uid('e'), no: 'YJ-B2-05',   name: '5号端子压接机',    line: 'asm2',   equipType: 'crimp',     workstation: '组装二线 05 工位', t: now - 160 * D },
      { id: uid('e'), no: 'CCD-QC-02',  name: 'CCD外观检测机',    line: 'qc',     equipType: 'ccd',       workstation: '检测包装车间 02 号位', t: now - 150 * D },
      { id: uid('e'), no: 'BZ-QC-01',   name: '自动包装机',       line: 'qc',     equipType: 'pack',      workstation: '检测包装车间 包装01号位', t: now - 140 * D }
    ];

    return { workers: workers, orders: orders, feedbacks: feedbacks, notices: notices, equipments: equipments, seq: 107 };
  }

  /* ---------- 存取 ---------- */
  function load() {
    try {
      var raw = global.localStorage.getItem(DB_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        // 兼容旧版本残留数据：补齐新增字段
        d.workers = Array.isArray(d.workers) ? d.workers : [];
        d.orders = Array.isArray(d.orders) ? d.orders : [];
        d.feedbacks = Array.isArray(d.feedbacks) ? d.feedbacks : [];
        d.notices = Array.isArray(d.notices) ? d.notices : [];
        d.equipments = Array.isArray(d.equipments) ? d.equipments : [];
        if (typeof d.seq !== 'number') d.seq = 100 + d.orders.length;
        return d;
      }
    } catch (e) { /* ignore */ }
    var db = seed();
    save(db);
    return db;
  }
  function save(db) { global.localStorage.setItem(DB_KEY, JSON.stringify(db)); }

  var db = load();
  function persist() { save(db); }

  function addTL(o, action, note) {
    o.timeline.push({ t: Date.now(), action: action, note: note || '' });
  }

  var API = {
    LINES: LINES,
    EQUIP_TYPES: EQUIP_TYPES,
    LEVELS: LEVELS,
    STATUS: STATUS,
    FEEDBACK_TYPES: FEEDBACK_TYPES,
    fmtTime: fmtTime,
    fmtDuration: fmtDuration,
    getLine: getLine,
    getEquipType: getEquipType,

    /* 角色存取 */
    getRole: function () {
      try { return JSON.parse(global.localStorage.getItem(ROLE_KEY)) || null; }
      catch (e) { return null; }
    },
    setRole: function (role) { global.localStorage.setItem(ROLE_KEY, JSON.stringify(role)); },
    clearRole: function () { global.localStorage.removeItem(ROLE_KEY); },

    /* 图片压缩 */
    compressImage: function (file, maxSize) {
      maxSize = maxSize || 900;
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
            resolve(c.toDataURL('image/jpeg', 0.72));
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    /* ---------- 工单 ---------- */
    createOrder: function (d) {
      db.seq += 1;
      var now = Date.now();
      var o = {
        id: uid('o'), no: genOrderNo(db.seq),
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
      db.orders.unshift(o);
      persist();
      return o;
    },

    listOrders: function (status) {
      if (!status || status === 'all') return db.orders.slice();
      return db.orders.filter(function (o) { return o.status === status; });
    },
    listByWorker: function (workerId) {
      return db.orders.filter(function (o) { return o.workerId === workerId; });
    },
    getOrder: function (id) {
      for (var i = 0; i < db.orders.length; i++) if (db.orders[i].id === id) return db.orders[i];
      return null;
    },

    /* 接单（抢单） */
    grab: function (orderId, workerId) {
      var o = this.getOrder(orderId);
      var w = this.getWorker(workerId);
      if (!o || !w || o.status !== 'pending') return false;
      o.status = 'processing';
      o.workerId = workerId;
      o.mode = 'grab';
      o.acceptTime = Date.now();
      addTL(o, '接单', w.name + '（' + w.skill + '）已抢单，正在前往现场');
      persist();
      return true;
    },

    /* 管理员指派 */
    assign: function (orderId, workerId) {
      var o = this.getOrder(orderId);
      var w = this.getWorker(workerId);
      if (!o || !w || o.status !== 'pending') return false;
      o.status = 'processing';
      o.workerId = workerId;
      o.mode = 'assign';
      o.acceptTime = Date.now();
      addTL(o, '管理员指派', '管理员指派 ' + w.name + '（' + w.skill + '）处理，维修员已收到通知');
      persist();
      return true;
    },

    /* 添加处理过程记录 */
    addRecord: function (orderId, text) {
      var o = this.getOrder(orderId);
      if (!o || o.status !== 'processing') return false;
      o.records.push({ t: Date.now(), text: text });
      addTL(o, '处理记录', text);
      persist();
      return true;
    },

    /* 完成工单 */
    complete: function (orderId, result, downtimeMin) {
      var o = this.getOrder(orderId);
      if (!o || o.status !== 'processing') return false;
      o.status = 'done';
      o.result = result || '故障已排除，设备恢复正常运行。';
      o.downtimeMin = Number(downtimeMin) || 0;
      o.completeTime = Date.now();
      if (o.workerId) {
        var w = this.getWorker(o.workerId);
        if (w) w.done += 1;
      }
      var note = o.result + (o.downtimeMin ? '（停机约 ' + o.downtimeMin + ' 分钟）' : '');
      addTL(o, '完成', note);
      persist();
      return true;
    },

    /* 报修人评价 */
    rate: function (orderId, score, text) {
      var o = this.getOrder(orderId);
      if (!o || o.status !== 'done') return false;
      o.rating = score;
      o.ratingText = text || '';
      var stars = '';
      for (var i = 0; i < score; i++) stars += '★';
      addTL(o, '报修人评价', stars + (text ? ' ' + text : ' 感谢反馈'));
      persist();
      return true;
    },

    /* ---------- 维修人员 ---------- */
    listWorkers: function () { return db.workers.slice(); },
    getWorker: function (id) {
      for (var i = 0; i < db.workers.length; i++) if (db.workers[i].id === id) return db.workers[i];
      return null;
    },
    addWorker: function (d) {
      var w = {
        id: uid('w'), name: d.name, phone: d.phone, skill: d.skill,
        scope: d.scope || '', desc: d.desc || '',
        done: 0, rating: 5.0, join: Date.now()
      };
      db.workers.push(w);
      persist();
      return w;
    },
    removeWorker: function (id) {
      db.workers = db.workers.filter(function (w) { return w.id !== id; });
      persist();
    },
    workerBusy: function (id) {
      return db.orders.some(function (o) { return o.workerId === id && o.status === 'processing'; });
    },

    /* ---------- 试用反馈 ---------- */
    listFeedbacks: function () { return db.feedbacks.slice().sort(function (a, b) { return b.t - a.t; }); },
    addFeedback: function (d) {
      var f = { id: uid('fb'), name: d.name, role: d.role, type: d.type, content: d.content, reply: '', t: Date.now() };
      db.feedbacks.unshift(f);
      persist();
      return f;
    },
    replyFeedback: function (id, reply) {
      for (var i = 0; i < db.feedbacks.length; i++) {
        if (db.feedbacks[i].id === id) { db.feedbacks[i].reply = reply; persist(); return true; }
      }
      return false;
    },

    /* ---------- 通知公告（管理员发布，三角色可见） ---------- */
    listNotices: function () {
      return db.notices.slice().sort(function (a, b) { return b.t - a.t; });
    },
    addNotice: function (title, content, author) {
      var n = { id: uid('n'), title: title, content: content, author: author || '设备管理部', t: Date.now() };
      db.notices.unshift(n);
      persist();
      return n;
    },
    removeNotice: function (id) {
      db.notices = db.notices.filter(function (n) { return n.id !== id; });
      persist();
    },

    /* ---------- 主设备台账（二维码绑定主设备编号） ---------- */
    listEquipments: function () { return db.equipments.slice().sort(function (a, b) { return a.no < b.no ? -1 : 1; }); },
    getEquipment: function (id) {
      for (var i = 0; i < db.equipments.length; i++) if (db.equipments[i].id === id) return db.equipments[i];
      return null;
    },
    getEquipmentByNo: function (no) {
      no = String(no || '').trim().toUpperCase();
      for (var i = 0; i < db.equipments.length; i++) {
        if (db.equipments[i].no.toUpperCase() === no) return db.equipments[i];
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
      var e = {
        id: uid('e'), no: no, name: String(d.name || '').trim() || getEquipType(d.equipType).name,
        line: d.line, equipType: d.equipType,
        workstation: String(d.workstation || '').trim(), t: Date.now()
      };
      db.equipments.push(e);
      persist();
      return { ok: true, equipment: e };
    },
    updateEquipment: function (id, d) {
      var e = this.getEquipment(id);
      if (!e) return false;
      var no = String(d.no || '').trim().toUpperCase();
      var dup = this.getEquipmentByNo(no);
      if (!no) return false;
      if (dup && dup.id !== id) return false;
      e.no = no;
      e.name = String(d.name || '').trim() || getEquipType(d.equipType).name;
      e.line = d.line; e.equipType = d.equipType;
      e.workstation = String(d.workstation || '').trim();
      persist();
      return true;
    },
    removeEquipment: function (id) {
      db.equipments = db.equipments.filter(function (e) { return e.id !== id; });
      persist();
    },

    /* 维修员回复报修人评价 */
    replyRating: function (orderId, text) {
      var o = this.getOrder(orderId);
      if (!o || o.status !== 'done' || !o.rating) return false;
      o.workerReply = text;
      addTL(o, '维修员回复', text);
      persist();
      return true;
    },

    /* ---------- 统计 ---------- */
    stats: function () {
      var orders = db.orders;
      var total = orders.length;
      var pending = orders.filter(function (o) { return o.status === 'pending'; }).length;
      var processing = orders.filter(function (o) { return o.status === 'processing'; }).length;
      var done = orders.filter(function (o) { return o.status === 'done'; }).length;

      // 平均响应时长（报修→接单，分钟）
      var responded = orders.filter(function (o) { return o.acceptTime; });
      var avgRespond = responded.length
        ? responded.reduce(function (s, o) { return s + (o.acceptTime - o.createTime) / 60000; }, 0) / responded.length
        : 0;
      // 平均维修时长（接单→完成）
      var finished = orders.filter(function (o) { return o.completeTime; });
      var avgRepair = finished.length
        ? finished.reduce(function (s, o) { return s + (o.completeTime - o.acceptTime) / 60000; }, 0) / finished.length
        : 0;
      // 累计停机时长
      var downtime = orders.reduce(function (s, o) { return s + (o.downtimeMin || 0); }, 0);
      // 平均评分
      var rated = orders.filter(function (o) { return o.rating > 0; });
      var avgRating = rated.length
        ? (rated.reduce(function (s, o) { return s + o.rating; }, 0) / rated.length).toFixed(1)
        : '5.0';

      var byLine = LINES.map(function (l) {
        return { line: l, count: orders.filter(function (o) { return o.line === l.id; }).length };
      });
      var byType = EQUIP_TYPES.map(function (t) {
        return { type: t, count: orders.filter(function (o) { return o.equipType === t.id; }).length };
      }).filter(function (x) { return x.count > 0; })
        .sort(function (a, b) { return b.count - a.count; });

      var days = [];
      for (var i = 6; i >= 0; i--) {
        var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        dayStart = dayStart.getTime() - i * 24 * 3600 * 1000;
        var dayEnd = dayStart + 24 * 3600 * 1000;
        var c = orders.filter(function (o) { return o.createTime >= dayStart && o.createTime < dayEnd; }).length;
        var dd = new Date(dayStart);
        days.push({ label: (dd.getMonth() + 1) + '/' + dd.getDate(), count: c });
      }

      // 维修员工作量
      var workers = db.workers.map(function (w) {
        var mine = orders.filter(function (o) { return o.workerId === w.id; });
        return {
          worker: w,
          doing: mine.filter(function (o) { return o.status === 'processing'; }).length,
          done: mine.filter(function (o) { return o.status === 'done'; }).length
        };
      }).sort(function (a, b) { return (b.doing + b.done) - (a.doing + a.done); });

      return {
        total: total, pending: pending, processing: processing, done: done,
        closeRate: total ? Math.round(done / total * 100) + '%' : '0%',
        avgRespond: avgRespond, avgRepair: avgRepair,
        downtime: downtime, avgRating: avgRating,
        urgent: orders.filter(function (o) { return o.level === 'urgent' && o.status !== 'done'; }).length,
        feedbackCount: db.feedbacks.length,
        byLine: byLine, byType: byType, days: days, workers: workers
      };
    },

    reset: function () {
      global.localStorage.removeItem(DB_KEY);
      db = load();
    }
  };

  global.RepairDB = API;
})(window);
