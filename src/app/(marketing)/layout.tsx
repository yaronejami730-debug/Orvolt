import "@/styles/marketing.css";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { isSignedIn } from "@/lib/marketing-session";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await isSignedIn();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#contenu" className="sr-only z-50 rounded-md bg-accent px-4 py-2 text-accent-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Aller au contenu</a>
      <SiteHeader signedIn={signedIn} />
      <main id="contenu" className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
