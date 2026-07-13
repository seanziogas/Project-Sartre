/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sartre/core', '@sartre/data', '@sartre/db', '@sartre/pipelines'],
}

export default nextConfig
