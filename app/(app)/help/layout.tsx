// The Help Center page is a client component (it reads the URL to open a
// topic), and a client component cannot export metadata, so the page
// title lives here.
export const metadata = { title: "Help Center" };

export default function HelpLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
