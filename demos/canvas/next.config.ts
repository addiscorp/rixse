import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

// `next dev` gets the Worker bindings (the AI binding, which is always remote).
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  devIndicators: false,
  transpilePackages: ['rixse', 'rixse-react'],
};

export default nextConfig;
