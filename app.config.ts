import { ExpoConfig, ConfigContext } from 'expo/config';

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name || "trekipelago",
  slug: config.slug || "trekipelago",
  android: {
    ...config.android,
    predictiveBackGestureEnabled: false,
    permissions: [...(config.android?.permissions ?? []), 'android.permission.POST_NOTIFICATIONS'],
  },
  plugins: [
    ['expo-location', {
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true,
      androidForegroundServiceIcon: './assets/android-icon-monochrome.png',
    }],
    'expo-font',
    'expo-image',
    'expo-sqlite',
    ...(googleMapsApiKey ? [['react-native-maps', { androidGoogleMapsApiKey: googleMapsApiKey }] as [string, any]] : []),
  ],
});
