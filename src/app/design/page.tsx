"use client";

import { motion } from "framer-motion";
import { Inbox, MoreHorizontal, Plus, Trash2, Pencil, Users } from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function Section({ title, children, i }: { title: string; children: React.ReactNode; i: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-4"
    >
      <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </motion.section>
  );
}

const leads = [
  { name: "Camille Durand", city: "Lyon", status: "Nouveau", color: "#7c6cff" },
  { name: "Mehdi Benali", city: "Marseille", status: "RDV pris", color: "#f59e0b" },
  { name: "Sophie Martin", city: "Paris", status: "Gagné", color: "#22c55e" },
];

export default function DesignPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-12 px-4 py-8 sm:px-8 sm:py-12">
      <PageHeader
        title="Design system"
        description="Composants Orvolt : sombre par défaut, clair en option."
        actions={
          <>
            <ThemeToggle />
            <Button onClick={() => toast.success("Lead créé", { description: "Camille Durand a été ajoutée." })}>
              <Plus className="size-4" /> Notification
            </Button>
          </>
        }
      />

      <Section i={0} title="Boutons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primaire</Button>
          <Button variant="secondary">Secondaire</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="outline">Contour</Button>
          <Button variant="destructive">Supprimer</Button>
          <Button loading>Chargement</Button>
          <Button disabled>Désactivé</Button>
          <Button size="sm">Petit</Button>
          <Button size="lg">Grand</Button>
        </div>
      </Section>

      <Section i={1} title="Statistiques">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Leads ce mois" value={248} delta={12} hint="vs mois dernier" />
          <StatCard label="Taux de conversion" value="18,4 %" delta={-3} hint="vs mois dernier" />
          <StatCard label="Chargement" loading />
        </div>
      </Section>

      <Section i={2} title="Formulaire">
        <Card>
          <CardHeader>
            <CardTitle>Nouveau lead</CardTitle>
            <CardDescription>Champs, sélecteurs et options.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nom">Nom</Label>
              <Input id="nom" placeholder="Camille Durand" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mail">E-mail (erreur)</Label>
              <Input id="mail" aria-invalid defaultValue="invalide@" />
              <p className="text-xs text-destructive-text">Adresse e-mail invalide.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="src">Source</Label>
              <Select id="src" defaultValue="meta">
                <option value="meta">Meta Ads</option>
                <option value="google">Google Ads</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="off">Désactivé</Label>
              <Input id="off" disabled placeholder="Indisponible" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="note">Note</Label>
              <Textarea id="note" placeholder="Contexte de l'appel…" />
            </div>
            <div className="flex items-center gap-3">
              <Checkbox id="rgpd" defaultChecked />
              <Label htmlFor="rgpd">Consentement RGPD</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="notif" defaultChecked />
              <Label htmlFor="notif">Notifier le commercial</Label>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section i={3} title="Badges et avatars">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Neutre</Badge>
          <Badge tone="accent" dot>Accent</Badge>
          <Badge tone="success" dot>Succès</Badge>
          <Badge tone="warning" dot>Alerte</Badge>
          <Badge tone="destructive" dot>Perdu</Badge>
          <Badge color="#06b6d4" dot>Couleur dynamique</Badge>
          <Avatar name="Camille Durand" size="sm" />
          <Avatar name="Mehdi Benali" />
          <Avatar name="Sophie Martin" size="lg" />
        </div>
      </Section>

      <Section i={4} title="Tableau">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Ville</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((l) => (
              <TableRow key={l.name}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar name={l.name} size="sm" />
                    <span className="font-medium">{l.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{l.city}</TableCell>
                <TableCell><Badge color={l.color} dot>{l.status}</Badge></TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label={`Actions pour ${l.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem><Pencil /> Modifier</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive><Trash2 /> Supprimer</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section i={5} title="Onglets, infobulle, modale">
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">Activité</TabsTrigger>
            <TabsTrigger value="b">Notes</TabsTrigger>
            <TabsTrigger value="c">Fichiers</TabsTrigger>
          </TabsList>
          <TabsContent value="a" className="text-sm text-muted-foreground">Historique des événements du lead.</TabsContent>
          <TabsContent value="b" className="text-sm text-muted-foreground">Notes internes.</TabsContent>
          <TabsContent value="c" className="text-sm text-muted-foreground">Pièces jointes.</TabsContent>
        </Tabs>
        <Separator />
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild><Button variant="outline">Survolez-moi</Button></TooltipTrigger>
            <TooltipContent>Une infobulle accessible au clavier</TooltipContent>
          </Tooltip>
          <Dialog>
            <DialogTrigger asChild><Button variant="secondary">Ouvrir la modale</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Supprimer ce lead ?</DialogTitle>
                <DialogDescription>Cette action est définitive et supprimera son historique.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Annuler</Button></DialogClose>
                <DialogClose asChild><Button variant="destructive">Supprimer</Button></DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Section>

      <Section i={6} title="États : chargement et vide">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="space-y-3 p-5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </Card>
          <EmptyState
            icon={Inbox}
            title="Aucun lead pour l'instant"
            description="Importez un CSV ou connectez un formulaire pour recevoir vos premiers leads."
            action={<Button size="sm"><Users className="size-4" /> Importer des leads</Button>}
          />
        </div>
      </Section>
    </main>
  );
}
