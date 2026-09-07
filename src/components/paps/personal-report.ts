import { reportIconLicense, renderReportIcon, type ReportIconName } from './report-icons';

export type ReportMeasurement =
  | { kind: 'single'; value: string }
  | { kind: 'paired'; first: string; second: string }
  | { kind: 'step'; pei: string; heartRates: [string, string, string] };

export interface PersonalReportData {
  schoolName: string;
  studentName: string;
  studentNo: number;
  grade: number;
  classNo: number;
  genderLabel: string;
  month: number;
  heightCm: string;
  weightKg: string;
  items: Array<{
    exerciseId: number;
    category: string;
    method: string;
    measurement: ReportMeasurement;
    score: number | null;
    gradeNo: number | null;
    resultLabel: string;
  }>;
  totalScore: number | null;
  finalGrade: number | null;
  badges: Array<{
    key: 'sports' | 'health' | 'fitness' | 'low' | 'bmi';
    label: string;
    active: boolean | null;
  }>;
}

function escapeHtml(value: string | number | null): string {
  return String(value ?? '-').replace(/[&<>"']/g, character => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

const gradePresentation: Record<number, { icon: ReportIconName; label: string }> = {
  1: { icon: 'smile', label: '매우 우수' },
  2: { icon: 'smile', label: '양호' },
  3: { icon: 'smile', label: '양호' },
  4: { icon: 'meh', label: '우려' },
  5: { icon: 'frown', label: '위험' },
};

const badgeIcons: Record<PersonalReportData['badges'][number]['key'], ReportIconName> = {
  sports: 'trophy',
  health: 'award',
  fitness: 'activity',
  low: 'batteryLow',
  bmi: 'scale',
};

function gradeTone(grade: number | null): string {
  if (grade === null) return 'is-unknown';
  return grade === 4 || grade === 5 ? 'is-concern' : '';
}

function renderMeasurement(measurement: ReportMeasurement): string {
  switch (measurement.kind) {
    case 'single':
      return `<div class="measurement-single"><span class="field-label">측정 기록</span><strong class="measurement-value">${escapeHtml(measurement.value)}</strong></div>`;
    case 'paired':
      return `<div class="measurement-paired">
        <dl class="attempt"><dt>1회차</dt><dd>${escapeHtml(measurement.first)}</dd></dl>
        <dl class="attempt"><dt>2회차</dt><dd>${escapeHtml(measurement.second)}</dd></dl>
      </div>`;
    case 'step':
      return `<div class="measurement-step">
        <dl class="step-pei"><dt>기록 (PEI)</dt><dd>${escapeHtml(measurement.pei)}</dd></dl>
        <div class="step-heart-rates">${measurement.heartRates.map((heartRate, index) =>
          `<dl class="step-reading"><dt>${escapeHtml(index + 1)}분</dt><dd>${escapeHtml(heartRate)}</dd></dl>`
        ).join('')}</div>
      </div>`;
  }
}

function renderItem(item: PersonalReportData['items'][number], index: number): string {
  const presentation = (item.gradeNo === null ? undefined : gradePresentation[item.gradeNo])
    ?? { icon: 'unknown' as const, label: '-' };

  return `<section class="report-category" aria-labelledby="category-${escapeHtml(index)}" data-exercise-id="${escapeHtml(item.exerciseId)}">
    <h2 class="category-title" id="category-${escapeHtml(index)}">${escapeHtml(item.category)}</h2>
    <div class="category-row">
      <div class="category-measure">
        <div class="measurement-method">${escapeHtml(item.method)}</div>
        ${renderMeasurement(item.measurement)}
      </div>
      <div class="category-score"><span class="field-label">평가 점수</span><strong class="score-value">${escapeHtml(item.score)}</strong></div>
      <div class="category-result ${gradeTone(item.gradeNo)}"><span class="field-label">평가 결과</span><strong class="result-value">${escapeHtml(item.gradeNo === null ? null : item.resultLabel)}</strong></div>
      <div class="category-grade ${gradeTone(item.gradeNo)}"><span class="grade-icon">${renderReportIcon(presentation.icon)}</span><span class="grade-label">${escapeHtml(presentation.label)}</span></div>
    </div>
  </section>`;
}

function renderBadge(badge: PersonalReportData['badges'][number]): string {
  const indicator = badge.active === null ? 'indeterminate' : badge.active ? 'checked' : 'unchecked';
  const stateLabel = badge.active === null ? '-' : badge.active ? '해당' : '해당 없음';
  const tone = badge.active === null ? 'is-unknown'
    : badge.active && (badge.key === 'low' || badge.key === 'bmi') ? 'is-concern' : '';

  return `<li class="report-badge ${tone}" aria-label="${escapeHtml(`${badge.label}: ${stateLabel}`)}">
    <span class="badge-icon">${renderReportIcon(badgeIcons[badge.key])}</span>
    <span class="badge-caption"><span class="badge-indicator">${renderReportIcon(indicator)}</span><span>${escapeHtml(badge.label)}</span></span>
  </li>`;
}

// Values, result labels and badge decisions belong to the caller; this module
// only formats the personal report and preserves the supplied item order.
export function renderPersonalReport(data: PersonalReportData): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PAPS 측정 결과 - ${escapeHtml(data.studentName)}</title>
${reportIconLicense}
<style>
  @import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css");
  @page { size: A4 portrait; margin: 11mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0; letter-spacing: 0; }
  html { background: #fff; }
  body { width: 210mm; margin: 0 auto; padding: 11mm 12mm; background: #fff; color: #201e1d; font-family: 'Pretendard', system-ui, sans-serif; font-size: 9.5pt; line-height: 1.35; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-page { width: 100%; min-height: 274mm; display: flex; flex-direction: column; }
  .report-page > *, .report-page :is(div, span, strong, h1, h2, dl, dt, dd, li) { min-width: 0; overflow-wrap: anywhere; }
  .report-header, .student-info, .report-category, .report-summary, .report-badges { break-inside: avoid; page-break-inside: avoid; }
  .report-header { display: grid; grid-template-columns: 34mm minmax(0, 1fr) 46mm; gap: 4mm; align-items: center; min-height: 14mm; padding-bottom: 3.5mm; border-bottom: 2px solid #201e1d; }
  .header-logo { display: block; width: 32mm; height: auto; }
  .header-title { font-size: 14pt; line-height: 1.3; font-weight: 750; text-align: center; }
  .header-school { font-size: 9.5pt; font-weight: 600; text-align: right; }
  .student-info { display: grid; grid-template-columns: 14mm minmax(0, 1fr) 40mm; gap: 4mm; align-items: center; min-height: 22mm; margin-top: 4mm; padding: 3mm; border-bottom: 1px solid #d8d6d6; background: #f3f2f2; }
  .student-number { display: flex; flex-direction: column; align-items: center; justify-content: center; color: #ec3013; font-size: 21pt; font-weight: 750; line-height: 1.15; }
  .student-number span { margin-top: 1mm; color: #605d5d; font-size: 8.5pt; font-weight: 500; }
  .student-details, .student-vitals { display: grid; gap: 2mm; }
  .student-field { display: grid; grid-template-columns: 16mm minmax(0, 1fr); gap: 2mm; align-items: baseline; }
  .student-field dt { color: #605d5d; font-size: 8.5pt; }
  .student-field dd { font-size: 9.5pt; }
  .student-field strong { font-weight: 750; }
  .student-vitals { padding-left: 4mm; border-left: 1px solid #d8d6d6; }
  .student-vitals .student-field { grid-template-columns: 8mm minmax(0, 1fr); }
  .student-vitals dd { text-align: right; }
  .unit { font-size: 8.5pt; font-weight: 400; color: #605d5d; }
  .report-categories { display: flex; flex-direction: column; flex: 1; gap: 3mm; margin-top: 5mm; }
  .report-category { display: flex; flex-direction: column; flex: 1 0 auto; }
  .category-title { border-left: 3px solid #ec3013; padding-left: 2mm; margin-bottom: 1.5mm; font-size: 10pt; line-height: 1.35; font-weight: 750; }
  /* One grid definition keeps every record/score/result/grade boundary aligned. */
  .category-row { display: grid; grid-template-columns: minmax(0, 44fr) minmax(0, 20fr) minmax(0, 20fr) minmax(0, 16fr); flex: 1; min-height: 25mm; border-top: 1px solid #201e1d; border-bottom: 1px solid #d8d6d6; }
  .category-row > div { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.3mm; padding: 2mm 3mm; text-align: center; }
  .category-row > div + div { border-left: 1px solid #d8d6d6; }
  .category-measure { background: #f3f2f2; }
  .measurement-method { width: 100%; font-size: 9pt; color: #605d5d; line-height: 1.3; }
  .field-label { font-size: 8.5pt; line-height: 1.3; color: #605d5d; font-weight: 500; }
  .measurement-single { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 1mm 2.5mm; width: 100%; }
  .measurement-value { font-size: 13.5pt; font-weight: 700; line-height: 1.2; }
  .measurement-paired, .measurement-step { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; background: #fff; border: 1px solid #d8d6d6; }
  .attempt, .step-pei { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .7mm; padding: 1.2mm; }
  .attempt + .attempt, .step-heart-rates { border-left: 1px solid #d8d6d6; }
  .attempt dt, .step-pei dt, .step-reading dt { font-size: 8.5pt; color: #605d5d; line-height: 1.2; }
  .attempt dd, .step-pei dd { font-size: 13pt; line-height: 1.2; font-weight: 700; }
  .step-reading { display: grid; grid-template-columns: 10mm minmax(0, 1fr); align-items: center; padding: .55mm 1.5mm; gap: 1mm; }
  .step-reading + .step-reading { border-top: 1px solid #d8d6d6; }
  .step-reading dd { font-size: 9pt; font-weight: 650; line-height: 1.2; }
  .score-value { font-size: 20pt; font-weight: 750; line-height: 1.2; }
  .result-value { font-size: 13pt; font-weight: 750; line-height: 1.3; }
  .grade-icon, .badge-icon, .badge-indicator { display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .grade-icon { width: 8mm; height: 8mm; }
  .grade-label { font-size: 8.5pt; font-weight: 600; line-height: 1.3; }
  svg { display: block; width: 100%; height: 100%; }
  .is-unknown { color: #605d5d; }
  .is-concern { color: #ec3013; }
  .report-summary { min-height: 24mm; margin-top: 5mm; padding: 3mm 0; border-top: 2px solid #201e1d; border-bottom: 1px solid #d8d6d6; background: #f3f2f2; }
  .summary-title { padding: 0 3mm; margin-bottom: 1.5mm; font-size: 10pt; font-weight: 750; }
  .summary-row { display: grid; grid-template-columns: minmax(0, 44fr) minmax(0, 20fr) minmax(0, 36fr); align-items: center; }
  .summary-row > * { padding: 0 3mm; text-align: center; }
  .summary-label { font-size: 9.5pt; font-weight: 600; }
  .summary-score { font-size: 21pt; font-weight: 750; line-height: 1.2; }
  .summary-score span { font-size: 9.5pt; font-weight: 500; color: #605d5d; }
  .summary-grade { font-size: 16pt; font-weight: 750; line-height: 1.2; }
  .report-badges { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); align-items: start; min-height: 22mm; margin-top: 4mm; padding-top: 3.5mm; border-top: 1px solid #201e1d; list-style: none; }
  .report-badge { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2mm; padding: 0 1mm; text-align: center; }
  .badge-icon { width: 7mm; height: 7mm; }
  .badge-caption { display: flex; align-items: center; justify-content: center; gap: 1mm; font-size: 8.5pt; font-weight: 600; line-height: 1.3; }
  .badge-indicator { width: 3.8mm; height: 3.8mm; }
  @media print {
    html, body { width: auto; margin: 0; padding: 0; }
  }
</style>
</head>
<body>
<main class="report-page">
  <header class="report-header">
    <img class="header-logo" src="/image/logo_atvcms.svg" alt="ATVCMS" width="134" height="26">
    <h1 class="header-title">스마트 PAPS 측정 결과</h1>
    <div class="header-school">${escapeHtml(data.schoolName)}</div>
  </header>
  <section class="student-info" aria-label="학생 정보">
    <div class="student-number">${escapeHtml(data.studentNo)}<span>번</span></div>
    <div class="student-details">
      <dl class="student-field"><dt>학생 정보</dt><dd>${escapeHtml(data.grade)}학년 ${escapeHtml(data.classNo)}반 <strong>${escapeHtml(data.studentName)}</strong> (${escapeHtml(data.genderLabel)})</dd></dl>
      <dl class="student-field"><dt>측정 월</dt><dd>${escapeHtml(data.month)}월</dd></dl>
    </div>
    <div class="student-vitals">
      <dl class="student-field"><dt>체중</dt><dd><strong>${escapeHtml(data.weightKg)}</strong> <span class="unit">kg</span></dd></dl>
      <dl class="student-field"><dt>신장</dt><dd><strong>${escapeHtml(data.heightCm)}</strong> <span class="unit">cm</span></dd></dl>
    </div>
  </section>
  <div class="report-categories">${data.items.map(renderItem).join('')}</div>
  <section class="report-summary" aria-labelledby="summary-title">
    <h2 class="summary-title" id="summary-title">PAPS 평가</h2>
    <div class="summary-row">
      <span class="summary-label">신체 능력 검사 결과</span>
      <strong class="summary-score">${escapeHtml(data.totalScore)}<span>/100</span></strong>
      <strong class="summary-grade ${gradeTone(data.finalGrade)}">${data.finalGrade === null ? '-' : `${escapeHtml(data.finalGrade)}등급`}</strong>
    </div>
  </section>
  <ul class="report-badges" aria-label="PAPS 평가 항목">${data.badges.map(renderBadge).join('')}</ul>
</main>
</body>
</html>`;
}
