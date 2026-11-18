import Decimal from 'decimal.js';
import { z } from 'zod';
import { query, id, tx, settings, quoteRow, audit, syncProjectStatus } from './db.mjs';
import { parse, AppError } from './config.mjs';

const D = v => new Decimal(v || 0);
const money = v => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
const finite = z.coerce.number().finite().nonnegative().max(1e12);

export function normalizeTaxMode(mode) {
  if (mode === '税费另行说明') return '税费另计';
  return ['未税报价', '含税报价', '税费另计', '待确认'].includes(mode) ? mode : '待确认';
}

export const quoteSchema = z.object({
  title: z.string().min(1).max(300),
  customer: z.string().min(1).max(300),
  seller: z.string().max(300),
  sellerAddress: z.string().max(1000).default(''),
  sellerContact: z.string().max(300).default(''),
  language: z.enum(['中文', 'English', '中英双语']),
  currency: z.enum(['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD']),
  fxRate: z.coerce.number().positive().max(1e6),
  fxSource: z.string().max(1000),
  fxDate: z.string().max(50).default(''),
  validity: z.coerce.number().int().positive().max(3650),
  taxMode: z.enum(['未税报价', '含税报价', '税费另计', '待确认']),
  taxRate: finite.max(100),
  discountPercent: finite.max(100),
  paymentTerms: z.string().max(5000),
  deliveryTerms: z.string().max(5000),
  notes: z.string().max(10000),
  items: z
    .array(
      z.object({
        id: z.string().max(80),
        name: z.string().min(1).max(300),
        description: z.string().max(5000),
        quantity: z.coerce.number().positive().max(1e10),
        unit: z.string().min(1).max(100),
        unitPrice: finite
      })
    )
    .min(1)
    .max(100)
});

export function totalsFor(content) {
  let subtotal = new Decimal(0);
  const lines = content.items.map(item => {
    const amount = D(item.quantity).mul(D(item.unitPrice)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    subtotal = subtotal.plus(amount);
    return { ...item, amount: amount.toNumber() };
  });
  const discount = subtotal.mul(D(content.discountPercent)).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const net = subtotal.minus(discount);
  let tax = new Decimal(0);
  let total = net;
  let exTax = net;
  const rateDec = D(content.taxRate).div(100);
  if (content.taxMode === '税费另计') {
    tax = net.mul(rateDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    total = net.plus(tax);
  } else if (content.taxMode === '含税报价') {
    exTax = net.div(new Decimal(1).plus(rateDec)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    tax = net.minus(exTax);
  }
  if (total.gt(1e14)) throw new AppError('报价总金额超出允许范围');
  return {
    subtotal: subtotal.toNumber(),
    discount: discount.toNumber(),
    exTax: exTax.toNumber(),
    tax: tax.toNumber(),
    total: total.toNumber(),
    lines
  };
}

function buildManualItems(input, s, fxDec, localized) {
  const types = Array.isArray(input.types) ? input.types : [];
  const customTypes = Array.isArray(input.customTypes) ? input.customTypes : [];
  let manualServiceCNY = new Decimal(0);
  for (const r of Array.isArray(input.roles) ? input.roles : []) {
    const days = Number(r?.days);
    if (Number.isFinite(days) && days > 0) {
      const configuredRate =
        r.rate !== '' && r.rate !== undefined && Number.isFinite(Number(r.rate))
          ? Number(r.rate)
          : s.laborRates?.find(lr => lr.role === r.role)?.rate || 0;
      manualServiceCNY = manualServiceCNY.plus(D(days).mul(D(configuredRate)));
    }
  }
  if (input.otherCost !== '' && input.otherCost !== undefined && Number(input.otherCost) > 0) {
    manualServiceCNY = manualServiceCNY.plus(D(input.otherCost));
  }
  let suggestedServiceTarget = new Decimal(0);
  if (manualServiceCNY.gt(0)) {
    const risk =
      input.riskReserve !== '' && input.riskReserve !== undefined && Number(input.riskReserve) >= 0
        ? D(input.riskReserve)
        : manualServiceCNY.mul(D(s.defaultRiskPercent || 0)).div(100);
    const marginVal =
      input.margin !== '' && input.margin !== undefined ? Number(input.margin) : Number(s.defaultMargin || 35);
    const safeMargin = marginVal >= 0 && marginVal < 100 ? marginVal : 35;
    suggestedServiceTarget = manualServiceCNY
      .plus(risk)
      .div(new Decimal(1).minus(D(safeMargin).div(100)))
      .mul(fxDec);
  }

  const items = [];
  for (const t of types) {
    if (t === 'license') {
      const qty = Number(input.licenseQuantity) > 0 ? Number(input.licenseQuantity) : 1;
      const unit =
        input.licenseUnit && input.licenseUnit !== '待确认'
          ? String(input.licenseUnit)
          : localized('套', 'license');
      const descParts = [
        input.licenseMode && input.licenseMode !== '待确认' ? `授权方式：${input.licenseMode}` : '',
        input.licenseDuration ? `期限：${input.licenseDuration}` : '',
        input.licensePlatform ? `平台：${input.licensePlatform}` : '',
        input['license-remainingWork'] || ''
      ].filter(Boolean);
      items.push({
        id: id(),
        kind: 'license',
        name: String(input.licenseProduct || '').trim() || localized('算法软件授权', 'Algorithm Software License'),
        description: descParts.join('；') || localized('软件或算法使用权授权交付', 'Software or algorithm usage license'),
        quantity: qty,
        unit,
        unitPrice: 0
      });
    } else if (t === 'software') {
      items.push({
        id: id(),
        kind: 'service',
        name: localized('软件系统开发与集成交付', 'Software Development & Integration'),
        description:
          String(input.softwareModules || input['software-remainingWork'] || '').trim() ||
          localized('按需求范围完成系统开发、接口联调与测试交付', 'Development, integration and testing per scope'),
        quantity: 1,
        unit: localized('项', 'project'),
        unitPrice: 0
      });
    } else if (t === 'model') {
      const descParts = [
        Array.isArray(input.modelTasks) && input.modelTasks.length ? `任务：${input.modelTasks.join('、')}` : '',
        input.modelTarget || '',
        input['model-remainingWork'] || ''
      ].filter(Boolean);
      items.push({
        id: id(),
        kind: 'service',
        name: localized('算法模型研发与场景适配', 'Model R&D & Adaptation'),
        description:
          descParts.join('；') ||
          localized('完成模型训练、场景适配与指标评测交付', 'Model training, adaptation and evaluation'),
        quantity: 1,
        unit: localized('项', 'project'),
        unitPrice: 0
      });
    } else if (t === 'solution') {
      const descParts = [
        input.solutionProblem || '',
        Array.isArray(input.solutionDeliverables) && input.solutionDeliverables.length
          ? `交付物：${input.solutionDeliverables.join('、')}`
          : ''
      ].filter(Boolean);
      items.push({
        id: id(),
        kind: 'service',
        name: localized('技术方案设计与可行性验证', 'Technical Solution & Validation'),
        description:
          descParts.join('；') ||
          localized('提供技术路线调研、方案设计与验证报告', 'Technical architecture design and validation report'),
        quantity: 1,
        unit: localized('项', 'project'),
        unitPrice: 0
      });
    } else {
      const custom = customTypes.find(x => x.id === t);
      items.push({
        id: id(),
        kind: 'service',
        name: custom?.name?.trim() || localized('定制技术服务', 'Custom Technical Service'),
        description: custom?.description?.trim() || localized('按双方确认范围执行交付', 'Delivery per agreed scope'),
        quantity: 1,
        unit: localized('项', 'project'),
        unitPrice: 0
      });
    }
  }

  if (!items.length) {
    items.push({
      id: id(),
      kind: 'service',
      name: String(input.projectName || '').trim() || localized('项目技术开发与交付服务', 'Project Technical Delivery'),
      description: String(input.projectBrief || '').trim() || localized('具体交付范围待补充', 'Scope to be confirmed'),
      quantity: 1,
      unit: localized('项', 'project'),
      unitPrice: 0
    });
  }

  if (suggestedServiceTarget.gt(0)) {
    const serviceItems = items.filter(x => x.kind === 'service');
    const receivers = serviceItems.length ? serviceItems : items;
    const perItem = suggestedServiceTarget.div(receivers.length);
    for (const item of receivers) {
      item.unitPrice = money(perItem.div(D(item.quantity || 1)));
    }
  }

  return items.map(({ kind: _kind, ...rest }) => rest);
}

export async function createQuote(project, run, user, body = {}) {
  const s = await settings();
  const input = run ? parse(run.input_json) : project.input || {};
  const currency = ['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD'].includes(input.currency) ? input.currency : 'CNY';
  const language = ['中文', 'English', '中英双语'].includes(input.language) ? input.language : '中文';
  const isEn = language === 'English';
  const isBi = language === '中英双语';
  const localized = (zh, en) => (isEn ? en : isBi ? `${zh} / ${en}` : zh);
  const taxMode = normalizeTaxMode(input.taxMode);
  const taxRate = ['含税报价', '税费另计'].includes(taxMode) ? Number(input.taxRate) || 0 : 0;

  let content;
  if (run) {
    const result = parse(run.result_json);
    let fx = currency === 'CNY' ? 1 : result.fx?.rate;
    if (body.fxRate !== undefined && body.fxRate !== '' && currency !== 'CNY') fx = Number(body.fxRate);
    if (!(fx > 0)) throw new AppError('未取得可用汇率，请填写 1 CNY 对应的报价币种金额');
    const fxDec = D(fx);
    const types = Array.isArray(input.types) && input.types.length ? input.types : ['shared'];
    const costBy = new Map(types.map(t => [t, new Decimal(0)]));
    let shared = new Decimal(0);
    for (const line of result.costLines || []) {
      if (costBy.has(line.businessId)) {
        costBy.set(line.businessId, costBy.get(line.businessId).plus(D(line.base)));
      } else {
        shared = shared.plus(D(line.base));
      }
    }
    const sharedShare = shared.div(types.length);
    for (const type of types) {
      costBy.set(type, costBy.get(type).plus(sharedShare));
    }

    const items = [];
    const costBaseDec = D(result.totals?.costBase);
    const serviceSuggestedDec = D(result.totals?.serviceSuggested);
    for (const group of result.quoteGroups || []) {
      const base = costBy.get(group.businessId) || new Decimal(0);
      if (base.gt(0)) {
        const share = costBaseDec.gt(0) ? base.div(costBaseDec) : new Decimal(0);
        const hasLicense = (result.licenseLines || []).some(l => l.businessId === group.businessId);
        items.push({
          id: id(),
          name: hasLicense
            ? localized('算法部署、集成与交付支持', 'Algorithm implementation and support')
            : group.name,
          description: hasLicense
            ? localized(
                '授权配置、部署、集成联调与交付支持；算法使用授权单独列项。',
                'License configuration, deployment, integration and delivery support. Algorithm usage rights are quoted separately.'
              )
            : group.scope,
          quantity: 1,
          unit: localized('项', 'project'),
          unitPrice: money(serviceSuggestedDec.mul(share).mul(fxDec))
        });
      }
    }
    if (items.length) {
      const target = serviceSuggestedDec.mul(fxDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const allocated = items.reduce((sum, x) => sum.plus(D(x.unitPrice)), new Decimal(0));
      const diff = target.minus(allocated);
      if (!diff.isZero()) {
        let bestIdx = items.length - 1;
        for (let i = 0; i < items.length; i++) {
          if (D(items[i].unitPrice).gt(D(items[bestIdx].unitPrice))) bestIdx = i;
        }
        const adjusted = D(items[bestIdx].unitPrice).plus(diff);
        items[bestIdx].unitPrice = adjusted.gte(0) ? money(adjusted) : 0;
      }
    }
    for (const l of result.licenseLines || []) {
      items.push({
        id: id(),
        name: l.name,
        description: l.scope,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: money(D(l.unitPriceCNY).mul(fxDec))
      });
    }
    if (!items.length) {
      items.push({
        id: id(),
        name: result.quoteGroups?.[0]?.name || String(input.projectName || '').trim() || localized('项目交付服务', 'Project Service'),
        description: result.quoteGroups?.[0]?.scope || String(input.projectBrief || '').trim() || '',
        quantity: 1,
        unit: localized('项', 'project'),
        unitPrice: 0
      });
    }
    content = quoteSchema.parse({
      title: String(result.externalTitle || input.projectName || '').trim() || localized('未命名项目报价', 'Untitled Quotation'),
      customer: String(input.customerName || '').trim() || localized('待确认客户', 'Customer TBC'),
      seller: s.companyName || '',
      sellerAddress: s.companyAddress || '',
      sellerContact: s.companyContact || '',
      language,
      currency,
      fxRate: fx,
      fxSource:
        currency === 'CNY'
          ? '同币种'
          : body.fxRate !== undefined && body.fxRate !== ''
          ? '人工确认'
          : result.fx?.source || '人工确认',
      fxDate: result.fx?.date || new Date().toISOString().slice(0, 10),
      validity: Number(input.validity) > 0 ? Math.round(Number(input.validity)) : 30,
      taxMode,
      taxRate,
      discountPercent: 0,
      paymentTerms: input.paymentTerms ? result.externalPaymentTerms || input.paymentTerms : '',
      deliveryTerms: [input.deliveryDate, input.acceptance].filter(Boolean).length
        ? result.externalDeliveryTerms || [input.deliveryDate, input.acceptance].filter(Boolean).join('\n')
        : '',
      notes: (result.externalTerms || []).join('\n'),
      items
    });
  } else {
    const manualFx =
      currency === 'CNY'
        ? 1
        : body.fxRate !== undefined && body.fxRate !== '' && Number(body.fxRate) > 0
        ? Number(body.fxRate)
        : 1;
    const items = buildManualItems(input, s, D(manualFx), localized);
    content = quoteSchema.parse({
      title: String(input.projectName || '').trim() || localized('未命名项目报价', 'Untitled Quotation'),
      customer: String(input.customerName || '').trim() || localized('待确认客户', 'Customer TBC'),
      seller: s.companyName || '',
      sellerAddress: s.companyAddress || '',
      sellerContact: s.companyContact || '',
      language,
      currency,
      fxRate: manualFx,
      fxSource: currency === 'CNY' ? '同币种' : Number(body.fxRate) > 0 ? '人工确认' : '手动创建报价',
      fxDate: new Date().toISOString().slice(0, 10),
      validity: Number(input.validity) > 0 ? Math.round(Number(input.validity)) : 30,
      taxMode,
      taxRate,
      discountPercent: 0,
      paymentTerms: String(input.paymentTerms || ''),
      deliveryTerms: [input.deliveryDate, input.acceptance].filter(Boolean).join('\n'),
      notes: String(input.notes || ''),
      items
    });
  }

  const quoteId = id();
  const number = 'Q-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + quoteId.slice(0, 6).toUpperCase();
  const totals = totalsFor(content);

  await tx(async conn => {
    const current = (await query('SELECT revision FROM projects WHERE id=? FOR UPDATE', [project.id], conn))[0];
    if (!current) throw new AppError('项目不存在', 404);
    if (run && current.revision !== run.project_revision) {
      throw new AppError('需求已变更，请重新分析后生成报价，或直接手动创建报价草稿', 409);
    }
    await query(
      'INSERT INTO quotes(id, project_id, run_id, number, currency, content_json, totals_json, created_by) VALUES(?,?,?,?,?,?,?,?)',
      [quoteId, project.id, run ? run.id : null, number, content.currency, JSON.stringify(content), JSON.stringify(totals), user.id],
      conn
    );
    await snapshot(quoteId, 1, 'draft', content, totals, user, conn);
    await syncProjectStatus(project.id, conn);
    await audit(user, 'quote', quoteId, 'create', { projectId: project.id, runId: run ? run.id : null, manual: !run }, conn);
  });

  return quoteRow((await query('SELECT * FROM quotes WHERE id=?', [quoteId]))[0]);
}

export async function saveQuote(body, user) {
  const rawContent = body?.content && typeof body.content === 'object'
    ? { ...body.content, taxMode: normalizeTaxMode(body.content.taxMode) }
    : body?.content;
  const content = quoteSchema.parse(rawContent);
  const totals = totalsFor(content);
  return tx(async conn => {
    const q = (await query('SELECT * FROM quotes WHERE id=? FOR UPDATE', [String(body?.id || '')], conn))[0];
    if (!q) throw new AppError('报价不存在', 404);
    if (q.revision !== Number(body?.revision)) throw new AppError('报价已被更新，请刷新后编辑', 409);
    if (['won', 'lost'].includes(q.status)) throw new AppError('已记录成交结果的报价不可修改，请另建报价');
    const revision = q.revision + 1;
    await query(
      "UPDATE quotes SET content_json=?, totals_json=?, currency=?, revision=?, status='draft', approved_by=NULL, approved_at=NULL, updated_at=UTC_TIMESTAMP(3) WHERE id=?",
      [JSON.stringify(content), JSON.stringify(totals), content.currency, revision, q.id],
      conn
    );
    await snapshot(q.id, revision, 'draft', content, totals, user, conn);
    await syncProjectStatus(q.project_id, conn);
    await audit(user, 'quote', q.id, 'edit', { revision }, conn);
    return quoteRow((await query('SELECT * FROM quotes WHERE id=?', [q.id], conn))[0]);
  });
}

async function snapshot(quoteId, rev, status, content, totals, user, conn) {
  await query(
    'INSERT INTO quote_versions(id, quote_id, revision, status, content_json, totals_json, created_by) VALUES(?,?,?,?,?,?,?)',
    [id(), quoteId, rev, status, JSON.stringify(content), JSON.stringify(totals), user.id],
    conn
  );
}

export async function transitionQuote(body, user) {
  return tx(async conn => {
    const q = (await query('SELECT * FROM quotes WHERE id=? FOR UPDATE', [String(body?.id || '')], conn))[0];
    if (!q) throw new AppError('报价不存在', 404);
    if (q.revision !== Number(body?.revision)) throw new AppError('报价已更新，请刷新', 409);
    const next = String(body?.status || '');
    const valid = {
      draft: ['review'],
      review: ['draft', 'approved'],
      approved: ['draft', 'sent', 'won', 'lost'],
      sent: ['draft', 'won', 'lost'],
      won: [],
      lost: []
    };
    if (!valid[q.status]?.includes(next)) throw new AppError('不支持此状态变更');
    if (next === 'approved' && !['admin', 'reviewer'].includes(user.role)) {
      throw new AppError('需要审核人或管理员批准', 403);
    }
    const content = parse(q.content_json);
    content.taxMode = normalizeTaxMode(content.taxMode);
    const totals = totalsFor(content);
    if (['review', 'approved'].includes(next)) {
      if (!String(content.seller || '').trim()) throw new AppError('请先填写报价方公司名称');
      if (!String(content.paymentTerms || '').trim()) throw new AppError('请先填写付款方式与节点');
      if (content.taxMode === '待确认') throw new AppError('请先确认税费口径（不能为待确认）');
      if (totals.total <= 0) throw new AppError('对外报价合计金额需要大于 0');
    }
    const revision = q.revision + 1;
    await query(
      'UPDATE quotes SET status=?, revision=?, approved_by=?, approved_at=?, updated_at=UTC_TIMESTAMP(3) WHERE id=?',
      [
        next,
        revision,
        next === 'approved' ? user.id : next === 'draft' ? null : q.approved_by,
        next === 'approved' ? new Date() : next === 'draft' ? null : q.approved_at,
        q.id
      ],
      conn
    );
    await snapshot(q.id, revision, next, content, totals, user, conn);
    if (next === 'won') {
      const amount = Number(body?.dealAmount);
      if (!(amount > 0 && Number.isFinite(amount) && amount <= 1e12)) {
        throw new AppError('请填写有效的实际成交金额');
      }
      await query(
        'INSERT INTO price_references(id, title, service_kind, evidence_type, amount, currency, scope_text, reference_date, notes, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [
          id(),
          content.title,
          '组合项目',
          'deal',
          money(amount),
          q.currency,
          content.items.map(x => `${x.name}：${x.description}`).join('\n'),
          new Date().toISOString().slice(0, 10),
          `来源：内部报价 ${q.number}`,
          user.id
        ],
        conn
      );
    }
    await syncProjectStatus(q.project_id, conn);
    await audit(user, 'quote', q.id, 'status', { from: q.status, to: next, revision }, conn);
    return quoteRow((await query('SELECT * FROM quotes WHERE id=?', [q.id], conn))[0]);
  });
}

export async function deleteQuote(quoteId, user) {
  return tx(async conn => {
    const q = (await query('SELECT * FROM quotes WHERE id=? FOR UPDATE', [String(quoteId || '')], conn))[0];
    if (!q) throw new AppError('报价不存在', 404);
    if (q.status !== 'draft') throw new AppError('仅草稿状态的报价单可以删除');
    await query('DELETE FROM quote_versions WHERE quote_id=?', [q.id], conn);
    await query('DELETE FROM quotes WHERE id=?', [q.id], conn);
    await syncProjectStatus(q.project_id, conn);
    await audit(user, 'quote', q.id, 'delete', { number: q.number, projectId: q.project_id }, conn);
    return { ok: true };
  });
}
