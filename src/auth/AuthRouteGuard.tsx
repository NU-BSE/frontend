import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRootNavigationState, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { hasAuthSession } from "./emailAuth";
import { palette } from "@/theme/tokens";

/**
 * Routes reachable without a session.
 *
 * The whole `/onboarding` subtree is public because onboarding *contains* the
 * sign-up step: the user is unauthenticated when they enter it and only
 * acquires a token partway through. Gating its later screens would eject
 * people out of the very flow that issues the credential.
 */
const isPublicPath = (pathname: string): boolean =>
  pathname === "/" ||
  pathname.startsWith("/auth") ||
  pathname.startsWith("/onboarding");

export function AuthRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useQuery({
    queryKey: ["auth-session"],
    queryFn: hasAuthSession,
    staleTime: Infinity,
  });

  /*
   * `router.replace` is a no-op until a navigator is mounted. This guard wraps
   * the root <Stack>, so it must wait for that Stack to register before
   * redirecting — otherwise the navigation is silently dropped.
   */
  const rootNavigation = useRootNavigationState();
  const navigatorReady = Boolean(rootNavigation?.key);

  const publicPath = isPublicPath(pathname);
  // `!auth.data` rather than `=== false`, so a failed lookup is treated as
  // "no session" and still redirects, instead of falling through to content.
  const blocked = !auth.isPending && !auth.data && !publicPath;

  useEffect(() => {
    if (blocked && navigatorReady) router.replace("/auth");
  }, [blocked, navigatorReady, router]);

  /*
   * `children` is rendered unconditionally, including while blocked.
   *
   * An earlier version returned null here, which unmounted the Stack — and an
   * unmounted navigator cannot process the redirect above, so the app parked
   * on a blank screen with no way forward. The navigator must stay alive for
   * the redirect to land; a cover is drawn over it instead so protected
   * content is never visible during the frame or two before it does.
   */
  const covered = blocked || (auth.isPending && !publicPath);

  return (
    <>
      {children}
      {covered ? (
        <View style={styles.cover}>
          <ActivityIndicator color={palette.brand} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.canvas,
  },
});
