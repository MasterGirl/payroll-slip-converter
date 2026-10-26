export const normalizeText = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
export const westernDigits = value => String(value ?? '').replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0e50));
export const keyOf = value => normalizeText(value).replace(/\s/g, '');

const income = [
  ['เงินเดือน', 'เงินเดือน'],
  ['เงินเพิ่ม/ ค่าตอบแทน', 'เงินเพิ่ม / ค่าตอบแทน'],
  ['เงินประจำตำแหน่ง', 'เงินประจำตำแหน่ง'],
  ['เงินวิทยฐานะ', 'เงินวิทยฐานะ'],
];
const deductions = [
  ['ธนาคารกรุงไทย จำกัด (มหาชน)', 'ธนาคารกรุงไทย'],
  ['สหกรณ์ออมทรัพย์พนักงานเทศบาล จำกัด', 'สหกรณ์ออมทรัพย์พนักงานเทศบาล จำกัด'],
  ['สหกรณ์ออมทรัพย์ องค์กรปกครองส่วนท้องถิ่น จำกัด', 'สหกรณ์ออมทรัพย์องค์กรปกครองส่วนท้องถิ่น จำกัด'],
  ['กรมสรรพากร 2 เพื่อรับชำระเงินคืนกองทุนเงินให้กู้ยืมเพื่อการศึกษา', 'เงินกู้ยืมเพื่อการศึกษา (กยศ.)'],
  ['ภาษีหัก ณ ที่จ่าย', 'ภาษีหัก ณ ที่จ่าย'],
  ['ประกันสังคม', 'ประกันสังคม'],
  ['ธนาคารออมสิน สาขาขอนแก่น', 'ธนาคารออมสิน สาขาขอนแก่น'],
  ['ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', 'ธนาคารเพื่อการเกษตรฯ (ธ.ก.ส.)'],
  ['ธนาคารอาคารสงเคราะห์', 'ธนาคารอาคารสงเคราะห์'],
  ['ธนาคารออมสิน สาขาศรีจันทร์', 'ธนาคารออมสิน สาขาศรีจันทร์'],
  ['สหกรณ์ออมทรัพย์ครูขอนแก่น จำกัด', 'สหกรณ์ออมทรัพย์ครูขอนแก่น จำกัด'],
  ['สหกรณ์ออมทรัพย์กระทรวงยุติธรรม จำกัด', 'สหกรณ์ออมทรัพย์กระทรวงยุติธรรม จำกัด'],
  ['สอ.อบจ.', 'สหกรณ์ออมทรัพย์ข้าราชการองค์การบริหารส่วนจังหวัด จำกัด'],
  ['สหกรณ์ออมทรัพย์กระทรวงมหาดไทย จำกัด', 'สหกรณ์ออมทรัพย์กระทรวงมหาดไทย จำกัด'],
];
export const BASE_INCOME = income.map(([label, display]) => ({ key: keyOf(label), label, display }));
export const BASE_DEDUCTIONS = deductions.map(([label, display]) => ({ key: keyOf(label), label, display }));
const lookup = new Map([...BASE_INCOME, ...BASE_DEDUCTIONS].map(item => [item.key, item]));
export function category(label) {
  const text = normalizeText(label);
  return lookup.get(keyOf(text)) ?? { key: keyOf(text), label: text, display: text };
}

export function toCents(value, { required = false } = {}) {
  if (value === null || value === undefined || normalizeText(value) === '') {
    if (required) throw new Error('ไม่มีจำนวนเงิน');
    return 0;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('จำนวนเงินไม่ใช่ตัวเลขที่ถูกต้อง');
    const cents = Math.round(value * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.0001) throw new Error('จำนวนเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง');
    return cents;
  }
  let text = westernDigits(normalizeText(value)).replace(/,/g, '');
  if (/^[-–—]$/.test(text)) {
    if (required) throw new Error('ไม่มีจำนวนเงินรวม');
    return 0;
  }
  if (/^\(.*\)$/.test(text)) text = `-${text.slice(1, -1)}`;
  if (!/^[+-]?\d+(?:\.\d{1,2}0*)?$/.test(text)) throw new Error(`จำนวนเงินไม่ถูกต้อง: ${String(value)}`);
  const sign = text.startsWith('-') ? -1 : 1;
  const [whole, decimals = ''] = text.replace(/^[+-]/, '').split('.');
  const cents = sign * (Number(whole) * 100 + Number(decimals.slice(0, 2).padEnd(2, '0')));
  if (!Number.isSafeInteger(cents)) throw new Error('จำนวนเงินมากเกินขอบเขตที่คำนวณได้');
  return cents;
}

export function money(cents, dash = true) {
  if (cents === 0 && dash) return '-';
  const abs = Math.abs(cents);
  const integer = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '(' : ''}${integer}.${String(abs % 100).padStart(2, '0')}${cents < 0 ? ')' : ''}`;
}
