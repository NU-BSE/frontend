import React from "react";
import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";

import { Icon } from "@/components/Icon";
import NavAuth from "@assets/icons/people-group.svg";
import NavFeed from "@assets/icons/nav-feed.svg";
import NavHistory from "@assets/icons/nav-history.svg";
import { palette, radius, spacing, typography } from "@/theme/tokens";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.canvas },
        tabBarStyle: styles.bar,
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
    height: 74,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  label: { ...typography.nav, marginTop: 2 },
});
