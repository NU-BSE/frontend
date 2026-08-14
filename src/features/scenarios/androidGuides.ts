/**
 * The Android guide library from creepy.im — "Fix the Android problem you
 * actually have".
 *
 * These double as the Settings scenario's chat prompts: each title is already
 * phrased as the question a user arrives with, so it can be sent verbatim as a
 * message rather than being reworded into a prompt.
 *
 * The site's six clusters are kept rather than flattened. The chat currently
 * renders a flat chip list, but the grouping is the difference between a wall
 * of thirty-six chips and a browsable library, and throwing it away here would
 * make that impossible to build later without re-deriving it.
 */

export interface GuideCluster {
  /** Two-digit ordinal, as shown on the site. */
  n: string;
  name: string;
  /** The site's sub-label — what the cluster covers. */
  label: string;
  prompts: string[];
}

export const ANDROID_GUIDE_CLUSTERS: GuideCluster[] = [
  {
    n: '01',
    name: 'Notifications & Focus',
    label: 'Alerts, Do Not Disturb, sounds',
    prompts: [
      'How to Stop One Android App from Sending Notifications',
      'How to Silence an App at Night Without Muting Everything',
      'Android Notifications Not Showing? Check These Settings First',
      'How to Find a Notification You Accidentally Dismissed',
      'How to Let One App Bypass Do Not Disturb',
      'How to Fix Notification Sounds or Vibration on Android',
    ],
  },
  {
    n: '02',
    name: 'Privacy, Permissions & Gemini',
    label: 'Assistants, permissions, tracking',
    prompts: [
      'How to Turn Off Gemini as Your Android Assistant (and What Changes)',
      'How to Change the Default Digital Assistant on Android',
      'How to Stop Gemini Opening from the Power Button',
      'How to See Which Android Apps Used Your Camera, Mic, or Location',
      'How to Stop One App Tracking Your Location in the Background',
      'How to Disable Camera or Microphone Access for an Android App',
    ],
  },
  {
    n: '03',
    name: 'Battery & Performance',
    label: 'Drain, optimization, heat',
    prompts: [
      'Android Battery Draining Fast? Find the App Responsible',
      'Battery Drain After an Android Update? What to Check First',
      'How to Stop an Android App Running in the Background',
      'How to Turn On Adaptive Battery and Battery Optimization',
      'How to Make a Low Android Battery Last Until You Can Charge',
      'Android Phone Getting Hot? Reduce Battery Drain Before It Gets Worse',
    ],
  },
  {
    n: '04',
    name: 'Storage & App Problems',
    label: 'Space, cache, crashes',
    prompts: [
      'Android Storage Full? Free Space Without Deleting Important Photos',
      'Clear Cache vs. Clear Storage on Android: Which Should You Use?',
      'App Keeps Crashing on Android? Fix It in the Right Order',
      'How to Force Stop an Android App—and When You Shouldn’t',
      'How to Find and Remove Unused Apps on Android',
      'Android Phone Keeps Restarting or Freezing? Check These First',
    ],
  },
  {
    n: '05',
    name: 'Wi-Fi, Bluetooth & Connections',
    label: 'Networks, pairing, hotspot',
    prompts: [
      'Android Connected to Wi‑Fi but No Internet? Fix It Step by Step',
      'Wi‑Fi Keeps Disconnecting on Android? Reset the Right Settings',
      'How to Share Your Wi‑Fi Password with a QR Code on Android',
      'Android Bluetooth Won’t Connect? Fix Pairing Without Guesswork',
      'How to Forget and Re‑Pair a Bluetooth Device on Android',
      'How to Turn Your Android Phone into a Wi‑Fi Hotspot',
    ],
  },
  {
    n: '06',
    name: 'Accessibility & Everyday Settings',
    label: 'Text size, alarms, volume, profiles',
    prompts: [
      'How to Make Text Bigger on Android Without Breaking the Layout',
      'How to Turn On Screen Magnification on Android',
      'Android Alarm Didn’t Go Off? Check These Settings',
      'How to Change Alarm, Ring, Media, and Notification Volume Separately',
      'How to Pause Your Android Work Profile After Hours',
      'How to Change Your Default Browser on Android',
    ],
  },
];

/** Every guide prompt, in site order. */
export const ANDROID_GUIDE_PROMPTS: string[] = ANDROID_GUIDE_CLUSTERS.flatMap(
  (cluster) => cluster.prompts,
);

/**
 * One prompt per cluster, for surfaces that can only show a handful — the
 * chat's opening chips. Taking the first of each keeps all six topics
 * represented instead of six variations on notifications.
 */
export const ANDROID_GUIDE_LEAD_PROMPTS: string[] =
  ANDROID_GUIDE_CLUSTERS.map((cluster) => cluster.prompts[0]!);
