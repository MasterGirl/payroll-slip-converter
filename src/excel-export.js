import { PAGE, GAP, DOCUMENT_TYPE, documentLayout, ensureFonts } from './renderer.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const numberFormat = '#,##0.00;[Red](#,##0.00);"-"';
function column(index) {
  let name = '';
  for (let n = index; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
const thai = (size, bold = false) => ({ name: 'TH SarabunPSK', size, bold, color: { argb: 'FF181818' } });
const numeric = (size = 10, bold = false) => ({ name: 'Arial', size, bold, color: { argb: 'FF181818' } });
const fill = color => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });

export async function createExcel(doc, onProgress = () => {}, onPhase = () => {}) {
  const { Workbook } = window.ExcelJS ?? {};
  if (!Workbook) throw new Error('โหลดตัวส่งออก Excel ไม่สำเร็จ กรุณาโหลดหน้าเว็บใหม่');
  await ensureFonts();
  const ctx = document.createElement('canvas').getContext('2d');
  const layout = documentLayout(doc, ctx), { rows, signature, panelWidth: PANEL, labelWidth: LABEL } = layout;
  const pad = Math.min(21.75, signature.start / 2, (PANEL - signature.end) / 2);
  const boundaries = [...new Set([0, pad, signature.start, LABEL, signature.end, PANEL - pad, PANEL])].sort((a, b) => a - b);
  while (boundaries.length < 7) {
    const spans = boundaries.slice(1).map((b, i) => b - boundaries[i]);
    const i = spans.indexOf(Math.max(...spans));
    boundaries.splice(i + 1, 0, (boundaries[i] + boundaries[i + 1]) / 2);
  }
  const widths = boundaries.slice(1).map((b, i) => b - boundaries[i]);
  const labelEnd = boundaries.indexOf(LABEL) - 1;
  const payerStart = boundaries.indexOf(signature.start), payerEnd = boundaries.indexOf(signature.end) - 1;
  if (widths.some(w => w <= 0)) throw new Error('จัดตำแหน่งลายเซ็นใน Excel ไม่สำเร็จ กรุณาตรวจสอบชื่อผู้จ่ายเงิน');
  const workbook = new Workbook();
  workbook.creator = 'Payroll Slip Converter';
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet('สลิปเงินเดือน', {
    views: [{ showGridLines: false, zoomScale: 85 }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: false,
      scale: Math.max(10, Math.floor(layout.scale * 100)),
      horizontalCentered: true, verticalCentered: true,
      printArea: `A1:V${rows.length * doc.pages.length}`,
      showGridLines: false, showRowColHeaders: false,
      margins: { left: PAGE.leftMM / 25.4, right: PAGE.rightMM / 25.4,
        top: PAGE.topMM / 25.4, bottom: PAGE.bottomMM / 25.4, header: 0, footer: 0 },
    },
  });
  for (const start of [1, 9, 17]) widths.forEach((width, i) => { sheet.getColumn(start + i).width = Math.max(0.1, (width / 0.75 - 5) / 7); });
  for (const c of [7, 8, 15, 16]) sheet.getColumn(c).width = (GAP / 2 / 0.75 - 5) / 7;
  const grossIndex = rows.findIndex(r => r.kind === 'total' && r.field === 'gross');
  const deductedIndex = rows.findIndex(r => r.kind === 'total' && r.field === 'deducted');
  const itemIndexes = field => rows.flatMap((r, i) => r.kind === 'item' && r.field === field ? [i] : []);
  const incomeIndexes = itemIndexes('income'), deductedIndexes = itemIndexes('deductions');
  onPhase('building');
  for (let pageIndex = 0; pageIndex < doc.pages.length; pageIndex++) {
    const page = doc.pages[pageIndex], offset = pageIndex * rows.length;
    rows.forEach((row, i) => { sheet.getRow(offset + i + 1).height = row.height; });
    for (const c of [7, 15]) for (let i = 0; i < rows.length; i++) sheet.getCell(offset + i + 1, c).border = { right: { style: 'dashed', color: { argb: 'FF606060' } } };
    page.employees.forEach((employee, slot) => {
      const start = [1, 9, 17][slot], end = start + 5, amount = start + labelEnd + 1, amountCol = column(amount);
      const merged = (r, first, last, value, alignment = 'left') => {
        sheet.mergeCells(r, first, r, last);
        const cell = sheet.getCell(r, first); cell.value = value;
        cell.font = thai(16); cell.alignment = { horizontal: alignment, vertical: 'middle', wrapText: true };
        return cell;
      };
      rows.forEach((row, i) => {
        const r = offset + i + 1;
        if (row.kind === 'blank') return;
        if (row.kind === 'organization' || row.kind === 'title') {
          merged(r, start, end, row.kind === 'title' ? 'สลิปเงินเดือน' : doc.organization, 'center').font = thai(DOCUMENT_TYPE.heading, true);
        } else if (row.kind === 'period') {
          const richText = doc.period.split(/([0-9]+)/).filter(Boolean).map(text => ({ text, font: /^[0-9]+$/.test(text) ? numeric(DOCUMENT_TYPE.periodNumber) : thai(DOCUMENT_TYPE.period) }));
          merged(r, start, end, { richText }, 'center');
        } else if (row.kind === 'name') {
          merged(r, start, end, employee.name).font = thai(16, true);
        } else if (row.kind === 'band') {
          const band = merged(r, start, end, row.title);
          band.fill = fill('FFE7EDF2'); band.font = thai(16, true);
        } else if (row.kind === 'signature') {
          merged(r, start, end, signature.line, 'center');
        } else if (row.kind === 'payer') {
          merged(r, start + payerStart, start + payerEnd, signature.name, 'center');
        } else {
          merged(r, start, start + labelEnd, row.kind === 'item' ? row.lines.join('\n') : row.title);
          let value;
          if (row.kind === 'item') value = (employee[row.field].find(c => c.key === row.category.key)?.cents ?? 0) / 100;
          else if (row.kind === 'net') value = { formula: `${amountCol}${offset + grossIndex + 1}-${amountCol}${offset + deductedIndex + 1}`, result: employee.net / 100 };
          else {
            const indexes = row.field === 'gross' ? incomeIndexes : deductedIndexes;
            value = { formula: indexes.length ? `SUM(${amountCol}${offset + indexes[0] + 1}:${amountCol}${offset + indexes.at(-1) + 1})` : '0', result: employee[row.field] / 100 };
          }
          const number = merged(r, amount, end, value, 'right');
          number.font = numeric(row.kind === 'net' ? 11 : 10, row.kind !== 'item'); number.numFmt = numberFormat;
          if (row.kind !== 'item') {
            sheet.getCell(r, start).font = thai(row.kind === 'net' ? 18 : 16, true);
            for (let c = start; c <= end; c++) {
              const cell = sheet.getCell(r, c); cell.fill = fill(row.kind === 'net' ? 'FFDCEBD9' : 'FFF0F2F4');
              cell.border = { bottom: { style: 'thin', color: { argb: 'FFB6BEC5' } } };
            }
          }
        }
      });
    });
    if (pageIndex < doc.pages.length - 1) sheet.getRow(offset + rows.length).addPageBreak();
    onProgress(pageIndex + 1, doc.pages.length); await pause();
  }
  sheet.headerFooter.oddHeader = ''; sheet.headerFooter.oddFooter = '';
  onPhase('packing'); await pause();
  const bytes = await workbook.xlsx.writeBuffer({ zip: { compression: 'DEFLATE', compressionOptions: { level: 3 } } });
  onPhase('ready');
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
