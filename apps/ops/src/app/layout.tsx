import type { ReactNode } from 'react'
import Link from 'next/link'
import './globals.css'

export const metadata = {
  title: 'Sartre Portal',
  description: 'Client and pod GTM operating system portal',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Sartre Portal</Link>
          <span className="tag">client + pod workspace</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
