const app = require('./app.json');

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY;

module.exports = {
  ...app,
  expo: {
    ...app.expo,
    android: {
      ...app.expo.android,
    },
    plugins: googleMapsApiKey
      ? [['react-native-maps', { androidGoogleMapsApiKey: googleMapsApiKey }]]
      : [],
  },
};
