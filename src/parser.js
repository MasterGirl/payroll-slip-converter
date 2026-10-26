import * as XLSX from '../vendor/xlsx.mjs';
import { category, keyOf, normalizeText, westernDigits, toCents, money } from './catalog.js';

export class ImportError extends Error {
  constructor(message, issues = []) { super(message); this.name = 'ImportError'; this.issues = issues; }
}
const K = Object.fromEntries(['ชื่อ - สกุล', 'ประเภทพนักงาน', 'รายการรับ', 'รายการหัก', 'รับสุทธิ', 'รวมรายการรับ', 'รวมรายการหัก', 'รวมทั้งสิ้น'].map(v => [v, keyOf(v)]));

export function parseWorkbook(workbook) {
  const issues = [], warnings = [], groups = [], periods = new Set(), organizations = new Set();
  const sheetNames = workbook.SheetNames ?? [];
  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
    const head = rows.findIndex(row => row.some(v => keyOf(v) === K['ชื่อ - สกุล']));
    for (const row of rows.slice(0, head >= 0 ? head : 12)) {
      for (const value of row) {
        const text = westernDigits(normalizeText(value));
        if (/^ประจำเดือน\s/.test(text)) periods.add(text);
        if (/^(เทศบาล|องค์การบริหารส่วนตำบล|องค์การบริหารส่วนจังหวัด|กรุงเทพมหานคร|เมืองพัทยา)/.test(text)) organizations.add(text);
      }
    }
    if (head < 0) {
      if (rows.some(row => row.some(v => normalizeText(v)))) warnings.push(`ข้ามชีต “${sheetName}” เนื่องจากไม่พบหัวตารางรายชื่อ`);
      continue;
    }
    const main = new Map(rows[head].map((v, col) => [keyOf(v), col]).filter(([key]) => key));
    const sub = (rows[head + 1] ?? []).map((value, col) => ({ ...category(value), col })).filter(c => c.key);
    const getCol = label => main.get(K[label]);
    const nameCol = getCol('ชื่อ - สกุล'), incomeStart = getCol('รายการรับ'), netCol = getCol('รับสุทธิ');
    const deductionStart = getCol('รายการหัก') ?? netCol;
    const grossCol = sub.find(c => c.key === K['รวมรายการรับ'])?.col;
    const deductedCol = sub.find(c => c.key === K['รวมรายการหัก'])?.col;
    if ([nameCol, incomeStart, netCol, grossCol].some(v => v === undefined)) {
      issues.push({ sheet: sheetName, row: head + 1, message: 'หัวตารางไม่ครบ ต้องมีชื่อ รายการรับ รวมรายการรับ และรับสุทธิ' });
      continue;
    }
    const incomes = sub.filter(c => c.col >= incomeStart && c.col < deductionStart && c.col !== grossCol);
    const deductions = sub.filter(c => c.col >= deductionStart && c.col < netCol && c.col !== deductedCol);
    if (!incomes.length || (deductions.length && deductedCol === undefined)) {
      issues.push({ sheet: sheetName, row: head + 2, message: 'ไม่พบรายการรายได้หรือหัวรวมรายการหัก' });
      continue;
    }
    for (const entries of [incomes, deductions]) {
      if (new Set(entries.map(c => c.key)).size !== entries.length) issues.push({ sheet: sheetName, row: head + 2, message: 'มีหัวรายการซ้ำกันในส่วนเดียวกัน' });
    }
    const employees = [];
    const read = (value, label, row, required = false) => {
      try { return toCents(value, { required }); }
      catch (error) { issues.push({ sheet: sheetName, row: row + 1, message: `${label}: ${error.message}` }); return null; }
    };
    let control = null;
    for (let ri = head + 2; ri < rows.length; ri++) {
      const row = rows[ri];
      if (row.some(v => keyOf(v) === K['รวมทั้งสิ้น'])) { control = { row, ri }; break; }
      const name = normalizeText(row[nameCol]);
      if (!name) {
        if (incomes.some(c => typeof row[c.col] === 'number' && row[c.col] !== 0)) issues.push({ sheet: sheetName, row: ri + 1, message: 'มีรายการเงินแต่ไม่มีชื่อผู้รับเงิน' });
        continue;
      }
      const initialIssues = issues.length;
      const income = incomes.map(c => ({ ...c, cents: read(row[c.col], c.label, ri) }));
      const deduction = deductions.map(c => ({ ...c, cents: read(row[c.col], c.label, ri) }));
      const gross = read(row[grossCol], 'รวมรายการรับ', ri, true);
      const deducted = deductedCol === undefined ? 0 : read(row[deductedCol], 'รวมรายการหัก', ri, true);
      const net = read(row[netCol], 'รับสุทธิ', ri, true);
      if (issues.length !== initialIssues) continue;
      const calculatedGross = income.reduce((sum, c) => sum + c.cents, 0);
      const calculatedDeductions = deduction.reduce((sum, c) => sum + c.cents, 0);
      for (const [label, actual, expected] of [['รวมรายได้', gross, calculatedGross], ['รวมรายการหัก', deducted, calculatedDeductions], ['รับสุทธิ', net, calculatedGross - calculatedDeductions]]) {
        if (actual !== expected) issues.push({ sheet: sheetName, row: ri + 1, message: `${name}: ${label}ในต้นฉบับ ${money(actual, false)} ต่างจากผลคำนวณ ${money(expected, false)}` });
      }
      employees.push({ name, income, deductions: deduction, gross, deducted, net, sourceSheet: sheetName, sourceRow: ri + 1 });
    }
    if (control) {
      for (const [col, key, title] of [[grossCol, 'gross', 'รวมรายได้'], [deductedCol, 'deducted', 'รวมรายการหัก'], [netCol, 'net', 'รับสุทธิ']]) {
        if (col === undefined) continue;
        const actual = read(control.row[col], `แถวรวม ${title}`, control.ri, true);
        const sum = employees.reduce((total, employee) => total + employee[key], 0);
        if (actual !== null && actual !== sum) issues.push({ sheet: sheetName, row: control.ri + 1, message: `ยอด${title}แถวรวมไม่ตรงกับรายชื่อที่อ่านได้` });
      }
    }
    if (employees.length) groups.push({ id: groups.length, name: sheetName, employees });
    else warnings.push(`ชีต “${sheetName}” ไม่มีรายชื่อผู้รับเงิน`);
  }
  if (periods.size !== 1) issues.push({ message: periods.size ? 'พบมากกว่าหนึ่งงวดเงินเดือนในไฟล์เดียว' : 'ไม่พบข้อความประจำเดือนในหัวรายงาน' });
  if (organizations.size !== 1) issues.push({ message: organizations.size ? 'พบชื่อหน่วยงานหัวรายงานมากกว่าหนึ่งแห่ง' : 'ไม่พบชื่อเทศบาล/หน่วยงานในหัวรายงาน' });
  if (!groups.length) issues.push({ message: 'ไม่พบรายชื่อพนักงานในไฟล์' });
  if (issues.length) throw new ImportError('ยังสร้างสลิปไม่ได้ กรุณาตรวจสอบข้อมูลต้นฉบับ', issues);
  return { organization: [...organizations][0], period: [...periods][0], groups, warnings, sheetCount: sheetNames.length };
}

export function readPayroll(buffer) {
  let workbook;
  try { workbook = XLSX.read(buffer, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, WTF: false }); }
  catch { throw new ImportError('เปิดไฟล์ไม่ได้ กรุณาเลือกไฟล์ .xlsx ที่ส่งออกจากระบบกลาง'); }
  return parseWorkbook(workbook);
}
