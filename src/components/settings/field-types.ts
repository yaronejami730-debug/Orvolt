import { AlignLeft, Calendar, Hash, List, MapPin, Paperclip, type LucideIcon } from "lucide-react";

export type FieldType = "text" | "number" | "date" | "select" | "file" | "address";

export const FIELD_TYPE_META: Record<FieldType, { label: string; icon: LucideIcon }> = {
  text: { label: "Texte", icon: AlignLeft },
  number: { label: "Nombre", icon: Hash },
  date: { label: "Date", icon: Calendar },
  select: { label: "Liste à options", icon: List },
  file: { label: "Fichier", icon: Paperclip },
  address: { label: "Adresse", icon: MapPin },
};
