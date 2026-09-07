const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const studentIds = [
  '350dffd5-3256-4f7a-9b6f-0e3176fa4c7f', // 1
  'ff23232f-14cd-4a80-981b-79296e963fb1', // 2
  '077a649b-8360-48f3-ae13-cce06d9dceb1', // 3
  '0a93067a-2ed0-463b-829b-783e37e0b0de', // 4
  '020d97cb-e5f3-4c74-a454-6d0123fb0956', // 5
  '13702c82-fd7c-4143-9249-b7445e372bd3', // 6
  '6ed9b736-b4d1-4f54-b578-6ff0b4fe1792', // 7
  '2e3b622e-eae5-439f-a718-fc772240ec59', // 8
  'd303399c-335d-4fec-b1c0-3611090c0190', // 9
  '3c3bdcbb-d536-413f-8f95-f259e0dde73e'  // 10
];

const months = [3, 4, 5];
const year = 2026;

async function fillData() {
  for (const studentId of studentIds) {
    for (const month of months) {
      const muscular = 30 + Math.floor(Math.random() * 30);
      const p1 = 180 + Math.floor(Math.random() * 50);
      const p2 = p1 + Math.floor(Math.random() * 10);
      const f1 = 10 + Math.floor(Math.random() * 20);
      const f2 = f1 + Math.floor(Math.random() * 5);
      const c1 = 40 + Math.floor(Math.random() * 20);
      const c2 = 30 + Math.floor(Math.random() * 20);
      const c3 = 20 + Math.floor(Math.random() * 20);
      const bmi = 18 + Math.floor(Math.random() * 7);

      const record = {
        student_id: studentId,
        year: year,
        month: month,
        muscular_endurance: muscular,
        power_1: p1,
        power_2: p2,
        flexibility_1: f1,
        flexibility_2: f2,
        cardio_1min: c1,
        cardio_2min: c2,
        cardio_3min: c3,
        bmi: bmi
      };

      const { data, error } = await supabase
        .from('paps_records')
        .upsert(record, { onConflict: 'student_id,year,month' });

      if (error) {
        console.error(`Error for student ${studentId} month ${month}:`, error.message);
      } else {
        console.log(`Success for student ${studentId} month ${month}`);
      }
    }
  }
}

fillData();
