window.QuoteData = (() => {
  const uid = (prefix = 'id') => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? prefix + '-' + crypto.randomUUID().slice(0, 8)
    : prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const taxModes = ['待确认', '未税报价', '含税报价', '税费另计'];

  const sections = [
    { id: 'project', name: '项目与客户', detail: '项目目标、客户主体', icon: 'building' },
    { id: 'scope', name: '报价业务', detail: '授权、开发与方案', icon: 'layers' },
    { id: 'delivery', name: '交付与验收', detail: '时间、部署、验收', icon: 'package' },
    { id: 'commercial', name: '商务与成本', detail: '预算、付款、定价', icon: 'coins' },
    { id: 'research', name: '联网研究', detail: '客户、成本、市场', icon: 'globe' },
    { id: 'materials', name: '资料与补充', detail: '需求文件、其他信息', icon: 'paperclip' }
  ];

  const types = [
    { id: 'license', name: '算法 License', detail: '现有算法的使用授权', icon: 'key' },
    { id: 'software', name: '软件开发', detail: '平台、应用与系统集成', icon: 'code' },
    { id: 'model', name: '模型开发', detail: '训练、微调与模型适配', icon: 'nodes' },
    { id: 'solution', name: '算法方案', detail: '技术调研、方案与 PoC', icon: 'compass' }
  ];

  const schemas = {
    license: [
      { id: 'licenseProduct', label: '算法 / 产品名称', placeholder: '例如：目标检测算法、行为识别 SDK', wide: true },
      { id: 'licenseMode', label: '授权方式', type: 'select', allowCustom: true, options: ['待确认', '年度授权', '永久授权', '月度订阅', '按调用量付费', '项目一次性授权'] },
      { id: 'licenseUnit', label: '计费单位', type: 'select', allowCustom: true, options: ['待确认', '设备', '视频通道', '服务器', '站点', 'API 调用次数', '企业整体授权'] },
      { id: 'licenseQuantity', label: '预计授权数量', type: 'number', placeholder: '尚未确定可留空', min: 1 },
      { id: 'licenseDuration', label: '授权期限', placeholder: '例如：12 个月，或永久' },
      { id: 'licenseRegion', label: '授权地域', placeholder: '例如：中国大陆 / 欧洲 / 全球' },
      { id: 'licensePurpose', label: '使用场景', type: 'select', allowCustom: true, options: ['待确认', '客户内部使用', '嵌入客户产品销售（OEM）', '转售 / 转授权', '试用与验证'] },
      { id: 'licenseDelivery', label: '算法交付形式', type: 'chips', options: ['SDK', 'API 服务', '容器 / 可执行程序', '模型权重', '源码'], wide: true },
      { id: 'licensePlatform', label: '运行平台与适配要求', placeholder: '例如：Linux / ARM，需适配指定芯片', wide: true },
      { id: 'licenseExclusive', label: '独占要求', type: 'select', options: ['待确认', '非独占', '行业独占', '地域独占', '全球独占'], advanced: true },
      { id: 'licenseSource', label: '源码 / 知识产权要求', type: 'select', options: ['待确认', '仅交付使用权', '交付源码，知识产权保留', '交付源码并转让指定成果权利', '另行约定'], advanced: true },
      { id: 'licenseUpdates', label: '维护与升级', type: 'select', options: ['待确认', '授权期内包含', '单独计费', '仅修复缺陷', '不包含'], advanced: true },
      { id: 'licenseGrowth', label: '扩容与续费预期', placeholder: '例如：首年 100 台，后续按阶梯增加', advanced: true },
      { id: 'licenseLimits', label: '其他授权条件', type: 'textarea', placeholder: '离线授权、设备绑定、关联公司使用范围等', wide: true, advanced: true }
    ],
    software: [
      { id: 'softwareModules', label: '功能范围', type: 'textarea', placeholder: '按模块描述，例如：用户管理、设备接入、识别结果展示、告警、报表…', wide: true },
      { id: 'softwarePlatforms', label: '开发端', type: 'chips', options: ['Web 管理后台', 'Web 用户端', 'iOS / Android', '小程序', '桌面客户端', '嵌入式'], wide: true },
      { id: 'softwareBase', label: '已有系统情况', type: 'select', options: ['待确认', '全新开发', '基于已有系统扩展', '旧系统重构', '已有可复用产品'] },
      { id: 'softwareDesign', label: '设计与原型', type: 'select', options: ['待确认', '客户提供完整设计', '需要我们设计', '仅调整现有界面'] },
      { id: 'softwareIntegrations', label: '对接系统与接口', type: 'textarea', placeholder: '例如：对接客户 ERP、单点登录、3 类设备接口；接口文档是否齐全', wide: true },
      { id: 'softwareCapacity', label: '用户规模与性能要求', placeholder: '例如：500 名用户，50 并发，响应时间小于 1 秒', wide: true },
      { id: 'softwareSecurity', label: '安全与管理要求', type: 'chips', options: ['权限管理', '操作审计', '单点登录', '数据隔离', '离线运行', '多语言'], wide: true, advanced: true },
      { id: 'softwareSource', label: '源码交付', type: 'select', options: ['待确认', '需要', '不需要', '部分交付'], advanced: true },
      { id: 'softwareIP', label: '成果知识产权', type: 'select', options: ['待确认', '公司保留，客户获使用权', '客户拥有定制成果', '共同拥有', '另行约定'], advanced: true },
      { id: 'softwareExclusions', label: '本次不包含的范围', type: 'textarea', placeholder: '明确后续阶段或由客户负责的工作', wide: true, advanced: true }
    ],
    model: [
      { id: 'modelTasks', label: '模型任务', type: 'chips', options: ['图像分类', '目标检测', '图像分割', '行为识别', '时序 / IMU', '文本 / 大模型', '语音', '其他'], wide: true },
      { id: 'modelMethod', label: '开发方式', type: 'select', options: ['待评估', '现有模型适配', '微调 / 增量训练', '从头训练', '模型压缩 / 端侧部署'] },
      { id: 'modelBaseline', label: '已有模型或基线', placeholder: '模型名称、现有效果；没有可填“无”' },
      { id: 'modelData', label: '数据来源', type: 'select', options: ['待确认', '客户提供完整数据', '客户提供部分数据', '需要我们采集 / 采购', '双方共同准备'] },
      { id: 'modelDataSize', label: '数据规模', placeholder: '例如：3 万张图片 / 100 小时视频' },
      { id: 'modelLabels', label: '标注情况', type: 'select', options: ['待确认', '已标注，质量待检查', '已标注并通过验收', '部分标注', '未标注', '不需要标注'] },
      { id: 'modelClasses', label: '类别 / 场景数量', placeholder: '例如：8 种行为、3 类部署环境' },
      { id: 'modelTarget', label: '目标指标与业务要求', type: 'textarea', placeholder: '例如：召回率、误报率、推理时延；同时说明评测场景和数据范围', wide: true },
      { id: 'modelHardware', label: '目标运行硬件', placeholder: '例如：NVIDIA GPU / RK3588 / ESP32-S3' },
      { id: 'modelPerformance', label: '速度与资源限制', placeholder: '例如：30 FPS，内存小于 2 GB' },
      { id: 'modelEvaluation', label: '验收数据与评测方式', type: 'textarea', placeholder: '由谁提供测试集、是否独立于训练集、如何计算指标', wide: true, advanced: true },
      { id: 'modelRounds', label: '训练 / 调优轮次上限', type: 'number', placeholder: '待评估', min: 1, advanced: true },
      { id: 'modelCompute', label: '训练算力由谁提供', type: 'select', options: ['待确认', '客户提供', '我们提供并计入成本', '另行采购'], advanced: true },
      { id: 'modelArtifacts', label: '交付内容', type: 'chips', options: ['模型权重', '推理代码', '训练代码', '训练数据', '评测报告', '部署包'], allowCustom: true, wide: true, advanced: true },
      { id: 'modelOwnership', label: '模型与数据的权利约定', type: 'textarea', placeholder: '模型成果归属、数据使用范围、是否允许复用训练成果', wide: true, advanced: true }
    ],
    solution: [
      { id: 'solutionProblem', label: '需要解决的技术问题', type: 'textarea', placeholder: '描述业务场景、当前方案、技术难点和期望结果', wide: true },
      { id: 'solutionDepth', label: '方案深度', type: 'select', options: ['待确认', '技术可行性调研', '完整算法方案', '方案 + 原型验证', '方案 + PoC 实测'] },
      { id: 'solutionAlternatives', label: '需要比较的方案数量', type: 'number', placeholder: '例如：2', min: 1 },
      { id: 'solutionDeliverables', label: '交付成果', type: 'chips', options: ['调研报告', '方案设计', '技术路线对比', '原型演示', 'PoC 验证', '成本与资源规划'], allowCustom: true, wide: true },
      { id: 'solutionContext', label: '已知条件与限制', type: 'textarea', placeholder: '已有数据、设备环境、现场条件、可接受的技术路线', wide: true },
      { id: 'solutionValidation', label: '验证标准', type: 'textarea', placeholder: '什么结果可以认为方案可行，是否包含现场验证', wide: true, advanced: true },
      { id: 'solutionReviews', label: '方案评审 / 修改轮次', type: 'number', placeholder: '待确认', min: 1, advanced: true },
      { id: 'solutionFollowup', label: '与后续开发的关系', type: 'select', options: ['待确认', '独立交付', '通过验证后另行报价', '计入后续整体开发'], advanced: true }
    ]
  };

  const readinessFields = type => [
    { id: type + '-productStage', label: '当前产品状态', type: 'select', allowCustom: true, options: ['待确认', '暂无现有基础，需从头开发', '已有成熟产品，可直接交付', '已有产品，需适配或扩展', '产品开发中', '已有原型 / PoC', '已有方案，尚未开发'] },
    { id: type + '-productProgress', label: '当前产品完成进度', type: 'number', min: 0, max: 100, suffix: '%', placeholder: '未知可留空' },
    { id: type + '-existingProduct', label: '已有产品 / 成果名称与版本', placeholder: '例如：行为识别 SDK v2.0、已完成的管理后台、算法原型', wide: true },
    { id: type + '-completedWork', label: '已完成 / 可复用的内容', type: 'textarea', placeholder: '已有功能、算法、模型、数据或方案，以及当前验证情况', wide: true },
    { id: type + '-remainingWork', label: '本次仍需完成的工作', type: 'textarea', placeholder: '本次新增功能、适配、优化、测试与交付；如已有部分规划，也可说明剩余工作量', wide: true }
  ];

  const fresh = (defaults) => {
    const presetRoles = Array.isArray(defaults?.laborRates) && defaults.laborRates.length
      ? defaults.laborRates.slice(0, 4).map((r, i) => ({ id: 'role-' + (i + 1), role: String(r.role || ''), days: '', rate: r.rate !== undefined && r.rate !== null ? String(r.rate) : '' }))
      : [{ id: 'role-1', role: '算法工程师', days: '', rate: '' }];
    const presetMargin = defaults?.defaultMargin !== undefined && defaults?.defaultMargin !== null && defaults?.defaultMargin !== ''
      ? String(defaults.defaultMargin)
      : '';
    return {
      projectName: '', customerName: '', country: '', website: '', industry: '', customerRelation: '首次合作', customerContact: '', projectBrief: '',
      currency: 'CNY', language: '中文', types: ['license'], customTypes: [], customOptions: {},
      deliveryDate: '', startDate: '', deployment: '待确认', hardwareProvider: '待确认', deliveryLocation: '', onsite: '待确认', supportPeriod: '', sla: '', acceptance: '',
      budgetStatus: '预算未知', budgetCurrency: 'CNY', budgetMin: '', budgetMax: '', budgetMinUnknown: true, budgetMaxUnknown: true, budgetSource: '客户确认',
      taxMode: '待确认', taxRate: '', validity: '30', paymentTerms: '', priority: '价格与交付平衡', margin: presetMargin, riskReserve: '', otherCost: '', costNotes: '',
      researchCompany: true, researchCost: true, researchMarket: true, researchFX: true,
      companyTopics: ['主营业务与产品', '业务规模与市场', '历史采购与供应商'], researchRegions: '客户所在市场优先', researchPeriod: '近 2 年', researchKeywords: '', sourceLinks: '', researchNotes: '', notes: '',
      roles: presetRoles, customFields: [],
      licenseMode: '待确认', licenseUnit: '待确认', licensePurpose: '待确认', licenseExclusive: '待确认', licenseSource: '待确认', licenseUpdates: '待确认'
    };
  };

  const example = (defaults) => ({
    ...fresh(defaults),
    projectName: '门店视频行为识别与管理平台',
    customerName: '示例客户 · 某连锁零售企业',
    country: '中国',
    industry: '零售 / 消费',
    customerRelation: '首次合作',
    projectBrief: '为 30 家门店提供视频行为识别能力，识别指定异常行为并在管理后台展示告警和统计报表。基于已有算法做场景适配，支持门店本地推理、总部统一管理。',
    types: ['license', 'software', 'model'],
    licenseProduct: '视频行为识别算法', licenseMode: '年度授权', licenseUnit: '视频通道', licenseQuantity: '120', licenseDuration: '12 个月', licenseRegion: '中国大陆', licensePurpose: '客户内部使用',
    licenseDelivery: ['SDK', '容器 / 可执行程序'], licensePlatform: 'Linux x86，GPU 本地推理', licenseExclusive: '非独占', licenseSource: '仅交付使用权', licenseUpdates: '授权期内包含',
    'license-productStage': '已有成熟产品，可直接交付', 'license-productProgress': '100', 'license-existingProduct': '通用视频行为识别 SDK v2.0',
    'license-completedWork': '现有算法、SDK 与离线授权工具均已完成验证。', 'license-remainingWork': '配置客户授权，提供集成支持；客户场景的模型适配在模型开发中单列。',
    'software-productStage': '产品开发中', 'software-productProgress': '60', 'software-existingProduct': '门店管理平台基础版',
    'software-completedWork': '用户权限、设备接入与基础告警模块已完成。', 'software-remainingWork': '开发门店统计报表、告警复核，并对接客户视频平台。',
    'model-productStage': '已有产品，需适配或扩展', 'model-existingProduct': '通用行为识别模型',
    'model-completedWork': '已有通用模型和训练流程，已通过内部样本测试。', 'model-remainingWork': '补充客户门店数据标注，完成 4 类行为的场景适配及独立评测。',
    softwareModules: '门店与设备管理、识别告警、告警复核、统计报表、用户与权限管理。', softwarePlatforms: ['Web 管理后台'], softwareBase: '全新开发', softwareDesign: '需要我们设计',
    softwareIntegrations: '对接客户现有视频平台，接口文档由客户提供。', softwareCapacity: '总部 50 名使用人员，预计 10 人同时在线', softwareSource: '需要',
    modelTasks: ['行为识别'], modelMethod: '现有模型适配', modelBaseline: '已有通用行为识别模型', modelData: '客户提供部分数据', modelDataSize: '约 3 万段视频片段',
    modelLabels: '部分标注', modelClasses: '4 类行为，3 类门店环境', modelTarget: '召回率和误报率需用客户真实门店数据评估后确定。', modelHardware: 'NVIDIA GPU，具体型号待确认',
    modelArtifacts: ['模型权重', '推理代码', '评测报告', '部署包'],
    deployment: '客户本地 / 私有化', hardwareProvider: '客户提供', deliveryLocation: '总部及首批 3 家试点门店', onsite: '需要', supportPeriod: '12',
    acceptance: '先完成试点验证，再批量上线。最终指标与验收集待双方确认。',
    budgetStatus: '已有预算', budgetMin: '200000', budgetMax: '350000', budgetMinUnknown: false, budgetMaxUnknown: false, budgetSource: '销售预估',
    taxMode: '未税报价', paymentTerms: '启动款 30%，试点验收 40%，最终验收 30%。', margin: '35',
    roles: [{ id: 'role-1', role: '算法工程师', days: '', rate: '' }, { id: 'role-2', role: '软件工程师', days: '', rate: '' }],
    researchKeywords: '零售 视频行为识别 门店 私有化部署',
    notes: '希望将算法授权、软件开发和模型适配分别列项；后续门店扩容单独提供阶梯单价。'
  });

  const allTypes = data => [...types, ...(data?.customTypes || []).map((t, i) => ({
    ...t,
    name: String(t.name || '').trim() || `自定义业务 ${i + 1}`,
    detail: '自定义服务与交付范围',
    icon: 'edit',
    custom: true
  }))];

  const filled = value => Array.isArray(value) ? value.length > 0 : String(value ?? '').trim().length > 0;

  const requirements = data => {
    const rules = [
      { key: 'projectName', label: '项目名称', section: 'project', value: data.projectName },
      { key: 'customerName', label: '客户公司', section: 'project', value: data.customerName },
      { key: 'projectBrief', label: '项目目标与需求概述', section: 'project', value: data.projectBrief },
      { key: 'types', label: '报价业务', section: 'scope', value: data.types },
      { key: 'currency', label: '报价币种', section: 'commercial', value: data.currency },
      { key: 'language', label: '报价单语言', section: 'commercial', value: data.language }
    ];
    const essential = { license: 'licenseProduct', software: 'softwareModules', model: 'modelTasks', solution: 'solutionProblem' };
    for (const type of (data.types || [])) {
      if (essential[type]) {
        const def = schemas[type].find(f => f.id === essential[type]);
        rules.push({ key: def.id, label: def.label, section: 'scope', value: data[def.id] });
      } else {
        const t = (data.customTypes || []).find(x => x.id === type);
        if (t) {
          const prefix = t.name.trim() || '自定义业务';
          rules.push(
            { key: t.id + '-name', label: prefix + ' · 业务名称', section: 'scope', value: t.name },
            { key: t.id + '-description', label: prefix + ' · 服务范围', section: 'scope', value: t.description }
          );
        }
      }
    }
    return rules.map(r => ({ ...r, done: filled(r.value) }));
  };

  const normalizeDraft = raw => {
    const safe = raw && typeof raw === 'object' ? raw : {};
    const data = { ...fresh(), ...safe };
    if (data.taxMode === '税费另行说明') data.taxMode = '税费另计';
    if (!taxModes.includes(data.taxMode)) data.taxMode = '待确认';
    data.customTypes = Array.isArray(safe.customTypes)
      ? safe.customTypes.filter(t => t && typeof t.id === 'string' && t.id.startsWith('custom-')).map(t => ({
          ...t,
          name: String(t.name || ''),
          description: String(t.description || ''),
          deliverables: String(t.deliverables || ''),
          pricing: String(t.pricing || '')
        }))
      : [];
    data.customOptions = safe.customOptions && typeof safe.customOptions === 'object' && !Array.isArray(safe.customOptions) ? safe.customOptions : {};
    const valid = new Set(allTypes(data).map(t => t.id));
    data.types = [...new Set((safe.types || []).filter(t => valid.has(t)))];
    for (const key of ['budgetMin', 'budgetMax']) {
      data[key + 'Unknown'] = typeof safe[key + 'Unknown'] === 'boolean' ? safe[key + 'Unknown'] : !filled(safe[key]);
      if (data[key + 'Unknown']) data[key] = '';
    }
    return data;
  };

  return { uid, taxModes, sections, types, schemas, readinessFields, fresh, example, allTypes, requirements, normalizeDraft };
})();
