"use client";

import { useParams } from "next/navigation";
import PreviewPlayer from "@/components/learn/PreviewPlayer";

export default function BootcampPreviewPage() {
  const { id } = useParams();
  return <PreviewPlayer bootcampId={id} />;
}
