import { useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api, type Contact } from '../lib/api';
import { useAuth } from '../lib/auth';
import { theme } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatList'>;

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('') || '?';
}

export function ChatListScreen({ navigation }: Props) {
  const { signOut, user } = useAuth();
  const [search, setSearch] = useState('');

  const { data: contacts = [], refetch, isRefetching } = useQuery({
    queryKey: ['contacts', search],
    queryFn: () => api.listContacts(search || undefined),
    refetchInterval: 15000,
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Inbox</Text>
          <Text style={styles.brandSub}>{user?.name} · {user?.role}</Text>
        </View>
        <TouchableOpacity onPress={signOut}><Text style={styles.signout}>Sign out</Text></TouchableOpacity>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Search name or lead"
        placeholderTextColor={theme.textFaint}
        value={search}
        onChangeText={setSearch}
      />

      <FlatList
        data={contacts}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.textDim} />}
        ListEmptyComponent={<Text style={styles.empty}>No conversations yet</Text>}
        renderItem={({ item }: { item: Contact }) => {
          const name = item.display_name || item.profile_name || item.phone_e164;
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('ChatThread', { contactId: item.id, title: name })}
            >
              <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name)}</Text></View>
              <View style={styles.rowMid}>
                <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{item.phone_e164}</Text>
              </View>
              {item.unread_count > 0 && (
                <View style={styles.badge}><Text style={styles.badgeText}>{item.unread_count}</Text></View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 8 },
  brand: { color: theme.text, fontSize: 22, fontWeight: '700' },
  brandSub: { color: theme.textDim, fontSize: 12 },
  signout: { color: theme.accent },
  search: {
    backgroundColor: theme.panel2, borderColor: theme.border, borderWidth: 1, borderRadius: 8,
    color: theme.text, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.panel3, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { color: theme.text, fontWeight: '600' },
  rowMid: { flex: 1 },
  rowName: { color: theme.text, fontSize: 16, fontWeight: '500' },
  rowSub: { color: theme.textDim, fontSize: 13, marginTop: 2 },
  badge: { backgroundColor: theme.accent, borderRadius: 11, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#0a1612', fontWeight: '700', fontSize: 12 },
  empty: { color: theme.textDim, textAlign: 'center', marginTop: 60 },
});
