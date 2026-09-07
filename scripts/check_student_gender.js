const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const schoolName = '지수 초등학교_테스트';
  const { data: school } = await supabase.from('schools').select('id').eq('name', schoolName).single();

  const { data: students } = await supabase
    .from('students')
    .select('student_no, name, gender, year')
    .eq('school_id', school.id)
    .eq('grade', 1)
    .eq('class_no', 1)
    .order('student_no');

  console.log('>>> 학생 데이터 성별 확인:');
  students.forEach(s => {
    if (s.student_no <= 10) {
      console.log(`- [${s.student_no}번] ${s.name}: Gender=${s.gender}, Year=${s.year}`);
    }
  });
}

check();
