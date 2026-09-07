import { NextResponse } from 'next/server'

import { isDeviceApiEnabled } from './lib/deviceApiAccess'

export function middleware() {
  if (isDeviceApiEnabled(process.env.DEVICE_API_ENABLED)) {
    return NextResponse.next()
  }

  return NextResponse.json(
    { error: 'Not Found' },
    {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}

export const config = {
  matcher: '/api/device/:path*',
}
