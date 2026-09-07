export type ClassReportMeasurement =
  | { kind: 'single'; value: string }
  | { kind: 'paired'; first: string; second: string };

export interface ClassReportData {
  schoolName: string;
  grade: number;
  classNo: number;
  year: number;
  month: number;
  students: Array<{
    number: number;
    name: string;
    items: Array<{
      exerciseId: number;
      gradeNo: number | null;
      resultLabel: string;
      measurement: ClassReportMeasurement;
    }>;
    finalGrade: number | null;
  }>;
}

const exerciseHeaders = [
  { exerciseId: 1, category: '근력·근지구력 평가', method: '윗몸 말아올리기 (회)' },
  { exerciseId: 2, category: '순발력 평가', method: '제자리멀리뛰기 (cm)' },
  { exerciseId: 3, category: '유연성 평가', method: '앉아 윗몸앞으로 굽히기 (cm)' },
  { exerciseId: 4, category: '심폐지구력 평가', method: '스텝 검사 (PEI)' },
  { exerciseId: 5, category: '체지방지수 평가', method: 'BMI (kg/m²)' },
];

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

function gradeTone(grade: number | null): string {
  if (grade === null) return 'is-unknown';
  return grade === 4 || grade === 5 ? 'is-concern' : '';
}

function renderMeasurement(measurement: ClassReportMeasurement): string {
  if (measurement.kind === 'single') {
    return `<div class="measurement-single">${escapeHtml(measurement.value)}</div>`;
  }
  return `<div class="measurement-paired">
    <dl class="attempt"><dt>1회차</dt><dd>${escapeHtml(measurement.first)}</dd></dl>
    <dl class="attempt"><dt>2회차</dt><dd>${escapeHtml(measurement.second)}</dd></dl>
  </div>`;
}

function renderStudent(student: ClassReportData['students'][number]): string {
  return `<tr class="student-row">
    <td class="cell-no">${escapeHtml(student.number)}</td>
    <th scope="row" class="cell-name">${escapeHtml(student.name)}</th>
    ${exerciseHeaders.map(header => {
      const item = student.items.find(candidate => candidate.exerciseId === header.exerciseId);
      return `<td class="cell-data" data-exercise-id="${escapeHtml(header.exerciseId)}">
        <div class="result-label ${escapeHtml(gradeTone(item?.gradeNo ?? null))}">${escapeHtml(item && item.gradeNo !== null ? item.resultLabel : null)}</div>
        ${item ? renderMeasurement(item.measurement) : '<div class="measurement-single">-</div>'}
      </td>`;
    }).join('')}
    <td class="cell-total ${escapeHtml(gradeTone(student.finalGrade))}">${escapeHtml(student.finalGrade === null ? null : `${student.finalGrade}등급`)}</td>
  </tr>`;
}

function renderPage(data: ClassReportData, students: ClassReportData['students']): string {
  return `<section class="class-report-page">
    <header class="report-header">
      <img class="header-logo" src="/image/logo_atvcms.svg" alt="ATVCMS" width="134" height="26">
      <h1 class="header-title">스마트 PAPS 측정 결과</h1>
      <div class="header-school">${escapeHtml(data.schoolName)}</div>
    </header>
    <div class="class-info">
      <h2 class="class-title">${escapeHtml(data.grade)}학년 ${escapeHtml(data.classNo)}반 전체 기록지</h2>
      <div class="class-date">${escapeHtml(data.year)}년 ${escapeHtml(data.month)}월</div>
    </div>
    <table class="class-report-table" aria-label="학급 전체 PAPS 측정 결과">
      <colgroup>
        <col class="col-no">
        <col class="col-name">
        ${exerciseHeaders.map(() => '<col class="col-assessment">').join('')}
        <col class="col-total">
      </colgroup>
      <thead><tr>
        <th scope="col">번호</th>
        <th scope="col">이름</th>
        ${exerciseHeaders.map(header => `<th scope="col"><span class="assessment-category">${escapeHtml(header.category)}</span><span class="assessment-method">${escapeHtml(header.method)}</span></th>`).join('')}
        <th scope="col">종합 평가</th>
      </tr></thead>
      <tbody>${students.map(renderStudent).join('')}</tbody>
    </table>
  </section>`;
}

// The caller owns grading and empty student slots; paginate every supplied row.
export function renderClassReport(data: ClassReportData): string {
  const pages: string[] = [];
  for (let start = 0; start < data.students.length; start += 15) {
    pages.push(renderPage(data, data.students.slice(start, start + 15)));
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PAPS 학급 전체 기록지 - ${escapeHtml(data.grade)}학년 ${escapeHtml(data.classNo)}반</title>
<style>
  @import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css");
  @page { size: A4 landscape; margin: 10mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0; letter-spacing: 0; }
  html { background: #fff; }
  body { width: 297mm; margin: 0 auto; padding: 10mm 12mm; background: #fff; color: #201e1d; font-family: 'Pretendard', system-ui, sans-serif; font-size: 8.5pt; font-weight: 400; line-height: 1.2; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .class-report-page { width: 100%; }
  .class-report-page + .class-report-page { break-before: page; page-break-before: always; }
  .class-report-page :is(div, span, h1, h2, th, td, dl, dt, dd) { min-width: 0; overflow-wrap: anywhere; }
  .report-header, .class-info, .class-report-table thead, .student-row { break-inside: avoid; page-break-inside: avoid; }
  .report-header, .class-info { break-after: avoid; page-break-after: avoid; }
  .report-header { display: grid; grid-template-columns: 34mm minmax(0, 1fr) 46mm; gap: 4mm; align-items: center; min-height: 14mm; padding-bottom: 3.5mm; border-bottom: 2px solid #201e1d; }
  .header-logo { display: block; width: 32mm; height: auto; }
  .header-title { font-size: 14pt; line-height: 1.3; font-weight: 750; text-align: center; }
  .header-school { font-size: 9.5pt; font-weight: 600; text-align: right; }
  .class-info { display: flex; justify-content: space-between; align-items: center; gap: 4mm; min-height: 9mm; margin: 3mm 0; padding: 2mm 3mm; border-bottom: 1px solid #d8d6d6; background: #f3f2f2; }
  .class-title { font-size: 10pt; font-weight: 750; line-height: 1.3; }
  .class-date { flex: none; font-size: 9pt; color: #605d5d; text-align: right; }
  .class-report-table { width: 100%; border-collapse: collapse; table-layout: fixed; border-top: 1px solid #201e1d; }
  .col-no { width: 10mm; }
  .col-name { width: 25mm; }
  .col-assessment { width: calc((100% - 55mm) / 5); }
  .col-total { width: 20mm; }
  .class-report-table th, .class-report-table td { text-align: center; vertical-align: middle; border-bottom: 1px solid #d8d6d6; }
  .class-report-table th + th, .class-report-table td + td, .class-report-table td + th, .class-report-table th + td { border-left: 1px solid #d8d6d6; }
  .class-report-table thead { display: table-header-group; }
  .class-report-table thead tr { height: 11mm; }
  .class-report-table thead th { padding: 1.5mm 1mm; background: #f3f2f2; font-size: 8.5pt; font-weight: 700; }
  .assessment-category, .assessment-method { display: block; }
  .assessment-method { margin-top: 1mm; font-size: 8pt; font-weight: 500; color: #605d5d; }
  .student-row { height: 9.3mm; }
  .class-report-table tbody th, .class-report-table tbody td { padding: .6mm 1mm; font-size: 8.5pt; font-weight: 400; }
  .class-report-table tbody .cell-no, .class-report-table tbody .cell-name { font-weight: 700; }
  .cell-name { word-break: normal; }
  .result-label { margin-bottom: .45mm; font-size: 8.5pt; line-height: 1.15; }
  .measurement-single { font-size: 8.5pt; line-height: 1.15; }
  .measurement-paired { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }
  .attempt { display: flex; align-items: baseline; justify-content: center; gap: 1mm; padding: 0 .6mm; text-align: center; }
  .attempt + .attempt { border-left: 1px solid #d8d6d6; }
  .attempt dt { flex: none; color: #605d5d; font-size: 7pt; line-height: 1.15; }
  .attempt dd { font-size: 8.5pt; font-weight: 400; line-height: 1.15; }
  .is-unknown { color: #605d5d; }
  .is-concern { color: #ec3013; }
  @media print {
    html, body { width: auto; margin: 0; padding: 0; }
  }
</style>
</head>
<body>
<main class="class-report">${pages.join('')}</main>
</body>
</html>`;
}
