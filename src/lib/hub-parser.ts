
export type HeartRateMessage = {
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
  source?: string
  format?: 'text' | 'binary' | 'ant' | 'ble'
  bytes?: number
  message?: string
}

export const PARSER_TAG = 'hr-parser-web-v1'

// --- Helpers for Uint8Array ---



function beU16(view: DataView, pos: number) {
  return view.getUint16(pos, false)
}

function beU32(view: DataView, pos: number) {
  return view.getUint32(pos, false)
}

function beU24(view: DataView, pos: number) {
  return (view.getUint8(pos) << 16) | (view.getUint8(pos + 1) << 8) | view.getUint8(pos + 2)
}

function toHex(arr: Uint8Array) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function toMacWithColons(arr: Uint8Array) {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase()
}

export function hexPreview(arr: Uint8Array, maxBytes = 64) {
  const slice = arr.subarray(0, Math.min(maxBytes, arr.length))
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ')
  return arr.length > maxBytes ? `${hex} … (+${arr.length - maxBytes}B)` : hex
}

// --- Hub900 Parsing Logic ---

export function hubEscapeIsValid(content: Uint8Array) {
  for (let i = 0; i < content.length - 1; i++) {
    if (content[i] === 0x7d) {
      const n = content[i + 1]
      if (n !== 0x01 && n !== 0x02 && n !== 0x03) return false
      i += 1
    }
  }
  return true
}

export function hubUnescape(content: Uint8Array) {
  const out: number[] = []
  for (let i = 0; i < content.length; i++) {
    const b = content[i]
    if (b === 0x7d && i + 1 < content.length) {
      const n = content[i + 1]
      if (n === 0x01) out.push(0x7d)
      else if (n === 0x02) out.push(0x7e)
      else if (n === 0x03) out.push(0x7f)
      else {
        out.push(b, n)
      }
      i += 1
      continue
    }
    out.push(b)
  }
  return new Uint8Array(out)
}

function hubChecksumExpected(sum: number) {
  const nam = -sum
  const neu = nam ^ 0x3a3a
  return neu & 0xffff
}

export function hubChecksumValid(bytes: Uint8Array) {
  if (bytes.length < 3) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const checksum = view.getUint16(bytes.length - 2, false)
  let sum = 0
  for (let i = 0; i < bytes.length - 2; i++) sum += bytes[i]
  const expected = hubChecksumExpected(sum)
  return checksum === expected
}

export function parseHub900Frames(input: Uint8Array) {
  const frames: Uint8Array[] = []
  let buf = input

  while (true) {
    const start = buf.indexOf(0x7e)
    if (start < 0) return { frames, rest: new Uint8Array(0) }
    if (start > 0) buf = buf.subarray(start)
    const end = buf.indexOf(0x7f, 1)
    if (end < 0) return { frames, rest: buf } // Keep remaining buffer
    const frame = buf.subarray(0, end + 1)
    frames.push(frame) // slice is not needed as subarray shares memory, but safer to treat as immutable if needed. Here we just push.
    buf = buf.subarray(end + 1)
  }
}

export function parseHub900Abstract(mergeBytes: Uint8Array) {
  if (mergeBytes.length < 20) return null
  const view = new DataView(mergeBytes.buffer, mergeBytes.byteOffset, mergeBytes.byteLength)

  const magic = mergeBytes[0]
  const hubId = beU32(view, 1)
  const packetSerial = beU16(view, 5)
  const version = mergeBytes[7]
  const packetLen = beU16(view, 8)
  const usbVersionBytes = mergeBytes.subarray(10, 13)
  const usbVersionHex = toHex(usbVersionBytes)
  const macRaw = mergeBytes.subarray(13, 19)
  // reverse mac
  const macReversed = new Uint8Array(Array.from(macRaw).reverse())
  const hubMac = toMacWithColons(macReversed)
  const cmd = mergeBytes[19]
  return { magic, hubId, packetSerial, version, packetLen, usbVersionHex, hubMac, cmd }
}

export function parseHub900AntHeartRate(mergeBytes: Uint8Array, antPacket15: Uint8Array) {
  if (antPacket15.length < 15) return null
  const view = new DataView(antPacket15.buffer, antPacket15.byteOffset, antPacket15.byteLength)
  const deviceType = antPacket15[0]

  const devi = beU16(view, 0)
  const deviceID = antPacket15.subarray(2, 6)
  const deviceIDIF = (antPacket15[1] >> 4) & 0x0f
  let deviceIdNum: number | null = null

  if (devi === 0 || devi === 0xabcd) {
    if (deviceIDIF !== 0) {
      const first = deviceIDIF & 0xff
      const b1 = deviceID[2]
      const b2 = deviceID[3]
      deviceIdNum = (first << 16) | (b1 << 8) | b2
    }
  } else {
    deviceIdNum = (deviceID[0] << 24) | (deviceID[1] << 16) | (deviceID[2] << 8) | deviceID[3]
  }

  let batteryRaw: number | null = null
  if (antPacket15[6] === 7) batteryRaw = antPacket15[7]
  const heartRate = antPacket15[13]
  const rssi = (antPacket15[antPacket15.length - 1] - 256)

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

export function batteryPercentFromRaw(raw: number | null | undefined) {
  if (raw == null) return null
  const v = Math.max(0, Math.min(255, raw))
  if (v <= 100) return v
  return Math.round((v / 255) * 100)
}



export function parseHub900BleHeartRate(mergeBytes: Uint8Array, blePacket: Uint8Array) {
  if (blePacket.length < 12) return null
  const view = new DataView(blePacket.buffer, blePacket.byteOffset, blePacket.byteLength)
  const bleLen = blePacket[0]
  if (bleLen <= 10) return null

  const advType = blePacket[5]
  const abs = parseHub900Abstract(mergeBytes)

  const parseBleAdvNameAndId7 = () => {
    const advBytesLen = bleLen - 7
    if (advBytesLen <= 0) return { name: null as string | null, id7: null as number | null }
    const advEnd = Math.min(advBytesLen, blePacket.length - 1)
    let i = 1
    let bestName: string | null = null
    while (i <= advEnd) {
      const l = blePacket[i]
      if (l === 0) break
      const start = i + 1
      const end = i + 1 + l
      if (end > blePacket.length) break
      const type = blePacket[start]
      if (type === 0x09 || type === 0x08) {
        const nameBytes = blePacket.subarray(start + 1, end)
        // ASCII decode
        let s = ''
        for (let k = 0; k < nameBytes.length; k++) s += String.fromCharCode(nameBytes[k])
        s = s.replace(/\0/g, '').trim()

        if (s) {
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
    const m = bestName.match(/CL831-(\d{7})/i) ?? bestName.match(/CL831-(\d{6,7})/i)
    if (!m) return { name: bestName, id7: null }
    const n = Number(m[1])
    if (!Number.isFinite(n)) return { name: bestName, id7: null }
    return { name: bestName, id7: n }
  }

  const parseBleMacAndRssi = () => {
    const advBytesLen = bleLen - 7
    if (advBytesLen <= 0) return { bleMac: null as string | null, rssi: null as number | null }
    const rssiIdx = advBytesLen + 1
    const macStart = advBytesLen + 2
    if (blePacket.length < macStart + 6) return { bleMac: null, rssi: null }
    const macBytes = blePacket.subarray(macStart, macStart + 6)
    const bleMac = toMacWithColons(macBytes)
    const rssi = (blePacket[rssiIdx] - 256)
    return { bleMac, rssi }
  }

  const macInfo = parseBleMacAndRssi()
  const advInfo = parseBleAdvNameAndId7()

  if (advType === 161 || advType === 162) {
    const deviceIdHex = toHex(blePacket.subarray(6, 10))
    const hr = blePacket[10]
    const bat = blePacket[11]
    const steps = blePacket.length >= 15 ? beU24(view, 12) : null
    const calories = blePacket.length >= 18 ? Math.round((beU24(view, 15) / 10) * 10) / 10 : null
    const tempC = advType === 162 && blePacket.length >= 20 ? Math.round((beU16(view, 18) / 10) * 10) / 10 : null
    const oxygen = advType === 162 && blePacket.length > 21 ? blePacket[20] : null

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

  if (blePacket.length >= 16 && blePacket[6] === 13 && blePacket[7] === 24) {
    const bat = blePacket.length >= 14 ? blePacket[13] : null
    const hr = blePacket[15]
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

// --- HDLC & ANT Logic ---

export function parseHdlcFrames(input: Uint8Array) {
  const frames: Uint8Array[] = []
  const FLAG = 0x7e
  const ESC = 0x7d

  const firstFlag = input.indexOf(FLAG)
  if (firstFlag < 0) return { frames, rest: input }

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
      frames.push(new Uint8Array(out))
    }
    i = nextFlag + 1
  }
  const rest = input.subarray(lastFlag)
  return { frames, rest }
}

export function decodeCl831Frame(frame: Uint8Array) {
  if (frame.length < 20) return null
  if (frame[0] !== 0xaa) return null
  if (frame[1] !== 0x00 || frame[2] !== 0x00) return null
  if (frame[3] !== 0xad || frame[4] !== 0xf3) return null

  const msgType = frame[5]
  const seq = frame[6]
  const deviceId = frame.length >= 19 ? toHex(frame.subarray(13, 19)) : ''
  const antIdBuf = frame.length >= 35 ? frame.subarray(33, 35) : null
  const antId = antIdBuf ? toHex(antIdBuf) : ''
  const antDeviceNumber = antIdBuf ? (antIdBuf[0] | (antIdBuf[1] << 8)) : null
  const commFlags = frame.length >= 33 ? toHex(frame.subarray(31, 33)) : ''

  let battery: number | null = null
  let bpm: number | null = null

  if (frame.length === 41 && msgType === 0x1b) {
    const b = frame[35]
    if (b <= 100) battery = b
    else battery = Math.round((b / 255) * 100)

    const hr = frame[36]
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

export function parseAntFrames(input: Uint8Array) {
  let buf = input
  const frames: Array<{ msgId: number; data: Uint8Array; raw: Uint8Array }> = []

  while (buf.length >= 4) {
    const syncIdx = buf.indexOf(0xa4)
    if (syncIdx < 0) return { frames, rest: new Uint8Array(0) }
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
      frames.push({ msgId, data, raw: buf.subarray(0, total) })
      buf = buf.subarray(total)
      continue
    }
    buf = buf.subarray(1)
  }
  return { frames, rest: buf }
}


export function extractHrFromAntFrame(msgId: number, data: Uint8Array): number | null {
  if (msgId === 0x4e || msgId === 0x4f) {
    if (data.length >= 9) {
      const hr = data[8]
      if (hr >= 30 && hr <= 240) return hr
    }
  }
  return null
}

export type BpmGuess = { bpm: number | null; offset: number | null; note: string }

export class BpmGuesser {
  private stats: Array<{
    inRange: number
    changes: number
    step1: number
    last: number | null
    sum: number
    sumsq: number
  }> = []

  private bestOffset: number | null = null

  update(frame: Uint8Array): BpmGuess {
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
