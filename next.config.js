/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    BINANCE_API_KEY: process.env.BINANCE_API_KEY,
    BINANCE_SECRET: process.env.BINANCE_SECRET,
  },
}

module.exports = nextConfig
