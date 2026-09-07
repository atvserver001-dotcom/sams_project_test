import type { HeartRateMinutePoint as CollectedHeartRateMinutePoint } from './heartRateCollector'
import {
  HEART_RATE_SESSION_MAX_CHECKPOINT_POINTS,
  type HeartRateMinutePoint,
  type HeartRateSessionParticipant,
  serializeHeartRateMinutePoint,
} from './heartRateSession'

export type HeartRateParticipantIdByStudentNumber = ReadonlyMap<number, string>

export interface HeartRateStudentIdentity {
  id: string
  student_no: number
}

export function buildHeartRateParticipantIndex(
  participants: readonly HeartRateSessionParticipant[],
): HeartRateParticipantIdByStudentNumber {
  const participantIds = new Map<number, string>()

  for (const participant of participants) {
    if (participantIds.has(participant.student_no)) {
      throw new Error(`${participant.student_no}번 학생의 측정 참여자 정보가 중복되었습니다.`)
    }
    participantIds.set(participant.student_no, participant.participant_id)
  }

  return participantIds
}

export function assertHeartRateParticipantSnapshot(
  students: readonly HeartRateStudentIdentity[],
  participants: readonly HeartRateSessionParticipant[],
): void {
  const studentIds = new Map(students.map((student) => [student.student_no, student.id]))
  const participantIds = buildHeartRateParticipantIndex(participants)

  if (studentIds.size !== students.length || participantIds.size !== studentIds.size) {
    throw new Error('측정 시작 중 학급 명단이 변경되었습니다. 학생 정보를 새로 불러온 뒤 다시 시작해 주세요.')
  }

  for (const participant of participants) {
    if (studentIds.get(participant.student_no) !== participant.student_id) {
      throw new Error('측정 시작 중 학급 명단이 변경되었습니다. 학생 정보를 새로 불러온 뒤 다시 시작해 주세요.')
    }
  }
}

export function serializeCollectedHeartRatePoints(
  pointsByStudentNumber: Readonly<Record<number, readonly CollectedHeartRateMinutePoint[]>>,
  participantIds: HeartRateParticipantIdByStudentNumber,
): HeartRateMinutePoint[] {
  return Object.entries(pointsByStudentNumber)
    .flatMap(([studentNumber, points]) => points.map((point) => ({
      studentNumber: Number(studentNumber),
      point,
    })))
    .sort((left, right) => (
      left.point.revision - right.point.revision
      || left.studentNumber - right.studentNumber
      || left.point.minuteIndex - right.point.minuteIndex
    ))
    .map(({ studentNumber, point }) => {
      const participantId = participantIds.get(studentNumber)
      if (!participantId) {
        throw new Error(`${studentNumber}번 학생의 측정 참여자 정보를 찾을 수 없습니다.`)
      }
      return serializeHeartRateMinutePoint(participantId, point)
    })
}

export function splitHeartRateCheckpointPoints(
  points: readonly HeartRateMinutePoint[],
): HeartRateMinutePoint[][] {
  const chunks: HeartRateMinutePoint[][] = []
  for (let index = 0; index < points.length; index += HEART_RATE_SESSION_MAX_CHECKPOINT_POINTS) {
    chunks.push(points.slice(index, index + HEART_RATE_SESSION_MAX_CHECKPOINT_POINTS))
  }
  return chunks
}
