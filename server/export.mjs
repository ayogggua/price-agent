import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import { cfg, AppError } from './config.mjs';
import { normalizeTaxMode, totalsFor } from './quotes.mjs';

const amount = (v, c) =>
  Number(v || 0).toLocaleString(c === 'JPY' ? 'ja-JP' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const taxNames = {
  未税报价: 'Excluding tax',
  含税报价: 'Tax included',
  税费另计: 'Tax added separately',
  待确认: 'To be confirmed'
};

export function publicQuote(q) {
  const rawContent = q.content || {};
  const taxMode = normalizeTaxMode(rawContent.taxMode);
  const c = { ...rawContent, taxMode };
  const computedTotals = q.totals?.exTax !== undefined ? q.totals : totalsFor(c);
  const taxName = taxNames[taxMode] || taxNames['待确认'];
  const baseTaxLabel =
    c.language === 'English'
      ? taxName
      : c.language === '中英双语'
      ? `${taxMode} / ${taxName}`
      : taxMode;
  const showTaxRate = ['含税报价', '税费另计'].includes(taxMode);
  const rateNum = Number(c.taxRate || 0);
  const taxDisplay = showTaxRate ? `${baseTaxLabel} (${rateNum}%)` : baseTaxLabel;

  return {
    number: q.number,
    date: new Date(q.createdAt || Date.now()).toISOString().slice(0, 10),
    draft: !['approved', 'sent', 'won'].includes(q.status),
    ...c,
    taxLabel: baseTaxLabel,
    taxDisplay,
    showTaxRate,
    items: computedTotals.lines || [],
    totals: computedTotals
  };
}

function labels(q) {
  const zh = {
    quote: '报价单',
    draft: '草稿 - 尚未批准',
    project: '项目名称',
    customer: '客户单位',
    seller: '报价单位',
    contact: '联系方式',
    address: '单位地址',
    number: '报价编号',
    date: '报价日期',
    valid: '有效期',
    days: '天',
    currency: '结算币种',
    seq: '序号',
    item: '报价项目',
    itemScope: '报价项目与交付范围',
    scope: '交付范围与说明',
    qty: '数量',
    unit: '单位',
    price: '单价',
    total: '金额',
    subtotal: '小计',
    discount: '折扣',
    exTax: '不含税金额',
    tax: '税额',
    taxIncluded: '税额（已含）',
    grand: '报价合计',
    payment: '付款条款',
    delivery: '交付与验收',
    notes: '范围与约定',
    taxMode: '税费口径',
    sellerSign: '报价方确认（签章）',
    buyerSign: '客户方确认（签章）',
    signDate: '日期：'
  };
  const en = {
    quote: 'QUOTATION',
    draft: 'DRAFT - Not approved',
    project: 'Project',
    customer: 'Customer',
    seller: 'Quoted by',
    contact: 'Contact',
    address: 'Address',
    number: 'Quotation No.',
    date: 'Date',
    valid: 'Validity',
    days: 'days',
    currency: 'Currency',
    seq: 'No.',
    item: 'Item',
    itemScope: 'Item & Scope',
    scope: 'Scope & Description',
    qty: 'Qty',
    unit: 'Unit',
    price: 'Unit Price',
    total: 'Amount',
    subtotal: 'Subtotal',
    discount: 'Discount',
    exTax: 'Amount excl. tax',
    tax: 'Tax',
    taxIncluded: 'Tax (included)',
    grand: 'Total',
    payment: 'Payment Terms',
    delivery: 'Delivery & Acceptance',
    notes: 'Scope & Assumptions',
    taxMode: 'Tax Basis',
    sellerSign: 'For Seller (Signature / Stamp)',
    buyerSign: 'Accepted by Customer',
    signDate: 'Date: '
  };
  if (q.language === 'English') return en;
  if (q.language === '中英双语') {
    return Object.fromEntries(Object.keys(zh).map(key => [key, `${zh[key]} / ${en[key]}`]));
  }
  return zh;
}

function visualWidth(str) {
  let w = 0;
  for (const ch of String(str || '')) {
    const code = ch.codePointAt(0) || 0;
    w += code > 0xff ? 2 : 1;
  }
  return w;
}

function estimateWrappedLines(text, colVisualWidth) {
  const safeWidth = Math.max(8, colVisualWidth);
  return String(text || '')
    .split(/\r?\n/)
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(visualWidth(line) / safeWidth)), 0);
}

function buildSummaryRows(q, l) {
  const rows = [];
  const hasDiscount = Number(q.totals.discount) > 0;
  const isIncl = q.taxMode === '含税报价';
  const isAddTax = q.taxMode === '税费另计' && Number(q.totals.tax) > 0;

  if (hasDiscount || isIncl || isAddTax) {
    rows.push({ key: 'subtotal', label: l.subtotal, value: q.totals.subtotal, negative: false });
  }
  if (hasDiscount) {
    rows.push({ key: 'discount', label: l.discount, value: q.totals.discount, negative: true });
  }
  if (isIncl) {
    rows.push({ key: 'exTax', label: l.exTax, value: q.totals.exTax, negative: false });
    if (Number(q.totals.tax) > 0) {
      rows.push({ key: 'tax', label: l.taxIncluded, value: q.totals.tax, negative: false });
    }
  } else if (isAddTax) {
    rows.push({ key: 'tax', label: l.tax, value: q.totals.tax, negative: false });
  }
  rows.push({ key: 'grand', label: l.grand, value: q.totals.total, negative: false, grand: true });
  return rows;
}

const EXCEL_FONT_BASE = { name: 'Microsoft YaHei', charset: 134, family: 2 };
const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFDFE5E2' } },
  left: { style: 'thin', color: { argb: 'FFDFE5E2' } },
  bottom: { style: 'thin', color: { argb: 'FFDFE5E2' } },
  right: { style: 'thin', color: { argb: 'FFDFE5E2' } }
};

export async function xlsxBuffer(quote) {
  const q = publicQuote(quote);
  const l = labels(q);
  const book = new ExcelJS.Workbook();
  book.creator = q.seller || cfg.brandName;
  const sheetName = l.quote.replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 28) || 'Quotation';
  const s = book.addWorksheet(sheetName);
  s.columns = [
    { width: 8 },
    { width: 28 },
    { width: 44 },
    { width: 12 },
    { width: 12 },
    { width: 18 },
    { width: 20 }
  ];

  // Title Row
  s.mergeCells('A1:G1');
  const titleCell = s.getCell('A1');
  titleCell.value = q.draft ? `${l.quote} (${l.draft})` : l.quote;
  titleCell.font = { ...EXCEL_FONT_BASE, size: 20, bold: true, color: { argb: 'FF176B60' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  s.getRow(1).height = 34;

  // Subtitle Row
  s.mergeCells('A2:G2');
  const subCell = s.getCell('A2');
  subCell.value = q.title;
  subCell.font = { ...EXCEL_FONT_BASE, size: 12, bold: true, color: { argb: 'FF1F2D28' } };
  subCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  s.getRow(2).height = 24;

  s.addRow([]);

  // Two-column Metadata Block (A: label, B-C: left val, D-E: right label, F-G: right val)
  const metaPairs = [
    [
      [l.customer, q.customer || '—'],
      [l.number, q.number]
    ],
    [
      [l.seller, q.seller || '—'],
      [l.date, q.date]
    ],
    [
      [l.contact, q.sellerContact || '—'],
      [l.valid, `${q.validity} ${l.days}`]
    ],
    [
      [l.address, q.sellerAddress || '—'],
      [l.taxMode, q.taxDisplay]
    ]
  ];

  for (const [[lk, lv], [rk, rv]] of metaPairs) {
    const r = s.addRow([lk, lv, '', rk, '', rv, '']);
    s.mergeCells(r.number, 2, r.number, 3);
    s.mergeCells(r.number, 4, r.number, 5);
    s.mergeCells(r.number, 6, r.number, 7);
    for (let cIdx = 1; cIdx <= 7; cIdx++) {
      const cell = r.getCell(cIdx);
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: 'middle', wrapText: true };
      const isLabel = cIdx === 1 || cIdx === 4 || cIdx === 5;
      cell.font = {
        ...EXCEL_FONT_BASE,
        size: 10,
        bold: isLabel,
        color: { argb: isLabel ? 'FF55645D' : 'FF1F2D28' }
      };
      if (isLabel) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F6F6' } };
      }
    }
    const leftLines = estimateWrappedLines(lv, 64);
    const rightLines = estimateWrappedLines(rv, 34);
    r.height = Math.max(24, Math.max(leftLines, rightLines) * 16 + 8);
  }

  s.addRow([]);

  // Items Table Header
  const h = s.addRow([
    l.seq,
    l.item,
    l.scope,
    l.qty,
    l.unit,
    `${l.price} (${q.currency})`,
    `${l.total} (${q.currency})`
  ]);
  h.height = q.language === '中英双语' ? 36 : 28;
  for (let cIdx = 1; cIdx <= 7; cIdx++) {
    const cell = h.getCell(cIdx);
    cell.font = { ...EXCEL_FONT_BASE, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B60' } };
    cell.border = THIN_BORDER;
    cell.alignment = {
      vertical: 'middle',
      horizontal: [4, 6, 7].includes(cIdx) ? 'right' : cIdx === 1 || cIdx === 5 ? 'center' : 'left',
      wrapText: true
    };
  }

  // Items Rows
  q.items.forEach((x, idx) => {
    const r = s.addRow([
      String(idx + 1).padStart(2, '0'),
      x.name || '',
      x.description || '—',
      Number(x.quantity || 0),
      x.unit || '',
      Number(x.unitPrice || 0),
      Number(x.amount || 0)
    ]);
    const linesName = estimateWrappedLines(x.name, 24);
    const linesDesc = estimateWrappedLines(x.description, 40);
    r.height = Math.max(30, Math.min(409, Math.max(linesName, linesDesc) * 16 + 12));

    for (let cIdx = 1; cIdx <= 7; cIdx++) {
      const cell = r.getCell(cIdx);
      cell.border = THIN_BORDER;
      cell.font = {
        ...EXCEL_FONT_BASE,
        size: 10,
        bold: cIdx === 2 || cIdx === 7,
        color: { argb: cIdx === 1 || cIdx === 3 ? 'FF55645D' : 'FF1F2D28' }
      };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFB' } };
      }
      cell.alignment = {
        vertical: 'top',
        horizontal: [4, 6, 7].includes(cIdx) ? 'right' : cIdx === 1 || cIdx === 5 ? 'center' : 'left',
        wrapText: true
      };
    }
    r.getCell(4).numFmt = '#,##0.###';
    r.getCell(6).numFmt = '#,##0.00';
    r.getCell(7).numFmt = '#,##0.00';
  });

  // Summary Block
  const summaryRows = buildSummaryRows(q, l);
  for (const sr of summaryRows) {
    const val = sr.negative ? -Math.abs(Number(sr.value || 0)) : Number(sr.value || 0);
    const r = s.addRow(['', '', '', '', sr.label, '', val]);
    s.mergeCells(r.number, 5, r.number, 6);
    r.height = sr.grand ? 30 : 24;
    for (let cIdx = 5; cIdx <= 7; cIdx++) {
      const cell = r.getCell(cIdx);
      cell.border = THIN_BORDER;
      cell.font = {
        ...EXCEL_FONT_BASE,
        size: sr.grand ? 12 : 10,
        bold: Boolean(sr.grand),
        color: { argb: sr.grand ? 'FF176B60' : 'FF1F2D28' }
      };
      if (sr.grand) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF4F1' } };
      }
      cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
    }
    r.getCell(7).numFmt = sr.negative ? '#,##0.00;"− "#,##0.00;0.00' : '#,##0.00';
  }

  // Commercial Terms Sections
  for (const [secName, secValue] of [
    [l.payment, q.paymentTerms],
    [l.delivery, q.deliveryTerms],
    [l.notes, q.notes]
  ]) {
    if (!String(secValue || '').trim()) continue;
    s.addRow([]);
    const headRow = s.addRow([secName, '', '', '', '', '', '']);
    s.mergeCells(headRow.number, 1, headRow.number, 7);
    headRow.height = 24;
    for (let cIdx = 1; cIdx <= 7; cIdx++) {
      const cell = headRow.getCell(cIdx);
      cell.border = THIN_BORDER;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F6F6' } };
      cell.font = { ...EXCEL_FONT_BASE, size: 10, bold: true, color: { argb: 'FF176B60' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    const bodyRow = s.addRow([secValue, '', '', '', '', '', '']);
    s.mergeCells(bodyRow.number, 1, bodyRow.number, 7);
    bodyRow.height = Math.max(30, Math.min(409, estimateWrappedLines(secValue, 96) * 16 + 12));
    for (let cIdx = 1; cIdx <= 7; cIdx++) {
      const cell = bodyRow.getCell(cIdx);
      cell.border = THIN_BORDER;
      cell.font = { ...EXCEL_FONT_BASE, size: 10, color: { argb: 'FF1F2D28' } };
      cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    }
  }

  // Signature Block
  s.addRow([]);
  const signRow = s.addRow([
    `${l.sellerSign}\n${q.seller || '—'}\n\n${l.signDate}`,
    '',
    '',
    '',
    `${l.buyerSign}\n${q.customer || '—'}\n\n${l.signDate}`,
    '',
    ''
  ]);
  s.mergeCells(signRow.number, 1, signRow.number, 3);
  s.mergeCells(signRow.number, 5, signRow.number, 7);
  signRow.height = 68;
  for (const rangeStart of [1, 2, 3, 5, 6, 7]) {
    const cell = signRow.getCell(rangeStart);
    cell.border = THIN_BORDER;
    cell.font = { ...EXCEL_FONT_BASE, size: 10, color: { argb: 'FF55645D' } };
    cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  }

  const footerText = [q.seller, q.sellerContact, q.sellerAddress].filter(Boolean).join('  |  ');
  if (footerText) {
    s.addRow([]);
    const fRow = s.addRow([footerText]);
    s.mergeCells(fRow.number, 1, fRow.number, 7);
    fRow.getCell(1).font = { ...EXCEL_FONT_BASE, size: 9, color: { argb: 'FF76847D' } };
  }

  s.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return book.xlsx.writeBuffer();
}

export async function pdfBuffer(quote) {
  if (!fs.existsSync(cfg.pdfFontPath)) {
    throw new AppError('未找到 PDF 中文字体文件，请检查 server/assets/NotoSansCJKsc-Regular.otf 或 PDF_FONT_PATH 配置', 500);
  }
  const q = publicQuote(quote);
  const l = labels(q);
  const summaryRows = buildSummaryRows(q, l);

  return new Promise((resolve, reject) => {
    const LEFT = 44;
    const WIDTH = 507;
    const RIGHT = LEFT + WIDTH;
    const SAFE_BOTTOM = 762;

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 44, bottom: 68, left: LEFT, right: 44 },
      bufferPages: true,
      info: { Title: q.title, Author: q.seller || cfg.brandName }
    });

    const chunks = [];
    doc.on('data', b => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('CJK', cfg.pdfFontPath);
    doc.font('CJK');

    const ensureSpace = (needed, onPageBreak) => {
      if (doc.y + needed > SAFE_BOTTOM) {
        doc.addPage();
        if (onPageBreak) onPageBreak();
      }
    };

    // Top Accent Bar
    doc.save().rect(LEFT, 36, WIDTH, 3).fill('#176b60').restore();
    doc.y = 48;

    // Document Header + Optional Draft Badge
    const headerTop = doc.y;
    doc.fontSize(22).fillColor('#176b60').text(l.quote, LEFT, headerTop, { width: 350 });
    if (q.draft) {
      const badgeW = q.language === '中英双语' ? 190 : 126;
      const badgeX = RIGHT - badgeW;
      doc
        .save()
        .roundedRect(badgeX, headerTop + 4, badgeW, 22, 3)
        .fillAndStroke('#fdf6ef', '#e6cdb6')
        .restore();
      doc
        .fontSize(9)
        .fillColor('#8a5a36')
        .text(l.draft, badgeX + 6, headerTop + 9, { width: badgeW - 12, align: 'center', lineBreak: false });
    }
    doc.fontSize(12).fillColor('#1f2d28').text(q.title, LEFT, headerTop + 31, { width: WIDTH });
    doc.moveDown(0.7);

    // Two-column Metadata Box
    const metaStartY = doc.y;
    const leftMeta = [
      [l.customer, q.customer || '—'],
      [l.seller, q.seller || '—'],
      ...(q.sellerContact ? [[l.contact, q.sellerContact]] : []),
      ...(q.sellerAddress ? [[l.address, q.sellerAddress]] : [])
    ];
    const rightMeta = [
      [l.number, q.number],
      [l.date, q.date],
      [l.valid, `${q.validity} ${l.days}`],
      [l.taxMode, q.taxDisplay]
    ];

    const colW = 232;
    const measureMetaCol = pairs =>
      pairs.reduce((h, [k, v]) => {
        const lineH = doc.fontSize(9.5).heightOfString(`${k}：${v}`, { width: colW });
        return h + Math.max(15, lineH) + 5;
      }, 0);
    const metaBoxH = Math.max(measureMetaCol(leftMeta), measureMetaCol(rightMeta)) + 18;

    doc
      .save()
      .roundedRect(LEFT, metaStartY, WIDTH, metaBoxH, 4)
      .fillAndStroke('#f8fafa', '#dfe5e2')
      .restore();

    let ly = metaStartY + 10;
    for (const [k, v] of leftMeta) {
      const text = `${k}：${v}`;
      doc.fontSize(9.5).fillColor('#55645d').text(`${k}：`, LEFT + 12, ly, { continued: true, width: colW });
      doc.fillColor('#1f2d28').text(String(v));
      ly = Math.max(ly + 18, doc.y + 3);
    }

    let ry = metaStartY + 10;
    const rightX = LEFT + 263;
    for (const [k, v] of rightMeta) {
      doc.fontSize(9.5).fillColor('#55645d').text(`${k}：`, rightX, ry, { continued: true, width: colW });
      doc.fillColor('#1f2d28').text(String(v));
      ry = Math.max(ry + 18, doc.y + 3);
    }

    doc.y = metaStartY + metaBoxH + 16;

    // Formal 4-Column Quotation Items Table
    const col1X = LEFT;
    const col1W = 255;
    const col2X = col1X + col1W;
    const col2W = 66;
    const col3X = col2X + col2W;
    const col3W = 90;
    const col4X = col3X + col3W;
    const col4W = 96;

    const drawTableHeader = () => {
      const y = doc.y;
      const h = q.language === '中英双语' ? 30 : 24;
      doc.save().rect(LEFT, y, WIDTH, h).fill('#176b60').restore();
      const textY = y + (h - 12) / 2 - 1;
      doc.fontSize(9.5).fillColor('#ffffff');
      doc.text(l.itemScope, col1X + 8, textY, { width: col1W - 14, lineBreak: false });
      doc.text(l.qty, col2X + 4, textY, { width: col2W - 8, align: 'right', lineBreak: false });
      doc.text(`${l.price} (${q.currency})`, col3X + 4, textY, { width: col3W - 8, align: 'right', lineBreak: false });
      doc.text(`${l.total} (${q.currency})`, col4X + 4, textY, { width: col4W - 10, align: 'right', lineBreak: false });
      doc.y = y + h;
    };

    ensureSpace(64);
    drawTableHeader();

    q.items.forEach((item, idx) => {
      const seqLabel = String(idx + 1).padStart(2, '0');
      const titleText = `${seqLabel}  ${item.name || ''}`;
      const descText = String(item.description || '—');
      const nameH = doc.fontSize(10).heightOfString(titleText, { width: col1W - 16 });
      const descH = doc.fontSize(9).heightOfString(descText, { width: col1W - 16, lineGap: 2 });
      const rowH = Math.max(34, nameH + descH + 18);

      if (rowH <= SAFE_BOTTOM - 84 && doc.y + rowH > SAFE_BOTTOM) {
        doc.addPage();
        drawTableHeader();
      } else if (doc.y + 48 > SAFE_BOTTOM) {
        doc.addPage();
        drawTableHeader();
      }

      const rowStartY = doc.y;
      const fitsSinglePage = rowStartY + rowH <= SAFE_BOTTOM;

      if (fitsSinglePage && idx % 2 === 1) {
        doc.save().rect(LEFT, rowStartY, WIDTH, rowH).fill('#fafcfb').restore();
      }

      doc.fontSize(9.5).fillColor('#1f2d28');
      doc.text(`${item.quantity} ${item.unit}`, col2X + 4, rowStartY + 9, {
        width: col2W - 8,
        align: 'right'
      });
      doc.text(amount(item.unitPrice, q.currency), col3X + 4, rowStartY + 9, {
        width: col3W - 8,
        align: 'right'
      });
      doc.text(amount(item.amount, q.currency), col4X + 4, rowStartY + 9, {
        width: col4W - 10,
        align: 'right'
      });

      doc.fontSize(10).fillColor('#1f2d28').text(titleText, col1X + 8, rowStartY + 8, {
        width: col1W - 16
      });
      doc.fontSize(9).fillColor('#55645d').text(descText, col1X + 8, doc.y + 3, {
        width: col1W - 16,
        lineGap: 2
      });

      const rowEndY = fitsSinglePage ? rowStartY + rowH : doc.y + 8;
      doc
        .save()
        .strokeColor('#dfe5e2')
        .lineWidth(0.6)
        .moveTo(LEFT, rowEndY)
        .lineTo(RIGHT, rowEndY)
        .stroke()
        .restore();
      doc.y = rowEndY;
    });

    // Totals Summary Area (Right-aligned)
    const sumBoxW = 242;
    const sumBoxX = RIGHT - sumBoxW;
    ensureSpace(summaryRows.length * 22 + 24);
    doc.y += 10;

    for (const sr of summaryRows) {
      const rowY = doc.y;
      const valStr = `${sr.negative ? '− ' : ''}${amount(sr.value, q.currency)} ${q.currency}`;
      if (sr.grand) {
        doc
          .save()
          .roundedRect(sumBoxX, rowY, sumBoxW, 28, 3)
          .fillAndStroke('#edf4f1', '#c5dbd4')
          .restore();
        doc.fontSize(11).fillColor('#176b60').text(sr.label, sumBoxX + 10, rowY + 7, {
          width: 105,
          lineBreak: false
        });
        doc.fontSize(12).fillColor('#176b60').text(valStr, sumBoxX + 110, rowY + 6, {
          width: sumBoxW - 120,
          align: 'right',
          lineBreak: false
        });
        doc.y = rowY + 34;
      } else {
        doc.fontSize(9.5).fillColor('#55645d').text(sr.label, sumBoxX + 10, rowY + 3, {
          width: 110,
          lineBreak: false
        });
        doc.fontSize(9.5).fillColor('#1f2d28').text(valStr, sumBoxX + 115, rowY + 3, {
          width: sumBoxW - 125,
          align: 'right',
          lineBreak: false
        });
        doc.y = rowY + 20;
      }
    }

    // Commercial Terms Sections
    for (const [secTitle, secBody] of [
      [l.payment, q.paymentTerms],
      [l.delivery, q.deliveryTerms],
      [l.notes, q.notes]
    ]) {
      const bodyStr = String(secBody || '').trim();
      if (!bodyStr) continue;
      ensureSpace(48);
      doc.y += 8;
      const headY = doc.y;
      doc.save().rect(LEFT, headY + 2, 3, 12).fill('#176b60').restore();
      doc.fontSize(10.5).fillColor('#176b60').text(secTitle, LEFT + 9, headY, { width: WIDTH - 9 });
      doc.y = headY + 18;
      doc.fontSize(9.5).fillColor('#1f2d28').text(bodyStr, LEFT, doc.y, {
        width: WIDTH,
        lineGap: 3
      });
    }

    // Dual Signature Block
    ensureSpace(88);
    doc.y += 18;
    const signY = doc.y;
    const signBoxW = 242;
    const rightSignX = RIGHT - signBoxW;

    for (const [boxX, headingText, party] of [
      [LEFT, l.sellerSign, q.seller || '—'],
      [rightSignX, l.buyerSign, q.customer || '—']
    ]) {
      doc
        .save()
        .roundedRect(boxX, signY, signBoxW, 64, 4)
        .strokeColor('#dfe5e2')
        .lineWidth(0.7)
        .stroke()
        .restore();
      doc.fontSize(9).fillColor('#55645d').text(headingText, boxX + 12, signY + 9, { width: signBoxW - 24 });
      doc.fontSize(9.5).fillColor('#1f2d28').text(party, boxX + 12, signY + 24, {
        width: signBoxW - 24,
        lineBreak: false
      });
      doc.fontSize(9).fillColor('#76847d').text(l.signDate, boxX + 12, signY + 44, {
        width: signBoxW - 24,
        lineBreak: false
      });
    }
    doc.y = signY + 68;

    // Buffered Page Footers (Company Info + Page Numbers)
    const footerCompany = [q.seller, q.sellerContact, q.sellerAddress].filter(Boolean).join('  |  ');
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .save()
        .strokeColor('#e5ebe8')
        .lineWidth(0.5)
        .moveTo(LEFT, 786)
        .lineTo(RIGHT, 786)
        .stroke()
        .restore();
      if (footerCompany) {
        doc.fontSize(8).fillColor('#76847d').text(footerCompany.slice(0, 85), LEFT, 793, {
          width: 340,
          align: 'left',
          lineBreak: false
        });
      }
      doc
        .fontSize(8)
        .fillColor('#76847d')
        .text(`${q.number}  |  ${i + 1} / ${range.count}`, RIGHT - 160, 793, {
          width: 160,
          align: 'right',
          lineBreak: false
        });
      doc.page.margins.bottom = prevBottom;
    }

    doc.end();
  });
}
