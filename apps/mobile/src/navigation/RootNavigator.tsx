import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { LoginScreen } from '../screens/LoginScreen';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ChatThreadScreen } from '../screens/ChatThreadScreen';
import { theme } from '../theme';

export type RootStackParamList = {
  Login: undefined;
  ChatList: undefined;
  ChatThread: { contactId: string; title: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.panel },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="ChatList" component={ChatListScreen} options={{ headerShown: false }} />
          <Stack.Screen
            name="ChatThread"
            component={ChatThreadScreen}
            options={({ route }) => ({ title: route.params.title })}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
