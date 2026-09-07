import { ExpoConfig, ConfigContext } from 'expo/config';
import { withGradleProperties } from 'expo/config-plugins';

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY;

export default ({ config }: ConfigContext): ExpoConfig => {
  const expoConfig: any = {
    ...config,
    name: config.name || "trekipelago",
    slug: config.slug || "trekipelago",
    splash: {
      backgroundColor: "#0d1703",
    },
    androidNavigationBar: {
      backgroundColor: "#050c02"
    },
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
  };

  // Automatically inject our prefab fix into gradle.properties on every prebuild
  return withGradleProperties(expoConfig, (cfg) => {
    cfg.modResults.push({
      type: 'property',
      key: 'android.prefabVersion',
      value: '2.0.0',
    });
    return cfg;
  });
};
