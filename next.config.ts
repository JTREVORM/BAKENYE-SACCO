import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Member profile photos are the only remote images. Keep the allow-list tight.
  images: {
    formats: ['image/avif', 'image/webp'],
    // Supabase Storage public bucket for member/staff profile photos.
    remotePatterns: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? [
          {
            protocol: 'https',
            hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
            pathname: '/storage/v1/object/public/**',
          },
        ]
      : [],
  },
  experimental: {
    // Keeps the client bundle small for low-end Android devices.
    optimizePackageImports: ['@supabase/supabase-js'],
    // Supporting documents (deposit slips, transfer confirmations) travel with
    // the finance forms. The storage bucket caps a file at 5 MB; this leaves
    // room for the rest of the form around it.
    serverActions: { bodySizeLimit: '6mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
