import { money, westernDigits } from './catalog.js';

export const PAGE = Object.freeze({ widthMM: 297, heightMM: 210, dpi: 180, leftMM: 5, rightMM: 5, topMM: 6.35, bottomMM: 6.35 });
const mm = value => value * 72 / 25.4;
const px = value => value * 0.75;
export const PANEL = px(344), GAP = px(32), LABEL = px(244);
const FONT = '"TH SarabunPSK"';
export const DOCUMENT_TYPE = Object.freeze({ heading: 16, period: 15, periodNumber: 9.5, itemLineHeight: 22 });
const ink = '#181818', band = '#e7edf2', total = '#f0f2f4', netFill = '#dcebd9';
const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));

export async function ensureFonts() {
  const fonts = await Promise.all([document.fonts.load(`16px ${FONT}`), document.fonts.load(`18px ${FONT}`), document.fonts.load(`700 16px ${FONT}`), document.fonts.load(`700 18px ${FONT}`)]);
  if (fonts.some(f => !f.length || f.some(face => face.status !== 'loaded'))) throw new Error('โหลดฟอนต์ TH SarabunPSK ไม่สำเร็จ กรุณาโหลดหน้าเว็บใหม่');
  await document.fonts.ready;
}

function setFont(ctx, size = 16, bold = false, numeric = false) { ctx.font = `${bold ? 'bold ' : ''}${size}px ${numeric ? 'Arial, sans-serif' : FONT}`; }
function lineBaseline(ctx, y, height) {
  // Font-wide metrics keep every word on the same baseline, regardless of marks.
  const m = ctx.measureText('กาขฐฏญปฝฟุูิีึื่้๊๋ำAg09');
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
  return y + (height + ascent - descent) / 2;
}
function text(ctx, content, x, y, width, height, { size = 16, bold = false, numeric = false, align = 'left', color = ink } = {}) {
  const value = westernDigits(content);
  setFont(ctx, size, bold, numeric);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(value);
  const actualHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (actualHeight > height + 0.5) throw new Error(`แถวแคบเกินไปสำหรับข้อความ “${value}”`);
  if (m.width > width - 2) throw new Error(`ข้อความยาวเกินพื้นที่สลิป: “${value}”`);
  const atX = align === 'center' ? x + width / 2 : align === 'right' ? x + width - 2 : x + 2;
  ctx.fillText(value, atX, lineBaseline(ctx, y, height));
}
function periodText(ctx, value, x, y, width, height) {
  const chunks = westernDigits(value).split(/([0-9]+)/).filter(Boolean).map(t => ({ text: t, numeric: /^[0-9]+$/.test(t) }));
  const sizes = chunks.map(c => { setFont(ctx, c.numeric ? DOCUMENT_TYPE.periodNumber : DOCUMENT_TYPE.period, false, c.numeric); return ctx.measureText(c.text).width; });
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum > width - 4) throw new Error('ข้อความประจำเดือนยาวเกินพื้นที่สลิป');
  let left = x + (width - sum) / 2;
  // One baseline keeps digits aligned with the Thai text while the whole line remains centered.
  setFont(ctx, DOCUMENT_TYPE.period);
  const baseline = lineBaseline(ctx, y, height);
  chunks.forEach((chunk, i) => { setFont(ctx, chunk.numeric ? DOCUMENT_TYPE.periodNumber : DOCUMENT_TYPE.period, false, chunk.numeric); ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.fillText(chunk.text, left, baseline); left += sizes[i]; });
}

export function signatureGeometry(ctx, payer, panelWidth = PANEL) {
  setFont(ctx);
  const prefix = 'ลงชื่อ', suffix = 'ผู้จ่ายเงิน', name = `(${payer})`;
  const nameWidth = ctx.measureText(name).width;
  const prefixWidth = ctx.measureText(prefix).width, suffixWidth = ctx.measureText(suffix).width;
  const maxDots = panelWidth - prefixWidth - suffixWidth - 16;
  const dotArea = Math.max(px(190), nameWidth + 6);
  if (dotArea > maxDots) throw new Error('ชื่อผู้จ่ายเงินยาวเกินพื้นที่ลายเซ็น กรุณาตรวจสอบชื่อก่อนสร้างเอกสาร');
  const dotWidth = ctx.measureText('.').width;
  const dots = '.'.repeat(Math.floor(dotArea / dotWidth));
  const line = prefix + dots + suffix;
  const lineWidth = ctx.measureText(line).width;
  const left = (panelWidth - lineWidth) / 2;
  const start = left + ctx.measureText(prefix).width;
  const end = left + ctx.measureText(prefix + dots).width;
  return { line, name, center: (start + end) / 2, start, end, lineLeft: left, lineWidth, nameWidth };
}

export function wrapLabel(ctx, value, width = LABEL - 4) {
  setFont(ctx);
  const content = westernDigits(value);
  const words = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(content)].map(part => part.segment)
    : Array.from(content);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (ctx.measureText(line + word).width <= width) { line += word; continue; }
    if (line.trim()) lines.push(line.trim());
    line = '';
    if (ctx.measureText(word).width <= width) { line = word.trimStart(); continue; }
    const chars = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(word)].map(part => part.segment)
      : Array.from(word);
    for (const char of chars) {
      if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
      line += char;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.length ? lines : [''];
}

export function buildRows(doc, ctx, labelWidth = LABEL) {
  const itemRow = (field, category) => {
    const lines = ctx ? wrapLabel(ctx, category.display, labelWidth - 12) : [category.display];
    return { kind: 'item', field, category, lines, height: lines.length * DOCUMENT_TYPE.itemLineHeight };
  };
  const rows = [
    { kind: 'organization', height: 20 }, { kind: 'title', height: 20 }, { kind: 'period', height: 18 }, { kind: 'name', height: 20 }, { kind: 'blank', height: 5 },
    { kind: 'band', title: 'รายการรายได้ (บาท)', height: 22 },
    ...doc.income.map(c => itemRow('income', c)),
    { kind: 'total', title: 'รวมรายได้', field: 'gross', height: 22 },
    { kind: 'band', title: 'รายการหัก (บาท)', height: 22 },
    ...doc.deductions.map(c => itemRow('deductions', c)),
    { kind: 'total', title: 'รวมรายการหัก', field: 'deducted', height: 22 }, { kind: 'blank', height: 5 },
    { kind: 'net', title: 'เงินรับสุทธิ (บาท)', field: 'net', height: 27 }, { kind: 'blank', height: 20 },
    { kind: 'signature', height: 24 }, { kind: 'payer', height: 22 },
  ];
  return rows;
}

export function documentLayout(doc, ctx) {
  const usableWidth = mm(PAGE.widthMM - PAGE.leftMM - PAGE.rightMM);
  const usableHeight = mm(PAGE.heightMM - PAGE.topMM - PAGE.bottomMM);
  const amountWidth = PANEL - LABEL;
  setFont(ctx, 16);
  // Give full cooperative names room at the common font size, rather than shrinking individual labels.
  const cooperativeWidths = [...doc.income, ...doc.deductions]
    .filter(c => c.display.startsWith('สหกรณ์ออมทรัพย์'))
    .map(c => ctx.measureText(c.display).width + 12);
  let labelWidth = Math.max(LABEL, ...cooperativeWidths);
  let panelWidth = labelWidth + amountWidth;
  let rows = buildRows(doc, ctx, labelWidth);
  const initialHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const scale = Math.min(usableWidth / (panelWidth * 3 + GAP * 2), usableHeight / initialHeight, 1);
  if (16 * scale < 10) throw new Error('ไฟล์มีรายการมากเกินพื้นที่ A4 แนวนอน กรุณาตรวจสอบจำนวนหัวรายการในต้นฉบับ');
  // Height-based page fitting used to leave large side margins. Spend that space on wider panels.
  panelWidth = (usableWidth / scale - GAP * 2) / 3;
  labelWidth = panelWidth - amountWidth;
  rows = buildRows(doc, ctx, labelWidth);
  const contentHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const contentWidth = panelWidth * 3 + GAP * 2;
  return { rows, contentHeight, contentWidth, scale, panelWidth, labelWidth,
    signature: signatureGeometry(ctx, doc.payer, panelWidth) };
}

export function drawPage(canvas, doc, page, dpi = PAGE.dpi) {
  const pageW = mm(PAGE.widthMM), pageH = mm(PAGE.heightMM), raster = dpi / 72;
  canvas.width = Math.round(pageW * raster); canvas.height = Math.round(pageH * raster);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(raster, 0, 0, raster, 0, 0);
  const layout = documentLayout(doc, ctx);
  const { rows, contentHeight: contentH, contentWidth: contentW, scale, signature, panelWidth: PANEL, labelWidth: LABEL } = layout;
  const originX = (pageW - contentW * scale) / 2, originY = (pageH - contentH * scale) / 2;
  ctx.translate(originX, originY); ctx.scale(scale, scale);
  ctx.save(); ctx.strokeStyle = '#606060'; ctx.lineWidth = 0.6; ctx.setLineDash([4, 3]);
  for (const x of [PANEL + GAP / 2, PANEL * 2 + GAP * 1.5]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, contentH); ctx.stroke(); }
  ctx.restore();
  page.employees.forEach((employee, slot) => {
    const x = slot * (PANEL + GAP);
    let y = 0;
    for (const row of rows) {
      const h = row.height;
      if (row.kind === 'organization') text(ctx, doc.organization, x, y, PANEL, h, { size: DOCUMENT_TYPE.heading, bold: true, align: 'center' });
      if (row.kind === 'title') text(ctx, 'สลิปเงินเดือน', x, y, PANEL, h, { size: DOCUMENT_TYPE.heading, bold: true, align: 'center' });
      if (row.kind === 'period') periodText(ctx, doc.period, x, y, PANEL, h);
      if (row.kind === 'name') text(ctx, employee.name, x, y, PANEL, h, { bold: true });
      if (row.kind === 'band') { ctx.fillStyle = band; ctx.fillRect(x, y, PANEL, h); text(ctx, row.title, x, y, PANEL, h, { bold: true }); }
      if (row.kind === 'item') {
        const amount = employee[row.field].find(c => c.key === row.category.key)?.cents ?? 0;
        const lineHeight = h / row.lines.length;
        row.lines.forEach((line, index) => text(ctx, line, x, y + index * lineHeight, LABEL, lineHeight, { size: 16 }));
        text(ctx, money(amount), x + LABEL, y, PANEL - LABEL, h, { numeric: true, size: 10, align: 'right' });
      }
      if (row.kind === 'total' || row.kind === 'net') {
        const isNet = row.kind === 'net';
        ctx.fillStyle = isNet ? netFill : total; ctx.fillRect(x, y, PANEL, h);
        text(ctx, row.title, x, y, LABEL, h, { size: isNet ? 18 : 16, bold: true });
        text(ctx, money(employee[row.field]), x + LABEL, y, PANEL - LABEL, h, { numeric: true, bold: true, size: isNet ? 11 : 10, align: 'right' });
        ctx.strokeStyle = '#b6bec5'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + PANEL, y + h); ctx.stroke();
      }
      if (row.kind === 'signature') text(ctx, signature.line, x, y, PANEL, h, { align: 'center' });
      if (row.kind === 'payer') text(ctx, signature.name, x + signature.center - (signature.end - signature.start) / 2 - 4, y, signature.end - signature.start + 8, h, { align: 'center' });
      y += h;
    }
  });
  ctx.resetTransform();
  return { signature, scale, contentHeight: contentH, width: canvas.width, height: canvas.height };
}

export async function renderDocument(doc, { signal, onProgress = () => {} } = {}) {
  await ensureFonts();
  const canvas = document.createElement('canvas'), rendered = [];
  try {
    for (const page of doc.pages) {
      signal?.throwIfAborted();
      const metrics = drawPage(canvas, doc, page);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('สร้างภาพสลิปไม่สำเร็จ')), 'image/png'));
      signal?.throwIfAborted();
      rendered.push({ index: page.index, group: page.group, people: page.employees.length, blob, url: URL.createObjectURL(blob), metrics });
      onProgress(rendered.length, doc.pages.length);
      await nextFrame();
    }
    return rendered;
  } catch (error) { releasePages(rendered); throw error; }
  finally { canvas.width = canvas.height = 1; }
}
export function releasePages(pages) { for (const page of pages) URL.revokeObjectURL(page.url); }
