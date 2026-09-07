import { describe, expect, it } from 'vitest'

import type { HeartRateMinutePoint as CollectedHeartRateMinutePoint } from './heartRateCollector'
import type { HeartRateSessionParticipant } from './heartRateSession'
import {
  assertHeartRateParticipantSnapshot,
  buildHeartRateParticipantIndex,
  serializeCollectedHeartRatePoints,
  splitHeartRateCheckpointPoints,
} from './heartRateSessionClient'

const participant = (studentNumber: number): HeartRateSessionParticipant => ({
  participant_id: `00000000-0000-4000-8000-${studentNumber.toString().padStart(12, '0')}`,
  student_id: null,
  student_no: studentNumber,
  name: `${studentNumber}번 학생`,
  age_years: 7,
  age_source: 'school_type_grade_proxy',
  age_policy_version: 'school_grade_age_v1',
  predicted_max_bpm: 203.1,
})

const minutePoint = (
  studentNumber: number,
  minuteIndex: number,
  revision: number,
): CollectedHeartRateMinutePoint => ({
  studentNumber,
  minuteIndex,
  bucketStartedAt: 0,
  bucketEndedAt: 60_000,
  bpmSum: 160,
  sampleCount: 2,
  averageBpm: 80,
  minBpm: 70,
  maxBpm: 90,
  isPartial: false,
  revision,
  quality: {
    rssiSampleCount: 0,
    averageRssiDbm: null,
    minRssiDbm: null,
    maxRssiDbm: null,
    batteryPercent: null,
  },
})

describe('heartRateSessionClient', () => {
  it('수집 포인트를 revision, 학생 번호, 분 번호 순서로 참여자 식별자에 연결한다', () => {
    const index = buildHeartRateParticipantIndex([participant(1), participant(2)])
    const serialized = serializeCollectedHeartRatePoints({
      2: [minutePoint(2, 2, 4), minutePoint(2, 1, 2)],
      1: [minutePoint(1, 1, 2)],
    }, index)

    expect(serialized.map((point) => [point.revision, point.participant_id, point.minute_index])).toEqual([
      [2, participant(1).participant_id, 1],
      [2, participant(2).participant_id, 1],
      [4, participant(2).participant_id, 2],
    ])
  })

  it('체크포인트는 API 상한인 60개씩 결정적으로 분할한다', () => {
    const points = Array.from({ length: 121 }, (_, index) => ({
      participant_id: participant(1).participant_id,
      minute_index: index + 1,
      revision: index + 1,
      duration_ms: 60_000,
      bpm_sum: 80,
      sample_count: 1,
      min_bpm: 80,
      max_bpm: 80,
      is_partial: index === 120,
    }))

    const chunks = splitHeartRateCheckpointPoints(points)

    expect(chunks.map((chunk) => chunk.length)).toEqual([60, 60, 1])
    expect(chunks[1][0].minute_index).toBe(61)
    expect(chunks[2][0].minute_index).toBe(121)
  })

  it('DB 참여자에 없는 학생 포인트는 조용히 누락하지 않는다', () => {
    expect(() => serializeCollectedHeartRatePoints(
      { 2: [minutePoint(2, 1, 1)] },
      buildHeartRateParticipantIndex([participant(1)]),
    )).toThrow(/2번 학생의 측정 참여자 정보를 찾을 수 없습니다/)
  })

  it('run_start 전에 화면 학생 스냅샷과 DB 참여자 스냅샷의 일치를 확인한다', () => {
    expect(() => assertHeartRateParticipantSnapshot(
      [{ id: 'student-1', student_no: 1 }],
      [{ ...participant(1), student_id: 'student-1' }],
    )).not.toThrow()
    expect(() => assertHeartRateParticipantSnapshot(
      [{ id: 'old-student', student_no: 1 }],
      [{ ...participant(1), student_id: 'new-student' }],
    )).toThrow(/학급 명단이 변경되었습니다/)
  })
})
