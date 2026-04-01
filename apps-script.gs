/**
 * HealthDebt — Google Apps Script Web App
 * รับข้อมูลจาก index.html แล้วบันทึกลงใน Google Sheets
 *
 * วิธีติดตั้ง:
 *   1. เปิด Spreadsheet → Extensions → Apps Script
 *   2. ลบโค้ดเดิมออก แล้ว Paste โค้ดนี้ทั้งหมด
 *   3. กด Deploy → New deployment
 *      - Type: Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   4. คัดลอก Web app URL แล้วนำไปแทนที่ค่า APPS_SCRIPT_URL ใน index.html
 */

// ── Sheet names ──────────────────────────────────────────────────────────────
const SHEET_SUBMISSIONS = 'Submissions';
const SHEET_DEBTS       = 'Debts';
const SHEET_INCOMES     = 'Incomes';
const SHEET_EXPENSES    = 'Expenses';

// ── Headers per sheet ────────────────────────────────────────────────────────
const HEADERS = {
  [SHEET_SUBMISSIONS]: [
    'Submission ID', 'วันเวลา (TH)', 'วันเวลา (ISO)',
    'สถานะ', 'ถูกทวงหนี้/หมายศาล',
    'รายได้รวม/เดือน (฿)', 'เงินออม/เดือน (฿)', 'ภาษี+ประกัน/เดือน (฿)',
    'ค่าใช้จ่าย/เดือน (฿)', 'ผ่อนหนี้รวม/เดือน (฿)', 'เงินสุทธิ/เดือน (฿)',
    'เงินสุทธิ (% รายได้)', 'ผ่อนหนี้ต่อรายได้ (%)',
    'ยอดหนี้รวม (฿)', 'ทรัพย์สินสุทธิ (฿)',
    'จำนวนหนี้ (ก้อน)', 'จำนวนแหล่งรายได้',
    'สัญญาณ: ผ่อนขั้นต่ำเท่านั้น', 'สัญญาณ: กู้หมุนเวียน',
  ],
  [SHEET_DEBTS]: [
    'Submission ID', 'วันเวลา (TH)',
    'ลำดับ', 'ประเภทหนี้', 'ชื่อเจ้าหนี้/สถาบัน',
    'ยอดหนี้คงเหลือ (฿)', 'ผ่อน/เดือน (฿)',
    'ดอกเบี้ย (%/ปี)', 'งวดที่เหลือ', 'ประเภทดอกเบี้ย',
    'ความเร่งด่วน (0=วิกฤติ 3=ต่ำ)',
  ],
  [SHEET_INCOMES]: [
    'Submission ID', 'วันเวลา (TH)',
    'ลำดับ', 'ประเภทรายได้', 'จำนวน/เดือน (฿)',
  ],
  [SHEET_EXPENSES]: [
    'Submission ID', 'วันเวลา (TH)',
    'ลำดับ', 'ชื่อค่าใช้จ่าย', 'หมวดหมู่', 'จำนวน/เดือน (฿)', 'คงที่/แปรผัน',
  ],
};

// ── Entry point ──────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    writeSubmission(payload);
    return ok('บันทึกข้อมูลสำเร็จ');
  } catch (err) {
    return fail(err.message);
  }
}

// ── Write to all sheets ──────────────────────────────────────────────────────
function writeSubmission(payload) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const id  = payload.id;
  const ts  = payload.timestamp;
  const iso = payload.timestampISO;
  const d   = payload.data;
  const an  = payload.analysis;

  // ── 1. Submissions (summary row) ─────────────────────────────────────────
  const submSheet = getOrCreateSheet(ss, SHEET_SUBMISSIONS);
  submSheet.appendRow([
    id, ts, iso,
    an.context + (an.nodeD ? '+D' : ''),
    an.nodeD ? 'ใช่' : 'ไม่ใช่',
    an.totalIncome,
    an.savMonthly,
    an.taxSS,
    an.livingExp,
    an.sumMinPayment,
    an.NCF,
    roundN(an.ncfPct, 1),
    roundN(an.dtiPct, 1),
    an.totalDebtBal,
    an.netWorth,
    (d.debts   || []).length,
    (d.incomes || []).length,
    (d.errors?.minOnly) ? 'ใช่' : 'ไม่ใช่',
    (d.errors?.newDebt) ? 'ใช่' : 'ไม่ใช่',
  ]);

  // ── 2. Debts ─────────────────────────────────────────────────────────────
  const debtSheet = getOrCreateSheet(ss, SHEET_DEBTS);
  (d.debts || []).forEach((debt, i) => {
    debtSheet.appendRow([
      id, ts,
      i + 1,
      debt.type,
      debt.creditor || '',
      debt.balance,
      debt.monthly,
      debt.interest || '',
      debt.terms    || '',
      debt.intType  || '',
      debt.priority,
    ]);
  });

  // ── 3. Incomes ───────────────────────────────────────────────────────────
  const incSheet = getOrCreateSheet(ss, SHEET_INCOMES);
  (d.incomes || []).forEach((inc, i) => {
    incSheet.appendRow([id, ts, i + 1, inc.type, inc.amount]);
  });

  // ── 4. Expenses ──────────────────────────────────────────────────────────
  const expSheet = getOrCreateSheet(ss, SHEET_EXPENSES);
  (d.expenses || []).forEach((exp, i) => {
    expSheet.appendRow([id, ts, i + 1, exp.name || '', exp.category || '', exp.amount, exp.type || '']);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(HEADERS[name]);
    // Bold header row
    sheet.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function roundN(val, decimals) {
  if (val == null || isNaN(val)) return '';
  return Math.round(val * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function ok(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
