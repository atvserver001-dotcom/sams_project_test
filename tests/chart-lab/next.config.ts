import type { NextConfig } from 'next'

const config: NextConfig = {
  devIndicators: false,
  distDir: '.next-chart-lab',
  experimental: { externalDir: true },
}

export default config
