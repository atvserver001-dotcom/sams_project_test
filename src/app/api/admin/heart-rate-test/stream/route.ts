export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { EventEmitter } from 'events'
import dgram from 'dgram'
import net from 'net'
import WebSocket from 'ws'

const PARSER_TAG = 'hr-parser-v3'

type SensorCacheEntry = {
  battery_raw?: number | null
  battery_percent?: number | null
  ble_id7?: number | null
  updatedAt: number
}

declare global {
  // eslint-disable-next-line no-var
  var __hrSensorCache: Map<string, SensorCacheEntry> | undefined
}

function getSensorCache() {
  if (!globalThis.__hrSensorCache) globalThis.__hrSensorCache = new Map()
  return globalThis.__hrSensorCache
}

function normalizeMacKey(mac?: string | null) {
  if (!mac) return null
  const cleaned = mac.replaceAll('-', ':').trim().toLowerCase()
  // 기대 형식: aa:bb:cc:dd:ee:ff
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(cleaned)) return null
  return cleaned
}

function getBleId7Cached(mac?: string | null) {
  const m = normalizeMacKey(mac)
  if (!m) return null
  const cache = getSensorCache()
  const hit = cache.get(`BLEMAC:${m}`)
  return typeof hit?.ble_id7 === 'number' ? hit.ble_id7 : null
}

function setBleId7Cached(mac?: string | null, id7?: number | null) {
  const m = normalizeMacKey(mac)
  if (!m) return
  if (typeof id7 !== 'number' || !Number.isFinite(id7)) return
  const cache = getSensorCache()
  cache.set(`BLEMAC:${m}`, { ble_id7: id7, updatedAt: Date.now() })
}

type HeartRateMessage = {
  type: 'open' | 'data' | 'error' | 'close'
  ts: string
  bpm?: number | null
  tech?: 'ANT' | 'BLE' | 'HUB'
  sensor_id?: string
  sensor_id_number?: number | null
  model?: string
  device_id?: string
  ant_id?: string
  ant_device_number?: number | null
  ant_device_id?: number | null
  ant_device_id_hex?: string
  ant_device_type?: number | null
  ble_adv_type?: number | null
  ble_device_id_hex?: string
  ble_battery?: number | null
  ble_steps?: number | null
  ble_calories?: number | null
  ble_temperature_c?: number | null
  ble_oxygen?: number | null
  battery_percent?: number | null
  battery_raw?: number | null
  rssi?: number | null
  hub_id?: number | null
  hub_mac?: string
  usb_version?: string
  cmd?: number | null
  comm_flags?: string
  msg_type?: string
  seq?: number
  raw?: string
  source?: 'listen:tcp' | 'listen:udp' | 'connect:tcp' | 'connect:ws'
  format?: 'text' | 'binary' | 'ant' | 'ble'
  bytes?: number
  message?: string
}

function u8(b: number) {
  return b & 0xff
}

function beU16(buf: Buffer, pos: number) {
  return (u8(buf[pos]) << 8) | u8(buf[pos + 1])
}

function beU32(buf: Buffer, pos: number) {
  return (u8(buf[pos]) << 24) | (u8(buf[pos + 1]) << 16) | (u8(buf[pos + 2]) << 8) | u8(buf[pos + 3])
}

function toMacWithColons(buf: Buffer) {
  // 입력: 6 bytes
  return Array.from(buf)
    .map((b) => u8(b).toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase()
}

function hubEscapeIsValid(content: Buffer) {
  // hub900.a.a.c 와 동일: 0x7D 다음 바이트는 0x01/0x02/0x03 중 하나여야 함
  for (let i = 0; i < content.length - 1; i++) {
    if (content[i] === 0x7d) {
      const n = content[i + 1]
      if (n !== 0x01 && n !== 0x02 && n !== 0x03) return false
      i += 1
    }
  }
  return true
}

function hubUnescape(content: Buffer) {
  // hub900.a.a.a 와 동일: 0x7D 01->0x7D, 0x7D 02->0x7E, 0x7D 03->0x7F
  const out: number[] = []
  for (let i = 0; i < content.length; i++) {
    const b = content[i]
    if (b === 0x7d && i + 1 < content.length) {
      const n = content[i + 1]
      if (n === 0x01) out.push(0x7d)
      else if (n === 0x02) out.push(0x7e)
      else if (n === 0x03) out.push(0x7f)
      else {
        // invalid; keep raw
        out.push(b, n)
      }
      i += 1
      continue
    }
    out.push(b)
  }
  return Buffer.from(out)
}

function hubChecksumExpected(sum: number) {
  // hub900.a.d.a(sum)와 동일:
  // nam = -sum
  // neu = nam ^ 0x3A3A
  // expected = (neu & 0xFFFF)
  const nam = -sum
  const neu = nam ^ 0x3a3a
  return neu & 0xffff
}

function hubChecksumValid(bytes: Buffer) {
  if (bytes.length < 3) return false
  const checksum = beU16(bytes, bytes.length - 2)
  let sum = 0
  for (let i = 0; i < bytes.length - 2; i++) sum += u8(bytes[i])
  const expected = hubChecksumExpected(sum)
  return checksum === expected
}

function parseHub900Frames(input: Buffer) {
  // 프레임: 0x7E ... 0x7F (HubManager 기준)
  const frames: Buffer[] = []
  let buf = input

  while (true) {
    const start = buf.indexOf(0x7e)
    if (start < 0) return { frames, rest: Buffer.alloc(0) }
    if (start > 0) buf = buf.subarray(start)
    const end = buf.indexOf(0x7f, 1)
    if (end < 0) return { frames, rest: Buffer.from(buf) }
    const frame = buf.subarray(0, end + 1)
    frames.push(Buffer.from(frame))
    buf = buf.subarray(end + 1)
  }
}

function parseHub900Abstract(mergeBytes: Buffer) {
  // hub900.entity.AbstractData 로직 반영 (필요한 필드만)
  if (mergeBytes.length < 20) return null
  const magic = u8(mergeBytes[0]) // 보통 0xAA
  const hubId = beU32(mergeBytes, 1)
  const packetSerial = beU16(mergeBytes, 5)
  const version = u8(mergeBytes[7])
  const packetLen = beU16(mergeBytes, 8)
  const usbVersionBytes = mergeBytes.subarray(10, 13)
  const usbVersionHex = usbVersionBytes.toString('hex')
  const macRaw = mergeBytes.subarray(13, 19)
  const macReversed = Buffer.from(Array.from(macRaw).reverse())
  const hubMac = toMacWithColons(macReversed)
  const cmd = u8(mergeBytes[19])
  return { magic, hubId, packetSerial, version, packetLen, usbVersionHex, hubMac, cmd }
}

function parseHub900AntHeartRate(mergeBytes: Buffer, antPacket15: Buffer) {
  // hub900.entity.AntHeartRateData를 Node에서 재현
  if (antPacket15.length < 15) return null
  const deviceType = u8(antPacket15[0]) // 0x78(120)

  // deviceId 계산
  const devi = beU16(antPacket15, 0) // bytes[0..1]
  const deviceID = antPacket15.subarray(2, 6) // 4 bytes
  const deviceIDIF = (u8(antPacket15[1]) >> 4) & 0x0f
  let deviceIdNum: number | null = null
  if (devi === 0 || devi === 0xabcd) {
    if (deviceIDIF !== 0) {
      // deviceIDByte = { hexNibble(deviceIDIF), deviceID[2], deviceID[3] } as 24-bit big-endian
      const first = deviceIDIF & 0xff
      const b1 = u8(deviceID[2])
      const b2 = u8(deviceID[3])
      deviceIdNum = (first << 16) | (b1 << 8) | b2
    }
  } else {
    // d.b(deviceID): big-endian 32-bit
    deviceIdNum = (u8(deviceID[0]) << 24) | (u8(deviceID[1]) << 16) | (u8(deviceID[2]) << 8) | u8(deviceID[3])
  }

  let batteryRaw: number | null = null
  if (u8(antPacket15[6]) === 7) batteryRaw = u8(antPacket15[7])
  const heartRate = u8(antPacket15[13])
  const rssi = (u8(antPacket15[antPacket15.length - 1]) - 256) // signed

  const abs = parseHub900Abstract(mergeBytes)
  return {
    hubId: abs?.hubId ?? null,
    hubMac: abs?.hubMac,
    cmd: abs?.cmd ?? null,
    usbVersionHex: abs?.usbVersionHex,
    deviceType,
    antDeviceId: deviceIdNum,
    antDeviceIdHex: deviceIdNum == null ? undefined : deviceIdNum.toString(16),
    heartRate,
    batteryRaw,
    rssi,
  }
}

// function safeHexToU32(hex: string) {
//   const n = parseInt(hex, 16)
//   if (!Number.isFinite(n)) return null
//   // 32bit unsigned
//   return n >>> 0
// }

// function macHexToDecimalString(macHex: string) {
//   // macHex: 12 hex chars (48-bit). 10진 문자열로 반환.
//   try {
//     if (!macHex) return null
//     const cleaned = macHex.replaceAll(':', '').replaceAll('-', '').trim()
//     // 48bit(12 hex)까지만 안전 정수 범위 내에서 처리
//     if (!/^[0-9a-fA-F]{1,12}$/.test(cleaned)) return null
//     const n = parseInt(cleaned, 16)
//     if (!Number.isFinite(n)) return null
//     return String(n)
//   } catch {
//     return null
//   }
// }

function macToId7(mac: string) {
  // BLE MAC(48bit)에서 "7자리 센서ID"로 보이는 값을 만들기 위한 보수적 매핑
  // - hub900의 ANT 쪽 deviceId도 3바이트(24bit) 조합을 쓰는 패턴이 있어,
  //   BLE에서도 MAC 하위 24bit를 센서 식별에 사용하도록 매핑.
  // - 7자리(0..9,999,999)로 맞추기 위해 mod 10,000,000 적용.
  try {
    const cleaned = mac.replaceAll(':', '').replaceAll('-', '').trim()
    if (!/^[0-9a-fA-F]{12}$/.test(cleaned)) return null
    // 하위 24bit는 마지막 6 hex
    const low24 = parseInt(cleaned.slice(6), 16) // <= 16,777,215
    if (!Number.isFinite(low24)) return null
    const id7 = low24 % 10_000_000
    return id7
  } catch {
    return null
  }
}

function batteryPercentFromRaw(raw: number | null | undefined) {
  if (raw == null) return null
  const v = Math.max(0, Math.min(255, raw))
  if (v <= 100) return v
  return Math.round((v / 255) * 100)
}

// function reverseHexBytes(hex: string) {
//   const cleaned = hex.trim().toLowerCase()
//   const pairs = cleaned.match(/.{1,2}/g)
//   if (!pairs) return null
//   return pairs.reverse().join('')
// }

function bleDeviceIdToId7(hex8: string) {
  // hub900.a.b.e(bytes,pos,len)는 big-endian으로 읽음.
  // 따라서 BLE deviceId(4바이트)도 big-endian으로 해석해야 함.
  // - 그대로 0..9,999,999(7자리)면 그대로 사용
  // - 아니면 하위 24bit를 7자리 범위로 매핑
  const cleaned = hex8.replaceAll(':', '').replaceAll('-', '').trim()
  if (!/^[0-9a-fA-F]{8}$/.test(cleaned)) return null

  const be = (parseInt(cleaned, 16) >>> 0)
  if (be >= 0 && be <= 9_999_999) return be
  const low24 = be & 0xFFFFFF
  return low24 % 10_000_000
}

function beU24(buf: Buffer, pos: number) {
  return (u8(buf[pos]) << 16) | (u8(buf[pos + 1]) << 8) | u8(buf[pos + 2])
}

function parseHub900BleHeartRate(mergeBytes: Buffer, blePacket: Buffer) {
  // hub900.HubManager.buildBlePacket + hub900.entity.BleHeartRateData 기반
  // data[0]=bleLen, data[5]=advType
  if (blePacket.length < 12) return null
  const bleLen = u8(blePacket[0])
  if (bleLen <= 10) return null

  const advType = u8(blePacket[5])
  const abs = parseHub900Abstract(mergeBytes)

  const parseBleAdvNameAndId7 = () => {
    // blePacket[1..advBytesLen] 구간은 BLE advertisement bytes (AD structures)
    // AD 구조: [len][type][data...], len은 type+data 길이
    const advBytesLen = bleLen - 7
    if (advBytesLen <= 0) return { name: null as string | null, id7: null as number | null }
    const advEnd = Math.min(advBytesLen, blePacket.length - 1)
    let i = 1
    let bestName: string | null = null
    while (i <= advEnd) {
      const l = u8(blePacket[i])
      if (l === 0) break
      const start = i + 1
      const end = i + 1 + l
      if (end > blePacket.length) break
      const type = u8(blePacket[start])
      // 0x09: Complete Local Name, 0x08: Shortened Local Name
      if (type === 0x09 || type === 0x08) {
        const nameBytes = blePacket.subarray(start + 1, end)
        const s = nameBytes.toString('ascii').replace(/\0/g, '').trim()
        if (s) {
          // Complete name(0x09)를 우선
          if (type === 0x09) {
            bestName = s
            break
          }
          if (!bestName) bestName = s
        }
      }
      i = end
    }
    if (!bestName) return { name: null, id7: null }
    // 예: "CL831-0202542" -> 202542(표시 시 padStart로 0202542)
    const m = bestName.match(/CL831-(\d{7})/i) ?? bestName.match(/CL831-(\d{6,7})/i)
    if (!m) return { name: bestName, id7: null }
    const digits = m[1]
    const n = Number(digits)
    if (!Number.isFinite(n)) return { name: bestName, id7: null }
    return { name: bestName, id7: n }
  }

  const parseBleMacAndRssi = () => {
    // hub900.entity.BleBroadcastData 기준
    const advBytesLen = bleLen - 7
    if (advBytesLen <= 0) return { bleMac: null as string | null, rssi: null as number | null }
    const rssiIdx = advBytesLen + 1
    const macStart = advBytesLen + 2
    if (blePacket.length < macStart + 6) return { bleMac: null, rssi: null }
    const macBytes = blePacket.subarray(macStart, macStart + 6)
    const bleMac = toMacWithColons(macBytes)
    const rssi = (u8(blePacket[rssiIdx]) - 256)
    return { bleMac, rssi }
  }

  const macInfo = parseBleMacAndRssi()
  const advInfo = parseBleAdvNameAndId7()

  // 케이스 1) advType 161/162
  if (advType === 161 || advType === 162) {
    const deviceIdHex = blePacket.subarray(6, 10).toString('hex')
    const hr = u8(blePacket[10])
    const bat = u8(blePacket[11])
    const steps = blePacket.length >= 15 ? beU24(blePacket, 12) : null
    const calories = blePacket.length >= 18 ? Math.round((beU24(blePacket, 15) / 10) * 10) / 10 : null
    const tempC = advType === 162 && blePacket.length >= 20 ? Math.round((beU16(blePacket, 18) / 10) * 10) / 10 : null
    const oxygen = advType === 162 && blePacket.length > 21 ? u8(blePacket[20]) : null

    return {
      hubId: abs?.hubId ?? null,
      hubMac: abs?.hubMac,
      cmd: abs?.cmd ?? null,
      usbVersionHex: abs?.usbVersionHex,
      advType,
      deviceIdHex,
      hr,
      bat,
      steps,
      calories,
      tempC,
      oxygen,
      bleMac: macInfo.bleMac,
      rssi: macInfo.rssi,
      bleName: advInfo.name,
      bleNameId7: advInfo.id7,
    }
  }

  // 케이스 2) HubManager default 분기에서 HR로 처리되는 특수 케이스
  // if (data[6] == 13 && data[7] == 24) ... battery=data[13], hr=data[15]
  if (blePacket.length >= 16 && u8(blePacket[6]) === 13 && u8(blePacket[7]) === 24) {
    const bat = blePacket.length >= 14 ? u8(blePacket[13]) : null
    const hr = u8(blePacket[15])
    // 이 케이스는 deviceId가 명확하지 않아 MAC 기반으로 식별
    const deviceIdHex = macInfo.bleMac ? macInfo.bleMac.replaceAll(':', '').toLowerCase() : ''
    return {
      hubId: abs?.hubId ?? null,
      hubMac: abs?.hubMac,
      cmd: abs?.cmd ?? null,
      usbVersionHex: abs?.usbVersionHex,
      advType,
      deviceIdHex,
      hr,
      bat,
      steps: null,
      calories: null,
      tempC: null,
      oxygen: null,
      bleMac: macInfo.bleMac,
      rssi: macInfo.rssi,
      bleName: advInfo.name,
      bleNameId7: advInfo.id7,
    }
  }

  return null
}

function parseBpmFromText(text: string): number | null {
  // 1) JSON 우선
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = JSON.parse(trimmed) as any
      const candidates = [
        obj?.bpm,
        obj?.heart_rate,
        obj?.hr,
        obj?.heartrate,
        obj?.HeartRate,
        obj?.HR,
      ]
      for (const c of candidates) {
        const n = typeof c === 'string' ? Number(c) : c
        if (Number.isFinite(n) && n >= 30 && n <= 240) return Math.round(n)
      }
    } catch {
      // ignore
    }
  }

  // 2) 숫자 패턴(예: "HR=72", "72", "bpm: 120")
  const m = trimmed.match(/\b(\d{2,3})\b/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  if (n < 30 || n > 240) return null
  return n
}

function hexPreview(buf: Buffer, maxBytes = 64) {
  const slice = buf.subarray(0, Math.min(maxBytes, buf.length))
  const hex = slice.toString('hex').match(/.{1,2}/g)?.join(' ') ?? ''
  return buf.length > maxBytes ? `${hex} … (+${buf.length - maxBytes}B)` : hex
}

function tryDecodeUtf8(buf: Buffer): string | null {
  // 바이너리를 억지로 UTF-8로 해석하면 "깨진 문자"가 보이므로
  // 1) 제어문자 비율이 높으면 즉시 바이너리로 판정
  // 2) fatal decode로 "진짜 UTF-8 텍스트"일 때만 텍스트로 취급
  if (buf.length === 0) return ''

  const n = Math.min(buf.length, 512)
  let badCtrl = 0
  for (let i = 0; i < n; i++) {
    const b = buf[i]
    const isAllowed = b === 9 || b === 10 || b === 13 // \t \n \r
    const isBad = (b < 32 && !isAllowed) || b === 127
    if (isBad) badCtrl++
  }
  // 제어문자가 1% 이상이면 거의 확실히 바이너리
  if (badCtrl / n >= 0.01) return null

  try {
    const dec = new TextDecoder('utf-8', { fatal: true })
    const s = dec.decode(buf)
    // NULL 포함 시 바이너리 취급
    if (s.includes('\u0000')) return null
    // UTF-8로 디코딩이 되더라도, 실제로는 바이너리/프레이밍 데이터일 수 있음.
    // 운영에서 기대하는 텍스트는 거의 ASCII이므로, ASCII 가독 문자만 허용.
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      const isAllowedWs = c === 9 || c === 10 || c === 13 // \t \n \r
      const isPrintableAscii = c >= 32 && c <= 126
      if (!isAllowedWs && !isPrintableAscii) return null
    }
    return s
  } catch {
    return null
  }
}

function parseHdlcFrames(input: Buffer) {
  // PPP/HDLC 스타일: 0x7E flag, 0x7D escape (next ^ 0x20)
  const frames: Buffer[] = []
  const FLAG = 0x7e
  const ESC = 0x7d

  const firstFlag = input.indexOf(FLAG)
  if (firstFlag < 0) return { frames, rest: input }

  // 마지막 flag를 찾고, 그 이후는 미완성 프레임으로 남김
  const lastFlag = input.lastIndexOf(FLAG)
  if (lastFlag === firstFlag) return { frames, rest: input.subarray(firstFlag) }

  let i = firstFlag + 1
  while (i < lastFlag) {
    const nextFlag = input.indexOf(FLAG, i)
    if (nextFlag < 0 || nextFlag > lastFlag) break
    const payload = input.subarray(i, nextFlag)
    if (payload.length > 0) {
      const out: number[] = []
      for (let j = 0; j < payload.length; j++) {
        const b = payload[j]
        if (b === ESC && j + 1 < payload.length) {
          out.push(payload[j + 1] ^ 0x20)
          j += 1
          continue
        }
        out.push(b)
      }
      frames.push(Buffer.from(out))
    }
    i = nextFlag + 1
  }

  const rest = input.subarray(lastFlag) // 마지막 flag부터 끝까지(다음 프레임 시작 포함)
  return { frames, rest }
}

type BpmGuess = { bpm: number | null; offset: number | null; note: string }

class BpmGuesser {
  private stats: Array<{
    inRange: number
    changes: number
    step1: number
    last: number | null
    sum: number
    sumsq: number
  }> = []

  private bestOffset: number | null = null

  update(frame: Buffer): BpmGuess {
    const len = frame.length
    if (this.stats.length < len) {
      for (let i = this.stats.length; i < len; i++) {
        this.stats.push({ inRange: 0, changes: 0, step1: 0, last: null, sum: 0, sumsq: 0 })
      }
    }

    for (let i = 0; i < len; i++) {
      const v = frame[i]
      const s = this.stats[i]
      if (v >= 30 && v <= 240) {
        s.inRange += 1
        s.sum += v
        s.sumsq += v * v
        if (s.last != null) {
          if (s.last !== v) s.changes += 1
          if (Math.abs(s.last - v) === 1) s.step1 += 1
        }
        s.last = v
      }
    }

    this.bestOffset = this.chooseBest()
    if (this.bestOffset == null) return { bpm: null, offset: null, note: 'no_candidate' }

    const bpm = frame[this.bestOffset]
    if (bpm < 30 || bpm > 240) return { bpm: null, offset: this.bestOffset, note: 'out_of_range' }
    return { bpm, offset: this.bestOffset, note: 'auto' }
  }

  private chooseBest() {
    let best: { idx: number; score: number } | null = null
    for (let i = 0; i < this.stats.length; i++) {
      const s = this.stats[i]
      if (s.inRange < 8) continue

      const mean = s.sum / s.inRange
      const varRaw = s.sumsq / s.inRange - mean * mean
      const std = Math.sqrt(Math.max(0, varRaw))

      const changeRate = s.changes / Math.max(1, s.inRange - 1)
      const step1Rate = s.step1 / Math.max(1, s.inRange - 1)

      let score = 0
      score += s.inRange * 2

      if (changeRate === 0) score -= 5
      if (changeRate > 0.8) score -= 10
      else score += Math.round(10 * (0.5 - Math.abs(changeRate - 0.3)))

      score -= Math.round(step1Rate * 25)
      if (std > 30) score -= Math.round((std - 30) * 2)

      if (mean < 40) score -= 4
      if (mean > 210) score -= 4

      if (!best || score > best.score) best = { idx: i, score }
    }
    return best?.idx ?? null
  }
}

function decodeCl831Frame(frame: Buffer): {
  model: 'CL831-0412709'
  device_id: string
  ant_id: string
  ant_device_number: number | null
  msg_type: string
  seq: number
  comm_flags: string
  battery_percent: number | null
  bpm: number | null
} | null {
  // 관측된 프레임 예시:
  // len=41, prefix: aa 00 00 ad f3, tail: 7f
  if (frame.length < 20) return null
  if (frame[0] !== 0xaa) return null
  if (frame[1] !== 0x00 || frame[2] !== 0x00) return null
  if (frame[3] !== 0xad || frame[4] !== 0xf3) return null

  const msgType = frame[5]
  const seq = frame[6]

  // 디바이스 식별자로 보이는 6바이트 (샘플에서 고정)
  const deviceId = frame.length >= 19 ? frame.subarray(13, 19).toString('hex') : ''

  // 주신 로그 패턴 기준:
  // - 33..34(2바이트)가 기기 구분에 쓰이는 값으로 보임 (예: 2482, 04c2, 3dee, 7bf0)
  //   → 이를 ANT 센서 ID로 취급
  // - 31..32는 보조 플래그/상태값으로 별도 보관
  const antIdBuf = frame.length >= 35 ? frame.subarray(33, 35) : null
  const antId = antIdBuf ? antIdBuf.toString('hex') : ''
  // 보통 ANT device number는 16-bit이므로 숫자도 함께 노출(엔디안은 추후 확정)
  const antDeviceNumber = antIdBuf ? (antIdBuf[0] | (antIdBuf[1] << 8)) : null

  const commFlags = frame.length >= 33 ? frame.subarray(31, 33).toString('hex') : ''

  // battery/bpm은 “데이터 프레임(len=41, msgType=0x1b)”에서만 확정적으로 추정
  let battery: number | null = null
  let bpm: number | null = null

  if (frame.length === 41 && msgType === 0x1b) {
    const b = frame[35] // 샘플에서 0x3b/0x3c 등 (59~60)로 관측
    if (b <= 100) battery = b
    else battery = Math.round((b / 255) * 100)

    const hr = frame[36] // 샘플에서 0x61=97 관측
    if (hr >= 30 && hr <= 240 && hr !== 0x7f) bpm = hr
  }

  return {
    model: 'CL831-0412709',
    device_id: deviceId,
    ant_id: antId,
    ant_device_number: antDeviceNumber,
    msg_type: `0x${msgType.toString(16).padStart(2, '0')}`,
    seq,
    comm_flags: commFlags,
    battery_percent: battery,
    bpm,
  }
}

// ANT Serial framing: 0xA4 | LEN | MSG_ID | DATA... | CHK (XOR of LEN..DATA)
function parseAntFrames(input: Buffer) {
  let buf = input
  const frames: Array<{ msgId: number; data: Buffer; raw: Buffer }> = []

  while (buf.length >= 4) {
    const syncIdx = buf.indexOf(0xa4)
    if (syncIdx < 0) return { frames, rest: Buffer.alloc(0) }
    if (syncIdx > 0) buf = buf.subarray(syncIdx)
    if (buf.length < 4) break

    const len = buf[1]
    const total = 4 + len
    if (buf.length < total) break

    const msgId = buf[2]
    const data = buf.subarray(3, 3 + len)
    const chk = buf[3 + len]

    let x = 0
    for (let i = 1; i < 3 + len; i++) x ^= buf[i]
    if ((x & 0xff) === chk) {
      frames.push({ msgId, data: Buffer.from(data), raw: Buffer.from(buf.subarray(0, total)) })
      buf = buf.subarray(total)
      continue
    }

    buf = buf.subarray(1)
  }

  return { frames, rest: Buffer.from(buf) }
}

function extractHrFromAntFrame(msgId: number, data: Buffer): number | null {
  // Broadcast Data(0x4E) / Acknowledged Data(0x4F):
  // len=9, data[0]=channel, data[1..8]=payload8. HRM profile HR is payload[7] (= data[8]).
  if (msgId === 0x4e || msgId === 0x4f) {
    if (data.length >= 9) {
      const hr = data[8]
      if (hr >= 30 && hr <= 240) return hr
    }
  }
  return null
}

type HubBridge = {
  host: string
  port: number
  udpSocket: dgram.Socket
  tcpServer: net.Server
  emitter: EventEmitter
  startedAt: string
  udpPackets: number
  tcpConnections: number
  close: () => Promise<void>
}

declare global {
  // eslint-disable-next-line no-var
  var __hrHubBridge: HubBridge | undefined
}

async function ensureBridge(host: string, port: number): Promise<HubBridge> {
  const existing = globalThis.__hrHubBridge
  if (existing && existing.host === host && existing.port === port) return existing

  if (existing) {
    await existing.close().catch(() => undefined)
    globalThis.__hrHubBridge = undefined
  }

  const emitter = new EventEmitter()
  emitter.setMaxListeners(0)

  const startedAt = new Date().toISOString()
  const udpSocket = dgram.createSocket('udp4')
  const tcpServer = net.createServer((socket) => {
    bridge.tcpConnections += 1

    let buf = Buffer.alloc(0)
    const guesser = new BpmGuesser()
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])

      // 0) Hub900 framing: 0x7E ... 0x7F (escape: 0x7D 01/02/03)
      if (buf.includes(0x7e) && buf.includes(0x7f)) {
        const parsed = parseHub900Frames(buf)
        buf = Buffer.from(parsed.rest.subarray(Math.max(0, parsed.rest.length - 8192)))

        for (const rawFrame of parsed.frames) {
          // strip 7E/7F
          const content = rawFrame.subarray(1, rawFrame.length - 1)
          if (!hubEscapeIsValid(content)) {
            emitter.emit('msg', {
              type: 'data',
              ts: new Date().toISOString(),
              bpm: null,
              raw: `[${PARSER_TAG} hub900 invalid-escape ${rawFrame.length}B] ${hexPreview(rawFrame)}`,
              source: 'listen:tcp',
              format: 'binary',
              bytes: rawFrame.length,
            } satisfies HeartRateMessage)
            continue
          }

          const mergeBytes = hubUnescape(content)
          const abs = parseHub900Abstract(mergeBytes)
          if (!hubChecksumValid(mergeBytes)) {
            emitter.emit('msg', {
              type: 'data',
              ts: new Date().toISOString(),
              bpm: null,
              hub_id: abs?.hubId ?? null,
              hub_mac: abs?.hubMac,
              usb_version: abs?.usbVersionHex,
              cmd: abs?.cmd ?? null,
              raw: `[${PARSER_TAG} hub900 bad-checksum ${mergeBytes.length}B] ${hexPreview(mergeBytes)}`,
              source: 'listen:tcp',
              format: 'binary',
              bytes: mergeBytes.length,
            } satisfies HeartRateMessage)
            continue
          }

          // cmd=1(ANT): TLV from index 20 to len-2
          const cmd = abs?.cmd ?? null
          if (cmd === 1) {
            const app = mergeBytes.subarray(20, mergeBytes.length - 2)
            let pos = 0
            while (pos + 3 <= app.length) {
              const key = u8(app[pos])
              const len = (u8(app[pos + 1]) << 8) | u8(app[pos + 2])
              const start = pos + 3
              const end = start + len
              if (end > app.length) break
              const payload = app.subarray(start, end)

              if (key === 1) {
                // ANT packets are 15B chunks
                for (let i = 0; i + 15 <= payload.length; i += 15) {
                  const pkt = payload.subarray(i, i + 15)
                  if (u8(pkt[0]) === 0x78) {
                    const hr = parseHub900AntHeartRate(mergeBytes, pkt)
                    if (hr) {
                      const cache = getSensorCache()
                      const cacheKey = hr.antDeviceId == null ? null : `ANT:${hr.antDeviceId}`
                      const incomingBatPct = batteryPercentFromRaw(hr.batteryRaw)
                      if (cacheKey && hr.batteryRaw != null) {
                        cache.set(cacheKey, { battery_raw: hr.batteryRaw, battery_percent: incomingBatPct, updatedAt: Date.now() })
                      }
                      const cached = cacheKey ? cache.get(cacheKey) : undefined
                      const batteryRaw = hr.batteryRaw ?? cached?.battery_raw ?? null
                      const batPct = (incomingBatPct ?? cached?.battery_percent ?? batteryPercentFromRaw(batteryRaw))
                      emitter.emit('msg', {
                        type: 'data',
                        ts: new Date().toISOString(),
                        tech: 'ANT',
                        sensor_id: hr.antDeviceId == null ? undefined : String(hr.antDeviceId),
                        sensor_id_number: hr.antDeviceId == null ? null : hr.antDeviceId,
                        bpm: hr.heartRate,
                        model: 'CL831-0412709',
                        device_id: hr.hubMac ? hr.hubMac.replaceAll(':', '').toLowerCase() : undefined,
                        ant_id: hr.antDeviceIdHex,
                        ant_device_id: hr.antDeviceId,
                        ant_device_id_hex: hr.antDeviceIdHex,
                        ant_device_type: hr.deviceType,
                        battery_percent: batPct,
                        battery_raw: batteryRaw,
                        rssi: hr.rssi,
                        hub_id: hr.hubId,
                        hub_mac: hr.hubMac,
                        usb_version: hr.usbVersionHex,
                        cmd: hr.cmd,
                        raw: `[${PARSER_TAG} hub900 ant-hr] hub=${hr.hubMac} ant=${hr.antDeviceIdHex ?? '-'} hr=${hr.heartRate} bat=${hr.batteryRaw ?? '-'} rssi=${hr.rssi}`,
                        source: 'listen:tcp',
                        format: 'ant',
                        bytes: pkt.length,
                      } satisfies HeartRateMessage)
                    }
                  }
                }
              }

              pos = end
            }
            continue
          }

          // cmd=2(BLE): TLV, key==1 payload는 [lenByte + data...] 반복
          if (cmd === 2) {
            const app = mergeBytes.subarray(20, mergeBytes.length - 2)
            let pos = 0
            while (pos + 3 <= app.length) {
              const key = u8(app[pos])
              const len = (u8(app[pos + 1]) << 8) | u8(app[pos + 2])
              const start = pos + 3
              const end = start + len
              if (end > app.length) break
              const payload = app.subarray(start, end)

              if (key === 1) {
                let p = 0
                while (p < payload.length) {
                  const bytesLen = u8(payload[p]) + 1
                  if (p + bytesLen > payload.length) break
                  const pkt = payload.subarray(p, p + bytesLen)
                  p += bytesLen

                  const ble = parseHub900BleHeartRate(mergeBytes, pkt)
                  if (ble && ble.hr >= 30 && ble.hr <= 240) {
                    const batPct = batteryPercentFromRaw(ble.bat)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const mac = (ble as any).bleMac as string | undefined
                    const sensor7FromMac = mac ? macToId7(mac) : (ble.deviceIdHex && ble.deviceIdHex.length === 12 ? macToId7(ble.deviceIdHex) : null)
                    const sensor7FromDev = (ble.deviceIdHex && ble.deviceIdHex.length === 8) ? bleDeviceIdToId7(ble.deviceIdHex) : null
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const sensor7FromName = (ble as any).bleNameId7 as number | null | undefined
                    // 같은 센서가 adv=161/162(정식)과 adv=3(0x180D)로 섞여 들어오므로
                    // 1) adv=161/162에서 얻은 deviceId 기반 7자리 ID를 MAC 기준으로 캐시
                    // 2) deviceId가 없는 패킷에서는 캐시된 값을 우선 사용
                    if (ble.advType === 161 || ble.advType === 162) {
                      setBleId7Cached(mac ?? null, sensor7FromDev)
                    }
                    const cached7 = getBleId7Cached(mac ?? null)

                    // 스티커 7자리(예: 0202542, 0412709)는 "앞에 0이 붙는" 케이스가 많아 숫자값이 작은 편(1,000,000 미만)인 후보를 우선 선택
                    const pickStickerLike = (a: number | null, b: number | null) => {
                      const isSmall = (n: number | null) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1_000_000
                      if (isSmall(a) && !isSmall(b)) return a
                      if (isSmall(b) && !isSmall(a)) return b
                      return a ?? b
                    }
                    const chosen7 = (typeof sensor7FromName === 'number' && Number.isFinite(sensor7FromName)) ? sensor7FromName : (cached7 ?? pickStickerLike(sensor7FromDev, sensor7FromMac))
                    // 이름에서 7자리를 얻었으면 이것이 "스티커 ID"이므로 캐시도 갱신
                    if (ble.bleNameId7 != null) {
                      setBleId7Cached(mac ?? null, sensor7FromName ?? null)
                    }
                    emitter.emit('msg', {
                      type: 'data',
                      ts: new Date().toISOString(),
                      tech: 'BLE',
                      sensor_id: chosen7 == null ? undefined : String(chosen7),
                      sensor_id_number: chosen7,
                      bpm: ble.hr,
                      model: 'CL831-0412709',
                      hub_id: ble.hubId,
                      hub_mac: ble.hubMac,
                      usb_version: ble.usbVersionHex,
                      cmd: ble.cmd,
                      ble_adv_type: ble.advType,
                      ble_device_id_hex: ble.deviceIdHex,
                      ble_battery: ble.bat,
                      ble_steps: ble.steps,
                      ble_calories: ble.calories,
                      ble_temperature_c: ble.tempC,
                      ble_oxygen: ble.oxygen,
                      battery_percent: batPct,
                      battery_raw: ble.bat,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      rssi: (ble as any).rssi ?? null,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      raw: `[${PARSER_TAG} hub900 ble-hr] mac=${mac ?? '-'} adv=${ble.advType} name=${(ble as any).bleName ?? '-'} id7_name=${(ble as any).bleNameId7 ?? '-'} devId=${ble.deviceIdHex || '-'} id7_mac=${sensor7FromName ?? '-'} id7_dev=${sensor7FromDev ?? '-'} id7_cache=${cached7 ?? '-'} chosen=${chosen7 ?? '-'} hr=${ble.hr} bat=${ble.bat ?? '-'} | pkt(${pkt.length}) ${hexPreview(pkt, 160)} | merge(${mergeBytes.length}) ${hexPreview(mergeBytes, 160)}`,
                      source: 'listen:tcp',
                      format: 'ble',
                      bytes: pkt.length,
                    } satisfies HeartRateMessage)
                  }
                }
              }

              pos = end
            }
            continue
          }

          // fallback: still show decoded frame
          emitter.emit('msg', {
            type: 'data',
            ts: new Date().toISOString(),
            bpm: null,
            hub_id: abs?.hubId ?? null,
            hub_mac: abs?.hubMac,
            usb_version: abs?.usbVersionHex,
            cmd: abs?.cmd ?? null,
            raw: `[${PARSER_TAG} hub900 cmd=${cmd ?? '-'} ${mergeBytes.length}B] ${hexPreview(mergeBytes)}`,
            source: 'listen:tcp',
            format: 'binary',
            bytes: mergeBytes.length,
          } satisfies HeartRateMessage)
        }
        return
      }

      // 0) HDLC/PPP 프레이밍(0x7E/0x7D) 감지되면 프레임 단위로 분리
      if (buf.includes(0x7e)) {
        const h = parseHdlcFrames(buf)
        buf = Buffer.from(h.rest.subarray(Math.max(0, h.rest.length - 4096)))

        for (const frame of h.frames) {
          const cl = decodeCl831Frame(frame)
          const guess = cl?.bpm == null ? guesser.update(frame) : { bpm: cl.bpm, offset: 36, note: 'cl831' }
          // 프레임 안에 ANT 프레임이 있는지 먼저 시도
          const antIn = parseAntFrames(frame)
          if (antIn.frames.length > 0) {
            for (const f of antIn.frames) {
              const bpm = extractHrFromAntFrame(f.msgId, f.data)
              emitter.emit('msg', {
                type: 'data',
                ts: new Date().toISOString(),
                bpm,
                raw: `[${PARSER_TAG}] ANT msg=0x${f.msgId.toString(16).padStart(2, '0')} data=${f.data.toString('hex')}`,
                source: 'listen:tcp',
                format: 'ant',
                bytes: f.raw.length,
              } satisfies HeartRateMessage)
            }
          } else {
            emitter.emit('msg', {
              type: 'data',
              ts: new Date().toISOString(),
              bpm: guess.bpm,
              model: cl?.model,
              device_id: cl?.device_id,
              ant_id: cl?.ant_id,
              ant_device_number: cl?.ant_device_number ?? null,
              battery_percent: cl?.battery_percent ?? null,
              comm_flags: cl?.comm_flags,
              msg_type: cl?.msg_type,
              seq: cl?.seq,
              raw: `[${PARSER_TAG} hdlc ${frame.length}B] ${hexPreview(frame)} | bpm=${guess.bpm ?? '-'} (off=${guess.offset ?? '-'})${cl ? ` | model=${cl.model} dev=${cl.device_id} ant=${cl.ant_id} bat=${cl.battery_percent ?? '-'} flags=${cl.comm_flags} type=${cl.msg_type} seq=${cl.seq}` : ''}`,
              source: 'listen:tcp',
              format: 'binary',
              bytes: frame.length,
            } satisfies HeartRateMessage)
          }
        }
        return
      }

      // 1) ANT 프레이밍 시도
      const ant = parseAntFrames(buf)
      buf = ant.rest
      if (ant.frames.length > 0) {
        for (const f of ant.frames) {
          const bpm = extractHrFromAntFrame(f.msgId, f.data)
          emitter.emit('msg', {
            type: 'data',
            ts: new Date().toISOString(),
            bpm,
            raw: `[${PARSER_TAG}] ANT msg=0x${f.msgId.toString(16).padStart(2, '0')} data=${f.data.toString('hex')}`,
            source: 'listen:tcp',
            format: 'ant',
            bytes: f.raw.length,
          } satisfies HeartRateMessage)
        }
        return
      }

      // 2) 텍스트(라인) 포맷이면 기존처럼 파싱
      const decoded = tryDecodeUtf8(buf)
      if (decoded != null) {
        const text = decoded
        const parts = text.split(/\r?\n/)
        const tail = parts.pop() ?? ''
        buf = Buffer.from(tail, 'utf8')
        for (const line of parts) {
          const raw = line.trim()
          if (!raw) continue
          const bpm = parseBpmFromText(raw)
          emitter.emit('msg', {
            type: 'data',
            ts: new Date().toISOString(),
            bpm,
            raw,
            source: 'listen:tcp',
            format: 'text',
            bytes: Buffer.byteLength(raw, 'utf8'),
          } satisfies HeartRateMessage)
        }
        return
      }

      // 3) 바이너리: 깨지지 않게 HEX로 프리뷰
      emitter.emit('msg', {
        type: 'data',
        ts: new Date().toISOString(),
        bpm: null,
        raw: `[${PARSER_TAG} binary ${buf.length}B] ${hexPreview(buf)}`,
        source: 'listen:tcp',
        format: 'binary',
        bytes: buf.length,
      } satisfies HeartRateMessage)

      // keep a tail in case frame spans chunks
      buf = buf.subarray(Math.max(0, buf.length - 4096))
    })

    socket.on('error', (err) => {
      emitter.emit('msg', {
        type: 'error',
        ts: new Date().toISOString(),
        message: err?.message || 'TCP 소켓 오류',
      } satisfies HeartRateMessage)
    })

    socket.on('close', () => {
      bridge.tcpConnections = Math.max(0, bridge.tcpConnections - 1)
    })
  })

  const bridge: HubBridge = {
    host,
    port,
    udpSocket,
    tcpServer,
    emitter,
    startedAt,
    udpPackets: 0,
    tcpConnections: 0,
    close: () =>
      new Promise<void>((resolve) => {
        let pending = 2
        const done = () => {
          pending -= 1
          if (pending <= 0) resolve()
        }

        try {
          tcpServer.close(() => done())
        } catch {
          done()
        }

        try {
          udpSocket.close(() => done())
        } catch {
          done()
        }
      }),
  }

  udpSocket.on('error', (err) => {
    emitter.emit('msg', {
      type: 'error',
      ts: new Date().toISOString(),
      message: err?.message || 'UDP 소켓 오류',
    } satisfies HeartRateMessage)
  })

  udpSocket.on('message', (msg) => {
    bridge.udpPackets += 1
    const buf = Buffer.from(msg)

    const ant = parseAntFrames(buf)
    if (ant.frames.length > 0) {
      for (const f of ant.frames) {
        const bpm = extractHrFromAntFrame(f.msgId, f.data)
        emitter.emit('msg', {
          type: 'data',
          ts: new Date().toISOString(),
          bpm,
          raw: `[${PARSER_TAG}] ANT msg=0x${f.msgId.toString(16).padStart(2, '0')} data=${f.data.toString('hex')}`,
          source: 'listen:udp',
          format: 'ant',
          bytes: f.raw.length,
        } satisfies HeartRateMessage)
      }
      return
    }

    const decoded = tryDecodeUtf8(buf)
    if (decoded != null) {
      const text = decoded
      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        const raw = line.trim()
        if (!raw) continue
        const bpm = parseBpmFromText(raw)
        emitter.emit('msg', {
          type: 'data',
          ts: new Date().toISOString(),
          bpm,
          raw,
          source: 'listen:udp',
          format: 'text',
          bytes: Buffer.byteLength(raw, 'utf8'),
        } satisfies HeartRateMessage)
      }
      return
    }

    emitter.emit('msg', {
      type: 'data',
      ts: new Date().toISOString(),
      bpm: null,
      raw: `[${PARSER_TAG} binary ${buf.length}B] ${hexPreview(buf)}`,
      source: 'listen:udp',
      format: 'binary',
      bytes: buf.length,
    } satisfies HeartRateMessage)
  })

  tcpServer.on('error', (err) => {
    emitter.emit('msg', {
      type: 'error',
      ts: new Date().toISOString(),
      message: err?.message || 'TCP 서버 오류',
    } satisfies HeartRateMessage)
  })

  // TCP + UDP 둘 다 바인딩
  const tcpBind = new Promise<void>((resolve, reject) => {
    tcpServer.once('error', reject)
    tcpServer.listen(port, host, () => resolve())
  })

  const udpBind = new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onError = (e: any) => {
      udpSocket.off('listening', onListening)
      reject(e)
    }
    const onListening = () => {
      udpSocket.off('error', onError)
      resolve()
    }
    udpSocket.once('error', onError)
    udpSocket.once('listening', onListening)
    udpSocket.bind(port, host)
  })

  try {
    await Promise.all([tcpBind, udpBind])
  } catch (e) {
    await bridge.close().catch(() => undefined)
    throw e
  }

  globalThis.__hrHubBridge = bridge
  return bridge
}

async function connectToHubTcp(host: string, port: number, onMsg: (m: HeartRateMessage) => void) {
  const nowIso = () => new Date().toISOString()
  const socket = net.createConnection({ host, port })
  let buf = Buffer.alloc(0)
  const guesser = new BpmGuesser()

  socket.on('connect', () => {
    onMsg({ type: 'open', ts: nowIso(), message: `[${PARSER_TAG}] 허브 TCP 연결됨: ${host}:${port}`, source: 'connect:tcp' })
  })
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])

    // Hub900 framing 우선 처리
    if (buf.includes(0x7e) && buf.includes(0x7f)) {
      const parsed = parseHub900Frames(buf)
      buf = Buffer.from(parsed.rest.subarray(Math.max(0, parsed.rest.length - 8192)))

      for (const rawFrame of parsed.frames) {
        const content = rawFrame.subarray(1, rawFrame.length - 1)
        if (!hubEscapeIsValid(content)) {
          onMsg({
            type: 'data',
            ts: nowIso(),
            bpm: null,
            raw: `[${PARSER_TAG} hub900 invalid-escape ${rawFrame.length}B] ${hexPreview(rawFrame)}`,
            source: 'connect:tcp',
            format: 'binary',
            bytes: rawFrame.length,
          })
          continue
        }

        const mergeBytes = hubUnescape(content)
        const abs = parseHub900Abstract(mergeBytes)
        if (!hubChecksumValid(mergeBytes)) {
          onMsg({
            type: 'data',
            ts: nowIso(),
            bpm: null,
            hub_id: abs?.hubId ?? null,
            hub_mac: abs?.hubMac,
            usb_version: abs?.usbVersionHex,
            cmd: abs?.cmd ?? null,
            raw: `[${PARSER_TAG} hub900 bad-checksum ${mergeBytes.length}B] ${hexPreview(mergeBytes)}`,
            source: 'connect:tcp',
            format: 'binary',
            bytes: mergeBytes.length,
          })
          continue
        }

        const cmd = abs?.cmd ?? null
        if (cmd === 1) {
          const app = mergeBytes.subarray(20, mergeBytes.length - 2)
          let pos = 0
          while (pos + 3 <= app.length) {
            const key = u8(app[pos])
            const len = (u8(app[pos + 1]) << 8) | u8(app[pos + 2])
            const start = pos + 3
            const end = start + len
            if (end > app.length) break
            const payload = app.subarray(start, end)

            if (key === 1) {
              for (let i = 0; i + 15 <= payload.length; i += 15) {
                const pkt = payload.subarray(i, i + 15)
                if (u8(pkt[0]) === 0x78) {
                  const hr = parseHub900AntHeartRate(mergeBytes, pkt)
                  if (hr) {
                    const cache = getSensorCache()
                    const cacheKey = hr.antDeviceId == null ? null : `ANT:${hr.antDeviceId}`
                    const incomingBatPct = batteryPercentFromRaw(hr.batteryRaw)
                    if (cacheKey && hr.batteryRaw != null) {
                      cache.set(cacheKey, { battery_raw: hr.batteryRaw, battery_percent: incomingBatPct, updatedAt: Date.now() })
                    }
                    const cached = cacheKey ? cache.get(cacheKey) : undefined
                    const batteryRaw = hr.batteryRaw ?? cached?.battery_raw ?? null
                    const batPct = (incomingBatPct ?? cached?.battery_percent ?? batteryPercentFromRaw(batteryRaw))
                    onMsg({
                      type: 'data',
                      ts: nowIso(),
                      tech: 'ANT',
                      sensor_id: hr.antDeviceId == null ? undefined : String(hr.antDeviceId),
                      sensor_id_number: hr.antDeviceId == null ? null : hr.antDeviceId,
                      bpm: hr.heartRate,
                      model: 'CL831-0412709',
                      device_id: hr.hubMac ? hr.hubMac.replaceAll(':', '').toLowerCase() : undefined,
                      ant_id: hr.antDeviceIdHex,
                      ant_device_id: hr.antDeviceId,
                      ant_device_id_hex: hr.antDeviceIdHex,
                      ant_device_type: hr.deviceType,
                      battery_percent: batPct,
                      battery_raw: batteryRaw,
                      rssi: hr.rssi,
                      hub_id: hr.hubId,
                      hub_mac: hr.hubMac,
                      usb_version: hr.usbVersionHex,
                      cmd: hr.cmd,
                      raw: `[${PARSER_TAG} hub900 ant-hr] hub=${hr.hubMac} ant=${hr.antDeviceIdHex ?? '-'} hr=${hr.heartRate} bat=${hr.batteryRaw ?? '-'} rssi=${hr.rssi}`,
                      source: 'connect:tcp',
                      format: 'ant',
                      bytes: pkt.length,
                    })
                  }
                }
              }
            }

            pos = end
          }
          continue
        }

        if (cmd === 2) {
          const app = mergeBytes.subarray(20, mergeBytes.length - 2)
          let pos = 0
          while (pos + 3 <= app.length) {
            const key = u8(app[pos])
            const len = (u8(app[pos + 1]) << 8) | u8(app[pos + 2])
            const start = pos + 3
            const end = start + len
            if (end > app.length) break
            const payload = app.subarray(start, end)

            if (key === 1) {
              let p = 0
              while (p < payload.length) {
                const bytesLen = u8(payload[p]) + 1
                if (p + bytesLen > payload.length) break
                const pkt = payload.subarray(p, p + bytesLen)
                p += bytesLen

                const ble = parseHub900BleHeartRate(mergeBytes, pkt)
                if (ble && ble.hr >= 30 && ble.hr <= 240) {
                  const batPct = batteryPercentFromRaw(ble.bat)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const mac = (ble as any).bleMac as string | undefined
                  const sensor7FromMac = mac ? macToId7(mac) : (ble.deviceIdHex && ble.deviceIdHex.length === 12 ? macToId7(ble.deviceIdHex) : null)
                  const sensor7FromDev = (ble.deviceIdHex && ble.deviceIdHex.length === 8) ? bleDeviceIdToId7(ble.deviceIdHex) : null
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const sensor7FromName = (ble as any).bleNameId7 as number | null | undefined
                  if (ble.advType === 161 || ble.advType === 162) {
                    setBleId7Cached(mac ?? null, sensor7FromDev)
                  }
                  const cached7 = getBleId7Cached(mac ?? null)
                  const pickStickerLike = (a: number | null, b: number | null) => {
                    const isSmall = (n: number | null) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1_000_000
                    if (isSmall(a) && !isSmall(b)) return a
                    if (isSmall(b) && !isSmall(a)) return b
                    return a ?? b
                  }
                  const chosen7 = (typeof sensor7FromName === 'number' && Number.isFinite(sensor7FromName)) ? sensor7FromName : (cached7 ?? pickStickerLike(sensor7FromDev, sensor7FromMac))
                  if (ble.bleNameId7 != null) {
                    setBleId7Cached(mac ?? null, sensor7FromName ?? null)
                  }
                  onMsg({
                    type: 'data',
                    ts: nowIso(),
                    tech: 'BLE',
                    sensor_id: chosen7 == null ? undefined : String(chosen7),
                    sensor_id_number: chosen7,
                    bpm: ble.hr,
                    model: 'CL831-0412709',
                    hub_id: ble.hubId,
                    hub_mac: ble.hubMac,
                    usb_version: ble.usbVersionHex,
                    cmd: ble.cmd,
                    ble_adv_type: ble.advType,
                    ble_device_id_hex: ble.deviceIdHex,
                    ble_battery: ble.bat,
                    ble_steps: ble.steps,
                    ble_calories: ble.calories,
                    ble_temperature_c: ble.tempC,
                    ble_oxygen: ble.oxygen,
                    battery_percent: batPct,
                    battery_raw: ble.bat,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    rssi: (ble as any).rssi ?? null,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    raw: `[${PARSER_TAG} hub900 ble-hr] mac=${mac ?? '-'} adv=${ble.advType} name=${(ble as any).bleName ?? '-'} id7_name=${(ble as any).bleNameId7 ?? '-'} devId=${ble.deviceIdHex || '-'} id7_mac=${sensor7FromMac ?? '-'} id7_dev=${sensor7FromDev ?? '-'} id7_cache=${cached7 ?? '-'} chosen=${chosen7 ?? '-'} hr=${ble.hr} bat=${ble.bat ?? '-'} | pkt(${pkt.length}) ${hexPreview(pkt, 160)} | merge(${mergeBytes.length}) ${hexPreview(mergeBytes, 160)}`,
                    source: 'connect:tcp',
                    format: 'ble',
                    bytes: pkt.length,
                  })
                }
              }
            }

            pos = end
          }
          continue
        }

        onMsg({
          type: 'data',
          ts: nowIso(),
          bpm: null,
          hub_id: abs?.hubId ?? null,
          hub_mac: abs?.hubMac,
          usb_version: abs?.usbVersionHex,
          cmd: abs?.cmd ?? null,
          raw: `[${PARSER_TAG} hub900 cmd=${cmd ?? '-'} ${mergeBytes.length}B] ${hexPreview(mergeBytes)}`,
          source: 'connect:tcp',
          format: 'binary',
          bytes: mergeBytes.length,
        })
      }
      return
    }

    if (buf.includes(0x7e)) {
      const h = parseHdlcFrames(buf)
      buf = Buffer.from(h.rest.subarray(Math.max(0, h.rest.length - 4096)))
      for (const frame of h.frames) {
        const cl = decodeCl831Frame(frame)
        const guess = cl?.bpm == null ? guesser.update(frame) : { bpm: cl.bpm, offset: 36, note: 'cl831' }
        const antIn = parseAntFrames(frame)
        if (antIn.frames.length > 0) {
          for (const f of antIn.frames) {
            const bpm = extractHrFromAntFrame(f.msgId, f.data)
            onMsg({
              type: 'data',
              ts: nowIso(),
              bpm,
              raw: `[${PARSER_TAG}] ANT msg=0x${f.msgId.toString(16).padStart(2, '0')} data=${f.data.toString('hex')}`,
              source: 'connect:tcp',
              format: 'ant',
              bytes: f.raw.length,
            })
          }
        } else {
          onMsg({
            type: 'data',
            ts: nowIso(),
            bpm: guess.bpm,
            model: cl?.model,
            device_id: cl?.device_id,
            ant_id: cl?.ant_id,
            ant_device_number: cl?.ant_device_number ?? null,
            battery_percent: cl?.battery_percent ?? null,
            comm_flags: cl?.comm_flags,
            msg_type: cl?.msg_type,
            seq: cl?.seq,
            raw: `[${PARSER_TAG} hdlc ${frame.length}B] ${hexPreview(frame)} | bpm=${guess.bpm ?? '-'} (off=${guess.offset ?? '-'})${cl ? ` | model=${cl.model} dev=${cl.device_id} ant=${cl.ant_id} bat=${cl.battery_percent ?? '-'} flags=${cl.comm_flags} type=${cl.msg_type} seq=${cl.seq}` : ''}`,
            source: 'connect:tcp',
            format: 'binary',
            bytes: frame.length,
          })
        }
      }
      return
    }

    const ant = parseAntFrames(buf)
    buf = ant.rest
    if (ant.frames.length > 0) {
      for (const f of ant.frames) {
        const bpm = extractHrFromAntFrame(f.msgId, f.data)
        onMsg({
          type: 'data',
          ts: nowIso(),
          bpm,
          raw: `[${PARSER_TAG}] ANT msg=0x${f.msgId.toString(16).padStart(2, '0')} data=${f.data.toString('hex')}`,
          source: 'connect:tcp',
          format: 'ant',
          bytes: f.raw.length,
        })
      }
      return
    }

    const decoded = tryDecodeUtf8(buf)
    if (decoded != null) {
      const text = decoded
      const parts = text.split(/\r?\n/)
      const tail = parts.pop() ?? ''
      buf = Buffer.from(tail, 'utf8')
      for (const line of parts) {
        const raw = line.trim()
        if (!raw) continue
        const bpm = parseBpmFromText(raw)
        onMsg({ type: 'data', ts: nowIso(), bpm, raw, source: 'connect:tcp', format: 'text', bytes: Buffer.byteLength(raw, 'utf8') })
      }
      return
    }

    onMsg({
      type: 'data',
      ts: nowIso(),
      bpm: null,
      raw: `[${PARSER_TAG} binary ${buf.length}B] ${hexPreview(buf)}`,
      source: 'connect:tcp',
      format: 'binary',
      bytes: buf.length,
    })
    buf = buf.subarray(Math.max(0, buf.length - 4096))
  })
  socket.on('error', (err) => {
    onMsg({ type: 'error', ts: nowIso(), message: `[${PARSER_TAG}] ${err?.message || '허브 TCP 오류'}`, source: 'connect:tcp' })
  })
  socket.on('close', () => {
    onMsg({ type: 'close', ts: nowIso(), message: `[${PARSER_TAG}] 허브 TCP 연결 종료`, source: 'connect:tcp' })
  })

  return () => {
    try {
      socket.destroy()
    } catch {
      // ignore
    }
  }
}

async function connectToHubWs(wsUrl: string, onMsg: (m: HeartRateMessage) => void) {
  const nowIso = () => new Date().toISOString()
  const ws = new WebSocket(wsUrl)

  ws.on('open', () => onMsg({ type: 'open', ts: nowIso(), message: `[${PARSER_TAG}] 허브 WS 연결됨: ${wsUrl}`, source: 'connect:ws' }))
  ws.on('message', (data) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data as any)

    if (buf.includes(0x7e)) {
      const h = parseHdlcFrames(buf)
      for (const frame of h.frames) {
        const antIn = parseAntFrames(frame)
        if (antIn.frames.length > 0) {
          for (const f of antIn.frames) {
            const bpm = extractHrFromAntFrame(f.msgId, f.data)
            onMsg({
              type: 'data',
              ts: nowIso(),
              bpm,
              raw: `ANT msg=0x${f.msgId.toString(16).padStart(2, '0')} data=${f.data.toString('hex')}`,
              source: 'connect:ws',
              format: 'ant',
              bytes: f.raw.length,
            })
          }
        } else {
          onMsg({
            type: 'data',
            ts: nowIso(),
            bpm: null,
            raw: `[${PARSER_TAG} hdlc ${frame.length}B] ${hexPreview(frame)}`,
            source: 'connect:ws',
            format: 'binary',
            bytes: frame.length,
          })
        }
      }
      return
    }

    const ant = parseAntFrames(buf)
    if (ant.frames.length > 0) {
      for (const f of ant.frames) {
        const bpm = extractHrFromAntFrame(f.msgId, f.data)
        onMsg({
          type: 'data',
          ts: nowIso(),
          bpm,
          raw: `[${PARSER_TAG}] ANT msg=0x${f.msgId.toString(16).padStart(2, '0')} data=${f.data.toString('hex')}`,
          source: 'connect:ws',
          format: 'ant',
          bytes: f.raw.length,
        })
      }
      return
    }

    const decoded = tryDecodeUtf8(buf)
    if (decoded != null) {
      const text = decoded
      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        const raw = line.trim()
        if (!raw) continue
        const bpm = parseBpmFromText(raw)
        onMsg({ type: 'data', ts: nowIso(), bpm, raw, source: 'connect:ws', format: 'text', bytes: Buffer.byteLength(raw, 'utf8') })
      }
      return
    }

    onMsg({
      type: 'data',
      ts: nowIso(),
      bpm: null,
      raw: `[${PARSER_TAG} binary ${buf.length}B] ${hexPreview(buf)}`,
      source: 'connect:ws',
      format: 'binary',
      bytes: buf.length,
    })
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.on('error', (err: any) => onMsg({ type: 'error', ts: nowIso(), message: `[${PARSER_TAG}] ${err?.message || '허브 WS 오류'}`, source: 'connect:ws' }))
  ws.on('close', () => onMsg({ type: 'close', ts: nowIso(), message: `[${PARSER_TAG}] 허브 WS 연결 종료`, source: 'connect:ws' }))

  return () => {
    try {
      ws.close()
    } catch {
      // ignore
    }
  }
}

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const search = req.nextUrl.searchParams
  const mode = (search.get('mode') || 'listen').trim() // listen | connect
  const proto = (search.get('proto') || 'tcp').trim().toLowerCase() // tcp | udp | ws

  const host = (search.get('host') || '0.0.0.0').trim()
  const port = Math.max(1, Math.min(65535, Number(search.get('port') || '8088')))

  // connect 모드용(허브로 접속)
  const hubHost = (search.get('hubHost') || '').trim()
  const hubPort = Math.max(1, Math.min(65535, Number(search.get('hubPort') || String(port))))
  const wsPath = (search.get('wsPath') || '/').trim() || '/'

  const encoder = new TextEncoder()
  const nowIso = () => new Date().toISOString()
  const sse = (data: HeartRateMessage) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
  const comment = (text: string) => encoder.encode(`: ${text}\n\n`)

  let pingTimer: NodeJS.Timeout | null = null
  let unsubscribe: (() => void) | null = null
  let disconnectUpstream: (() => void) | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (msg: HeartRateMessage) => controller.enqueue(sse(msg))

      if (mode === 'connect') {
        if (!hubHost) {
          write({ type: 'error', ts: nowIso(), message: 'connect 모드에서는 hubHost가 필요합니다.' })
          controller.close()
          return
        }

        if (proto === 'ws' || proto === 'websocket') {
          const normalizedPath = wsPath.startsWith('/') ? wsPath : `/${wsPath}`
          const wsUrl = `ws://${hubHost}:${hubPort}${normalizedPath}`
          disconnectUpstream = await connectToHubWs(wsUrl, (m) => {
            try {
              controller.enqueue(sse(m))
            } catch {
              // ignore
            }
          })
          write({ type: 'open', ts: nowIso(), message: `허브 WebSocket 접속 시도: ${wsUrl}` })
        } else {
          disconnectUpstream = await connectToHubTcp(hubHost, hubPort, (m) => {
            try {
              controller.enqueue(sse(m))
            } catch {
              // ignore
            }
          })
          write({ type: 'open', ts: nowIso(), message: `허브 TCP 접속 시도: ${hubHost}:${hubPort}` })
        }
      } else {
        // listen 모드: PC가 8088을 리스닝하여 Hub → PC 전송을 수신 (TCP/UDP)
        let bridge: HubBridge
        try {
          bridge = await ensureBridge(host, port)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
          write({
            type: 'error',
            ts: nowIso(),
            message: `TCP/UDP 바인딩 실패 (${host}:${port}) - ${e?.code ? `${e.code}: ` : ''}${e?.message || 'unknown'}`,
          })
          controller.close()
          return
        }

        write({
          type: 'open',
          ts: nowIso(),
          message: `TCP/UDP 리스닝 중: ${bridge.host}:${bridge.port} (startedAt=${bridge.startedAt})`,
        })

        const onMsg = (msg: HeartRateMessage) => {
          try {
            controller.enqueue(sse(msg))
          } catch {
            // ignore
          }
        }
        bridge.emitter.on('msg', onMsg)
        unsubscribe = () => {
          try {
            bridge.emitter.off('msg', onMsg)
          } catch {
            // ignore
          }
        }
      }

      // SSE keep-alive
      pingTimer = setInterval(() => {
        try {
          controller.enqueue(comment('ping'))
        } catch {
          // ignore
        }
      }, 15000)
    },
    cancel() {
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = null
      if (unsubscribe) unsubscribe()
      unsubscribe = null
      if (disconnectUpstream) disconnectUpstream()
      disconnectUpstream = null
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx 등의 프록시 버퍼링 방지 (가능한 경우)
      'X-Accel-Buffering': 'no',
    },
  })
}


