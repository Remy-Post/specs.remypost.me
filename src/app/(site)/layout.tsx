import AutoRefresh from '@/components/AutoRefresh'
import Footer from '@/components/Footer'

// The shell sits here, not in each page, so it stays mounted while a tab change swaps the page inside it. A
// <ViewTransition> only plays enter and exit when no DOM element sits between it and the page root, and `<main>`
// is such an element: with it inside the page, React never saw the board enter or leave and nothing slid.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to the numbers
      </a>
      <main id="main" className="wrap">
        {children}
      </main>
      <Footer />
      <AutoRefresh />
    </>
  )
}
