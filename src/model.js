import { BASE_INCOME, BASE_DEDUCTIONS, normalizeText } from './catalog.js';

export function cleanPayer(value) {
  const name = normalizeText(value).replace(/^\((.*)\)$/, '$1').trim();
  if (!name) throw new Error('กรุณากรอกชื่อผู้จ่ายเงิน');
  if (name.length > 120) throw new Error('ชื่อผู้จ่ายเงินยาวเกิน 120 ตัวอักษร');
  return name;
}
function catalog(base, records, field) {
  const all = new Map(base.map(c => [c.key, { ...c }]));
  for (const employee of records) for (const c of employee[field]) if (!all.has(c.key)) all.set(c.key, { key: c.key, label: c.label, display: c.display });
  return [...all.values()];
}
export function buildDocument(imported, payerInput) {
  const payer = cleanPayer(payerInput);
  const employees = imported.groups.flatMap(group => group.employees);
  const pages = [];
  for (const group of imported.groups) {
    for (let start = 0; start < group.employees.length; start += 3) pages.push({ index: pages.length, group: group.name, employees: group.employees.slice(start, start + 3) });
  }
  return {
    organization: imported.organization, period: imported.period, payer, pages,
    income: catalog(BASE_INCOME, employees, 'income'), deductions: catalog(BASE_DEDUCTIONS, employees, 'deductions'),
    people: employees.length, groups: imported.groups,
    gross: employees.reduce((sum, e) => sum + e.gross, 0), deducted: employees.reduce((sum, e) => sum + e.deducted, 0), net: employees.reduce((sum, e) => sum + e.net, 0),
  };
}
