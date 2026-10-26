import { PAGE } from './renderer.js';
export { createExcel } from './excel-export.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
export function fileBase(doc) { return `สลิปเงินเดือน_${doc.period.replace(/^ประจำเดือน\s*/, '').replace(/[<>:"/\\|?*]/g, '-').trim()}`; }
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function createPdf(pages, onProgress = () => {}, onPhase = () => {}) {
  const { PDFDocument } = window.PDFLib ?? {};
  if (!PDFDocument) throw new Error('โหลดตัวส่งออก PDF ไม่สำเร็จ กรุณาโหลดหน้าเว็บใหม่');
  const pdf = await PDFDocument.create();
  pdf.setTitle('สลิปเงินเดือน'); pdf.setProducer('Payroll Slip Converter');
  const w = PAGE.widthMM * 72 / 25.4, h = PAGE.heightMM * 72 / 25.4;
  onPhase('building');
  for (let i = 0; i < pages.length; i++) {
    const image = await pdf.embedPng(await pages[i].blob.arrayBuffer());
    pdf.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
    onProgress(i + 1, pages.length); await pause();
  }
  onPhase('packing'); await pause();
  const bytes = await pdf.save({ objectsPerTick: 25 });
  onPhase('ready');
  return new Blob([bytes], { type: 'application/pdf' });
}
export async function preparePrint(pages, container) {
  const fragment = document.createDocumentFragment();
  const ready = [];
  for (const page of pages) {
    const section = document.createElement('div'); section.className = 'print-page';
    const image = document.createElement('img');
    image.alt = ''; image.src = page.url; image.width = page.metrics.width; image.height = page.metrics.height;
    ready.push(image.decode()); section.append(image); fragment.append(section);
  }
  container.replaceChildren(fragment);
  await Promise.all(ready);
  await document.fonts.ready;
}
export function openPrintDialog() { window.print(); }
