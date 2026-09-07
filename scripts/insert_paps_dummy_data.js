const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const schoolName = '지수 초등학교_테스트';
  const targetYear = 2026;
  const grade = 1;
  const classNo = 1;
  const today = new Date('2026-03-03');

  console.log(`>>> "${schoolName}" 학교 PAPS 측정 날짜 순서 변경 및 삽입 시작...`);

  // 1. 학교 확인
  const { data: school } = await supabase.from('schools').select('id').eq('name', schoolName).single();
  if (!school) {
    console.error('학교를 찾을 수 없습니다.');
    return;
  }
  const schoolId = school.id;

  // 2. 학생별 라운드 수 설정
  const roundSettings = {
    1: 5,
    2: 4,
    3: 3,
    4: 2
  };

  // 3. 학생 데이터 보존 및 PAPS 기록 삽입
  const papsRecords = [];
  for (let i = 1; i <= 10; i++) {
    // 2026년도 학생 식별
    let { data: student } = await supabase.from('students')
      .select('id')
      .eq('school_id', schoolId)
      .eq('grade', grade)
      .eq('class_no', classNo)
      .eq('student_no', i)
      .eq('year', targetYear) // 2026년도 데이터만 대상으로 함
      .maybeSingle();

    if (!student) {
      console.log(`>>> [${i}번] 2026년도 학생 정보가 없습니다. 스킵합니다.`);
      continue;
    }

    const maxRounds = roundSettings[i] || 1;
    console.log(`>>> [${i}번] 총 ${maxRounds}회차 날짜 재설정 중 (1회차=과거, ${maxRounds}회차=오늘)...`);

    for (let r = 1; r <= maxRounds; r++) {
      // 날짜 계산: 회차가 작을수록 과거 날짜
      // 예(5회차): r=1 -> 오늘-4일, r=2 -> 오늘-3일, r=3 -> 오늘-2일, r=4 -> 오늘-1일, r=5 -> 오늘
      const measuredDate = new Date(today);
      measuredDate.setDate(today.getDate() - (maxRounds - r));

      const dateStr = measuredDate.toISOString().split('T')[0];

      papsRecords.push({
        student_id: student.id,
        year: targetYear,
        round_no: r,
        muscular_endurance: Math.floor(Math.random() * 50) + 20,
        power: Math.floor(Math.random() * 100) + 150,
        flexibility: Math.floor(Math.random() * 30) + 5,
        cardio_endurance: Math.floor(Math.random() * 60) + 30,
        bmi: parseFloat((Math.random() * 10 + 15).toFixed(1)),
        measured_at: dateStr
      });
    }
  }

  // 4. PAPS 기록 일괄 업서트
  if (papsRecords.length > 0) {
    console.log(`>>> 총 ${papsRecords.length}개의 PAPS 기록 업서트 진행 중...`);
    const { error: papsError } = await supabase
      .from('paps_records')
      .upsert(papsRecords, { onConflict: 'student_id,year,round_no' });

    if (papsError) {
      console.error('PAPS 기록 삽입 실패:', papsError);
    } else {
      console.log('>>> 날짜 순서가 변경된 가데이터 삽입 완료!');
    }
  } else {
    console.log('>>> 삽입할 데이터가 없습니다.');
  }
}

run();
