/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sartre/core', '@sartre/data', '@sartre/db', '@sartre/learning', '@sartre/pipelines', '@sartre/skills'],
}

export default nextConfig
