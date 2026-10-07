import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Playfair_Display } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});
const playfair = Playfair_Display({subsets:['latin'],variable:'--font-playfair'});

// CHANGE: 2026-10-06 — SP-4 noindex layer 3: this deployment is the admin panel and must
// never appear in search engines (owner rule; layers 1-2 = robots.txt + middleware
// X-Robots-Tag). The root layout is a server component, so this metadata is static.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "only light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("h-full antialiased", "font-sans", geist.variable, playfair.variable)} style={{ colorScheme: "only light" }} data-scroll-behavior="smooth" suppressHydrationWarning>
      {/* CHANGE: 2026-08-25 — Leadfeeder tracker. next/script with beforeInteractive
          places the <script> in <head> before </head> as Leadfeeder docs require.
          dangerouslySetInnerHTML in <body> is stripped by Next.js SSR and never runs. */}
      <Script id="leadfeeder-tracker" strategy="beforeInteractive">
        {`(function(ss,ex){window.ldfdr=window.ldfdr||function(){(ldfdr._q=ldfdr._q||[]).push([].slice.call(arguments));};(function(d,s){fs=d.getElementsByTagName(s)[0];function ce(src){var cs=d.createElement(s);cs.src=src;cs.async=1;fs.parentNode.insertBefore(cs,fs);};ce('https://sc.lfeeder.com/lftracker_v1_'+ss+(ex?'_'+ex:'')+'.js');})(document,'script');})('lYNOR8x5Dwq7WQJZ');`}
      </Script>
      <body className="relative min-h-full w-full bg-background text-foreground" suppressHydrationWarning>
        {children}
        {/* CHANGE: 2026-08-25 — Zoho SalesIQ TRACKING-ONLY embed (temporarily commented out for Leadfeeder testing).
        <script dangerouslySetInnerHTML={{ __html: `window.$zoho=window.$zoho || {};$zoho.salesiq=$zoho.salesiq||{ready:function(){}};$zoho.salesiq.ready(function(){try{$zoho.salesiq.floatbutton&&$zoho.salesiq.floatbutton.visible&&$zoho.salesiq.floatbutton.visible("hide")}catch(e){}try{$zoho.salesiq.chatbutton&&$zoho.salesiq.chatbutton.visible&&$zoho.salesiq.chatbutton.visible("hide")}catch(e){}})` }} />
        <script id="zsiqscript" defer src="https://salesiq.zohopublic.in/widget?wc=siq539386e56b76884f928a8048a569c499cd2f211af4903e74d1fcabc147a596a7" /> */}
      </body>
    </html>
  );
}
