import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '클래식: 범죄와의 전쟁',
  description: '검을 들고, 운명에 도전하라. 오리지널 픽셀아트 클래식 판타지 RPG.',
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="ko"><body>{children}</body></html>;
}
