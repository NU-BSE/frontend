import React from "react";
import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import NavAuth from "@assets/icons/people-group.svg";
import NavFeed from "@assets/icons/nav-feed.svg";
import NavHistory from "@assets/icons/nav-history.svg";
import { palette, radius, spacing, typography } from "@/theme/tokens";

/** The bar itself, before anything the system reserves underneath it. */
const BAR_HEIGHT = 74;

export default function TabsLayout() {
  /*
   * React Navigation adds the bottom inset to the tab bar for you — unless you
   * give `tabBarStyle` an explicit `height`, which replaces the computed one
   * outright. This did, so the bar was 74pt tall whatever was beneath it: fine
   * under gesture navigation, where the inset is a thin pill, and wrong under
   * three-button navigation, where 48dp of system buttons sat on top of the
   * icons.
   *
   * Android draws edge-to-edge by default in RN 0.86, so nothing else is going
   * to leave that space; the inset has to be added back here.
   */
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.canvas },
        tabBarStyle: [
          styles.bar,
          {
            height: BAR_HEIGHT + insets.bottom,
            paddingBottom: spacing.md + insets.bottom,
          },
        ],
        tabBarActiveTintColor: palette.brand,
        tabBarInactiveTintColor: palette.textSecondary,
        tabBarLabelStyle: styles.label,
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: ({ color }) => (
            <Icon source={NavFeed} size={14} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ color }) => (
            <Icon source={NavHistory} size={15} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="auth"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => (
            <Icon source={NavAuth} size={18} height={13} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: palette.surface,
    borderTopColor: palette.borderFaint,
    borderTopWidth: 1,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    paddingTop: spacing.md,
    // height and paddingBottom are applied above, where the inset is known.
  },
  label: { ...typography.nav, marginTop: 2 },
});
