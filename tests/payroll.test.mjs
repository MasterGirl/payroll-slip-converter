import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from '../vendor/xlsx.mjs';
import { toCents, money, keyOf } from '../src/catalog.js';
import { parseWorkbook, ImportError } from '../src/parser.js';
import { buildDocument, cleanPayer } from '../src/model.js';

function source({ names = ['คุณทดสอบ หนึ่ง'], noDeductions = false, badNet = false, invalid = false, shift = 0 } = {}) {
  const pad = row => [...Array(shift).fill(null), ...row];
  const rows = [pad(['เทศบาลตัวอย่าง']), pad(['ประจำเดือน มกราคม พ.ศ. 2570']), pad([]),
    pad(['ชื่อ - สกุล', 'ประเภทพนักงาน', 'หน่วยงาน', 'รายการรับ', null, null, ...(noDeductions ? ['รับสุทธิ'] : ['รายการหัก', null, null, 'รับสุทธิ'])]),
    pad([null, null, null, 'เงินเดือน', 'เงินเพิ่ม/\nค่าตอบแทน', 'รวมรายการรับ', ...(noDeductions ? [] : ['ธนาคารกรุงไทย จำกัด \n(มหาชน)', 'ประกันสังคม', 'รวมรายการหัก'])]),
  ];
  for (const name of names) rows.push(pad([name,'พนักงานจ้าง',null,invalid ? 'อ่านไม่ได้' : 9000,2000,11000,...(noDeductions ? [11000] : [1000,550,1550,badNet ? 9451 : 9450])]));
  rows.push(pad([null,null,'รวมทั้งสิ้น',9000*names.length,2000*names.length,11000*names.length,...(noDeductions ? [11000*names.length] : [1000*names.length,550*names.length,1550*names.length,(badNet ? 9451 : 9450)*names.length])]));
  rows.push(pad([null,null,'ประเภทรายจ่าย',null,null,999999]));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'งานทดสอบ'); return wb;
}

test('decimal amounts use exact cents, distinguish invalid data, and print Western digits without currency', () => {
  assert.equal(toCents(15113),1511300); assert.equal(toCents(4889.5),488950);
  assert.equal(toCents('๑,๒๓๔.๕๐'),123450); assert.equal(toCents('(1,000.25)'),-100025);
  assert.equal(toCents('-'),0); assert.equal(toCents(null),0); assert.equal(toCents(0,{required:true}),0);
  assert.throws(()=>toCents(null,{required:true})); assert.throws(()=>toCents('ผิด')); assert.throws(()=>toCents(1.234));
  assert.equal(money(4358000),'43,580.00'); assert.equal(money(0),'-'); assert.equal(money(-101),'(1.01)');
});
test('source parser normalizes wrapped headings and stops at total before budget rows', () => {
  const parsed=parseWorkbook(source()); assert.equal(parsed.groups[0].employees.length,1);
  const e=parsed.groups[0].employees[0]; assert.equal(e.net,945000); assert.equal(e.income[1].key,keyOf('เงินเพิ่ม/ ค่าตอบแทน'));
  assert.equal(parsed.period,'ประจำเดือน มกราคม พ.ศ. 2570'); assert.equal(parsed.organization,'เทศบาลตัวอย่าง');
});
test('source parser follows headers when columns move', () => { assert.equal(parseWorkbook(source({shift:4})).groups[0].employees[0].net,945000); });
test('a sheet with no deduction columns is valid', () => {
  const e=parseWorkbook(source({noDeductions:true})).groups[0].employees[0]; assert.equal(e.deductions.length,0); assert.equal(e.net,e.gross);
});
test('invalid values and totals fail with sheet and source row details', () => {
  assert.throws(()=>parseWorkbook(source({badNet:true})),e=>e instanceof ImportError && e.issues.some(i=>i.row===6 && /รับสุทธิ/.test(i.message)));
  assert.throws(()=>parseWorkbook(source({invalid:true})),e=>e.issues.some(i=>/อ่านไม่ได้/.test(i.message)));
});
test('pages start over at each existing sheet and do not duplicate names in unused slots', () => {
  const wb=source({names:['คนที่หนึ่ง','คนที่สอง','คนที่สาม','คนที่สี่']});
  const second=source({names:['อีกกลุ่ม']}); XLSX.utils.book_append_sheet(wb,second.Sheets[second.SheetNames[0]],'อีกงาน');
  const doc=buildDocument(parseWorkbook(wb),'นายทดสอบ ผู้จ่าย');
  assert.deepEqual(doc.pages.map(p=>p.employees.length),[3,1,1]);
  assert.equal(doc.people,5); assert.equal(doc.pages[2].group,'อีกงาน'); assert.equal(doc.payer,'นายทดสอบ ผู้จ่าย');
  assert.equal(cleanPayer(' ( นายทดสอบ ผู้จ่าย ) '),'นายทดสอบ ผู้จ่าย');
  assert.throws(()=>cleanPayer(' '));
});
test('unknown income/deduction headings remain in the document catalog', () => {
  const parsed=parseWorkbook(source()); parsed.groups[0].employees[0].deductions.push({key:'new',label:'รายการใหม่',display:'รายการใหม่',cents:0});
  const doc=buildDocument(parsed,'ผู้จ่าย'); assert.ok(doc.deductions.some(c=>c.key==='new'));
});

