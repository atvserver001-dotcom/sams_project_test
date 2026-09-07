import { aggregateExerciseRows, type AggregatedExerciseRow, type ExerciseMonthlyRow } from './exerciseAggregation'

export interface DashboardStudent {
  id: string
  grade: number
  class_no: number
  student_no: number
  name: string
}

export interface DashboardClass {
  grade: number
  classNo: number
  students: DashboardStudent[]
  rows: AggregatedExerciseRow[]
}

export interface DashboardLicense {
  key: string
  name: string
  kind: '콘텐츠' | '디바이스'
  start: string | null
  end: string | null
  unlimited: boolean
}

export interface DashboardData {
  school: { id: string; name: string; school_type: 1 | 2 | 3 }
  classes: DashboardClass[]
  licenses: DashboardLicense[]
}

export function buildDashboardClasses(students: DashboardStudent[], records: ExerciseMonthlyRow[]): DashboardClass[] {
  const byStudent = new Map(aggregateExerciseRows(students, records).map(row => [row.student_id, row]))
  const classes = new Map<string, DashboardClass>()
  for (const student of students) {
    const key = `${student.grade}:${student.class_no}`
    let cohort = classes.get(key)
    if (!cohort) {
      cohort = { grade: student.grade, classNo: student.class_no, students: [], rows: [] }
      classes.set(key, cohort)
    }
    cohort.students.push(student)
    cohort.rows.push(byStudent.get(student.id)!)
  }
  for (const cohort of classes.values()) {
    cohort.students.sort((a, b) => a.student_no - b.student_no)
    cohort.rows.sort((a, b) => a.student_no - b.student_no)
  }
  return [...classes.values()].sort((a, b) => a.grade - b.grade || a.classNo - b.classNo)
}
