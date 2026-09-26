"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** IPOs moved into Others. This address forwards there, so a bookmark or a
 *  saved link to the old page still lands somewhere useful. */
export default function IpoMoved() {
  const router = useRouter();
  useEffect(() => { router.replace("/others"); }, [router]);
  return null;
}
