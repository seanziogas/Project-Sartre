import type { ReactNode } from 'react'
import Link from 'next/link'
import './globals.css'

export const metadata = {
  title: 'Sartre Ops',
  description: 'GTM operating system — internal ops surface',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Sartre Ops</Link>
          <span className="tag">internal v1</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
