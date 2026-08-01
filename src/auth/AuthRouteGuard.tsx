import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "expo-router";

import { hasAuthSession } from "./emailAuth";

const isPublicPath = (pathname: string): boolean =>
  pathname === "/" ||
  pathname.startsWith("/auth") ||
  pathname === "/onboarding" ||
  pathname === "/onboarding/auth";

export function AuthRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useQuery({
    queryKey: ["auth-session"],
    queryFn: hasAuthSession,
    staleTime: Infinity,
  });
  const publicPath = isPublicPath(pathname);

  useEffect(() => {
    if (!auth.isPending && !auth.data && !publicPath) {
      router.replace("/auth");
    }
  }, [auth.data, auth.isPending, publicPath, router]);

  if ((auth.isPending || !auth.data) && !publicPath) return null;
  return <>{children}</>;
}
