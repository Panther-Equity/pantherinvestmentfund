"use client";

import { useParams } from "next/navigation";
import LearnPlayer from "@/components/learn/LearnPlayer";

export default function LearnBootcampPage() {
  const { id } = useParams();
  return <LearnPlayer bootcampId={id} />;
}
