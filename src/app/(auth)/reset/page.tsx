import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "@/components/auth/reset-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Nouveau mot de passe", robots: { index: false }, referrer: "no-referrer" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token_hash?: string | string[]; invite?: string | string[] }> }) {
  const { token_hash, invite } = await searchParams;
  const tokenHash = typeof token_hash === "string" ? token_hash : "";
  if (!tokenHash) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Lien invalide</CardTitle>
          <CardDescription>Ce lien est incomplet ou a expiré.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/forgot" className="text-sm text-link hover:underline">Demander un nouveau lien</Link>
        </CardContent>
      </Card>
    );
  }
  return <ResetForm tokenHash={tokenHash} invite={invite === "1"} />;
}
