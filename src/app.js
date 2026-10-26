import { readPayroll, ImportError } from './parser.js';
import { buildDocument } from './model.js';
import { money } from './catalog.js';
import { renderDocument, releasePages } from './renderer.js';
import { createPdf, createExcel, downloadBlob, fileBase, preparePrint, openPrintDialog } from './exporters.js';

const $ = id => document.getElementById(id);
const elements = Object.fromEntries(['file','payer','generate','dropzone','file-name','file-meta','error','error-title','error-list','progress','progress-label','progress-bar','results','empty-preview','preview-image','page-select','page-counter','previous','next','export-pdf','export-excel','print','print-pages','people-count','group-count','page-count','net-total','group-list','warnings','export-status','cancel','reset','busy-dialog','busy-title','busy-text','busy-progress','busy-elapsed'].map(id => [id,$(id)]));
let file = null, doc = null, pages = [], pageIndex = 0, controller = null, busy = false, exporting = false;
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));

function showError(error) {
  elements.error.hidden = false;
  elements['error-title'].textContent = error.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  elements['error-list'].replaceChildren();
  if (error instanceof ImportError) for (const issue of error.issues.slice(0, 25)) {
    const li = document.createElement('li');
    li.textContent = `${issue.sheet ? `ชีต ${issue.sheet}${issue.row ? ` แถว ${issue.row}` : ''}: ` : ''}${issue.message}`;
    elements['error-list'].append(li);
  }
  if (error.issues?.length > 25) { const li = document.createElement('li'); li.textContent = `และอีก ${error.issues.length - 25} รายการ`; elements['error-list'].append(li); }
}
function clearError() { elements.error.hidden = true; elements['error-list'].replaceChildren(); }
function refreshButtons() {
  elements.generate.disabled = !file || !elements.payer.value.trim() || busy || exporting;
  for (const id of ['export-pdf','export-excel','print']) elements[id].disabled = !pages.length || busy || exporting;
  elements.cancel.hidden = !busy;
  elements.file.disabled = busy || exporting;
  elements.payer.disabled = busy || exporting;
  elements.reset.disabled = busy || exporting;
}
function discard() {
  controller?.abort(); controller = null;
  releasePages(pages); pages = []; doc = null; pageIndex = 0;
  elements['preview-image'].removeAttribute('src');
  elements['empty-preview'].hidden = false; elements['preview-image'].hidden = true;
  elements.results.hidden = true; elements['print-pages'].replaceChildren();
  document.body.classList.remove('print-ready');
  elements['page-counter'].textContent = 'ยังไม่มีเอกสาร';
  elements['page-select'].replaceChildren(); elements['page-select'].disabled = true;
  elements.previous.disabled = elements.next.disabled = true;
  elements['export-status'].textContent = '';
  refreshButtons();
}
function selectFile(value) {
  clearError(); discard();
  file = null;
  if (value) {
    if (!/\.xlsx$/i.test(value.name)) { showError(new Error('กรุณาเลือกไฟล์ .xlsx ที่ส่งออกจากระบบกลาง')); }
    else if (value.size > 30 * 1024 * 1024) { showError(new Error('ไฟล์ใหญ่เกิน 30 MB กรุณาตรวจสอบไฟล์ที่เลือก')); }
    else file = value;
  }
  elements['file-name'].textContent = file ? file.name : 'กดที่นี่เพื่อเลือกไฟล์ Excel';
  elements['file-meta'].textContent = file ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(file.size / 1024)} KB · พร้อมนำเข้า` : 'ไฟล์ .xlsx จากระบบกลาง';
  elements.dropzone.classList.toggle('has-file', !!file); refreshButtons();
}
function showPage(index) {
  pageIndex = Math.max(0, Math.min(pages.length - 1, index));
  const page = pages[pageIndex]; if (!page) return;
  elements['preview-image'].src = page.url;
  elements['preview-image'].alt = `ตัวอย่างสลิปหน้า ${pageIndex + 1} จำนวน ${page.people} คน`;
  elements['page-counter'].textContent = `หน้า ${pageIndex + 1} จาก ${pages.length} · ${page.people} คน`;
  elements['page-select'].value = String(pageIndex);
  elements.previous.disabled = pageIndex === 0; elements.next.disabled = pageIndex === pages.length - 1;
}
function populateResults(imported) {
  elements['people-count'].textContent = String(doc.people);
  elements['group-count'].textContent = String(doc.groups.length);
  elements['page-count'].textContent = String(pages.length);
  elements['net-total'].textContent = money(doc.net, false);
  elements['group-list'].replaceChildren();
  for (const group of doc.groups) {
    const row = document.createElement('div'); row.className = 'group-row';
    const name = document.createElement('span'); name.textContent = group.name;
    const count = document.createElement('span'); count.textContent = `${group.employees.length} คน · ${Math.ceil(group.employees.length / 3)} หน้า`;
    row.append(name, count); elements['group-list'].append(row);
  }
  elements.warnings.replaceChildren(); elements.warnings.hidden = !imported.warnings.length;
  for (const message of imported.warnings) { const p = document.createElement('p'); p.textContent = message; elements.warnings.append(p); }
  elements['page-select'].replaceChildren(...pages.map(page => {
    const option = document.createElement('option'); option.value = String(page.index); option.textContent = `หน้า ${page.index + 1} · ${page.group}`; return option;
  }));
  elements['page-select'].disabled = false;
  elements.results.hidden = false; elements['empty-preview'].hidden = true; elements['preview-image'].hidden = false;
  showPage(0);
}
async function generate(event) {
  event.preventDefault(); if (!file || busy) return;
  discard(); clearError(); busy = true; controller = new AbortController();
  const signal = controller.signal;
  elements.progress.hidden = false; elements['progress-bar'].value = 0;
  elements['progress-label'].textContent = 'กำลังอ่านและตรวจสอบข้อมูลในไฟล์…'; refreshButtons();
  try {
    await yieldUI();
    const imported = readPayroll(await file.arrayBuffer()); signal.throwIfAborted();
    doc = buildDocument(imported, elements.payer.value);
    pages = await renderDocument(doc, { signal, onProgress: (current, total) => {
      elements['progress-label'].textContent = `กำลังสร้างสลิป ${current} / ${total} หน้า`;
      elements['progress-bar'].value = current / total * 100;
    }});
    signal.throwIfAborted();
    populateResults(imported);
    elements['progress-label'].textContent = `สร้างครบ ${pages.length} หน้าแล้ว กำลังเตรียมหน้าสำหรับพิมพ์ กรุณารอ…`;
    // Preload the print images before enabling Print, so its click can open the native dialog directly.
    await preparePrint(pages, elements['print-pages']); signal.throwIfAborted();
    document.body.classList.add('print-ready');
    elements['export-status'].textContent = 'พร้อมพิมพ์และส่งออก';
  } catch (error) {
    discard();
    if (error.name !== 'AbortError') showError(error);
  } finally { busy = false; controller = null; elements.progress.hidden = true; refreshButtons(); }
}
async function exportFile(type) {
  if (!pages.length || exporting || busy) return;
  exporting = true; clearError(); refreshButtons();
  const label = type === 'pdf' ? 'PDF' : 'Excel';
  const dialog = elements['busy-dialog'], started = Date.now();
  elements['busy-title'].textContent = `กำลังสร้างไฟล์ ${label}`;
  elements['busy-text'].textContent = 'ขั้นตอน 1 จาก 2: กำลังเตรียมหน้าสลิป';
  elements['busy-progress'].value = 0;
  elements['busy-elapsed'].textContent = 'กรุณารอ ไม่ต้องกดปุ่มซ้ำ';
  dialog.hidden = false; dialog.showModal();
  const timer = setInterval(() => {
    elements['busy-elapsed'].textContent = `ผ่านไป ${Math.floor((Date.now() - started) / 1000)} วินาที · กรุณารอ ไม่ต้องกดซ้ำ`;
  }, 1000);
  try {
    await yieldUI();
    const progress = (current, total) => {
      const message = `ขั้นตอน 1 จาก 2: จัดหน้าสลิป ${current} จาก ${total} หน้า`;
      elements['export-status'].textContent = message; elements['busy-text'].textContent = message;
      elements['busy-progress'].value = current / total * 85;
    };
    const phase = value => {
      if (value === 'packing') {
        const message = `ขั้นตอน 2 จาก 2: กำลังรวมและบันทึกไฟล์ ${label} กรุณารออีกสักครู่…`;
        elements['export-status'].textContent = message; elements['busy-text'].textContent = message;
        elements['busy-progress'].removeAttribute('value');
      }
      if (value === 'ready') {
        elements['busy-text'].textContent = 'ไฟล์พร้อมแล้ว กำลังเริ่มดาวน์โหลด…';
        elements['busy-progress'].value = 100;
      }
    };
    const blob = await (type === 'pdf' ? createPdf(pages, progress, phase) : createExcel(doc, progress, phase));
    await yieldUI();
    downloadBlob(blob, `${fileBase(doc)}.${type === 'pdf' ? 'pdf' : 'xlsx'}`);
    elements['export-status'].textContent = `ส่งไฟล์ ${label} ให้เบราว์เซอร์ดาวน์โหลดแล้ว · ${pages.length} หน้า`;
  } catch (error) { showError(error); elements['export-status'].textContent = 'ส่งออกไม่สำเร็จ กรุณาลองอีกครั้ง'; }
  finally { clearInterval(timer); dialog.close(); dialog.hidden = true; exporting = false; refreshButtons(); }
}

elements.file.addEventListener('change', () => selectFile(elements.file.files[0]));
elements.payer.addEventListener('input', () => { if (pages.length) discard(); clearError(); refreshButtons(); });
$('import-form').addEventListener('submit', generate);
elements.cancel.addEventListener('click', () => controller?.abort());
elements.reset.addEventListener('click', () => { selectFile(null); elements.file.value = ''; elements.payer.value = ''; refreshButtons(); elements.file.focus(); });
elements['export-pdf'].addEventListener('click', () => exportFile('pdf'));
elements['export-excel'].addEventListener('click', () => exportFile('xlsx'));
elements.print.addEventListener('click', () => { if (pages.length && !busy && !exporting) openPrintDialog(); });
elements['page-select'].addEventListener('change', () => showPage(Number(elements['page-select'].value)));
elements.previous.addEventListener('click', () => showPage(pageIndex - 1)); elements.next.addEventListener('click', () => showPage(pageIndex + 1));
for (const event of ['dragenter','dragover']) elements.dropzone.addEventListener(event, e => { e.preventDefault(); if (!busy && !exporting) elements.dropzone.classList.add('dragging'); });
for (const event of ['dragleave','drop']) elements.dropzone.addEventListener(event, e => { e.preventDefault(); elements.dropzone.classList.remove('dragging'); });
elements.dropzone.addEventListener('drop', e => { if (!busy && !exporting) selectFile(e.dataTransfer.files[0]); });
window.addEventListener('beforeunload', () => releasePages(pages));
elements['busy-dialog'].addEventListener('cancel', event => event.preventDefault());
refreshButtons();
