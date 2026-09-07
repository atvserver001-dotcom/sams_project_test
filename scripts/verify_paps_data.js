const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verify() {
  const schoolName = '지수 초등학교_테스트';
  const year = 2026;
  const grade = 1;
  const classNo = 1;

  console.log(`>>> "${schoolName}" 다회차 데이터 검증 시작...`);

  // 1. 학교 확인
  const { data: school } = await supabase.from('schools').select('id').eq('name', schoolName).single();
  if (!school) {
    console.error('학교를 찾을 수 없습니다.');
    return;
  }

  // 2. 학생 목록 조회
  const { data: students } = await supabase
    .from('students')
    .select('id, student_no, name')
    .eq('school_id', school.id)
    .eq('year', year)
    .eq('grade', grade)
    .eq('class_no', classNo)
    .order('student_no', { ascending: true });

  console.log(`>>> 해당 학급 학생 수: ${students.length}명`);

  // 3. 각 학생별 PAPS 회차 정보 확인
  let totalRecords = 0;
  for (const s of students) {
    if (s.student_no > 10) continue; // 1~10번만 확인

    const { data: records } = await supabase
      .from('paps_records')
      .select('round_no, measured_at')
      .eq('student_id', s.id)
      .eq('year', year)
      .order('round_no', { ascending: true });

    if (records && records.length > 0) {
      console.log(`- [${s.student_no}번] ${s.name}: 총 ${records.length}회차 기록 확인됨`);
      records.forEach(r => {
        console.log(`    Round ${r.round_no}: ${r.measured_at}`);
      });
      totalRecords += records.length;
    } else {
      console.log(`- [${s.student_no}번] ${s.name}: PAPS 기록 없음!`);
    }
  }

  console.log(`>>> 최종 확인: 총 ${totalRecords}개의 2026년도 PAPS 기록이 확인되었습니다.`);
}

verify();
