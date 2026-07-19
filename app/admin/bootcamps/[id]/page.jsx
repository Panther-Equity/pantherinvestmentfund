"use client";

import { useParams } from "next/navigation";
import BootcampBuilder from "@/components/admin/BootcampBuilder";

export default function BootcampEditPage() {
  const params = useParams();
  return <BootcampBuilder id={params.id} />;
}
