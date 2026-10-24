import './globals.css';

export const metadata = {
  title: 'Price Alert Emailer',
  description: 'Get an email when something you saved goes on sale — at that store or the others you shop.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar"><a href="/">Price Alert Emailer</a></header>
        <main>{children}</main>
      </body>
    </html>
  );
}
