import { useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Audio } from 'expo-av';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api, type Message } from '../lib/api';
import { theme } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatThread'>;

export function ChatThreadScreen({ route, navigation }: Props) {
  const { contactId } = route.params;
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const recording = useRef<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', contactId],
    queryFn: () => api.listMessages(contactId),
    refetchInterval: 8000,
  });
  const { data: snippets = [] } = useQuery({
    queryKey: ['snippets'],
    queryFn: api.listSnippets,
  });

  const send = useMutation({
    mutationFn: (body: string) => api.sendText(contactId, body),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['messages', contactId] });
    },
    onError: (e: Error) => Alert.alert('Could not send', e.message),
  });

  const startRecording = useCallback(async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Microphone needed', 'Allow mic access to record voice notes.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recording.current = rec;
      setIsRecording(true);
    } catch (e) {
      Alert.alert('Recording failed', String(e));
    }
  }, []);

  const stopAndSend = useCallback(async () => {
    const rec = recording.current;
    if (!rec) return;
    setIsRecording(false);
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recording.current = null;
      if (!uri) return;
      await api.sendVoice(contactId, uri);
      qc.invalidateQueries({ queryKey: ['messages', contactId] });
    } catch (e) {
      Alert.alert('Voice send failed', String(e));
    }
  }, [contactId, qc]);

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        // Backend returns chronological (oldest→newest). An inverted list
        // renders index 0 at the bottom, so feed it newest-first.
        data={[...messages].reverse()}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }: { item: Message }) => <Bubble m={item} />}
      />

      <View style={styles.composer}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setSnippetsOpen(true)}>
          <Text style={styles.icon}>⚡</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Message"
          placeholderTextColor={theme.textFaint}
          value={text}
          onChangeText={setText}
          multiline
        />
        {text.trim() ? (
          <TouchableOpacity style={styles.sendBtn} onPress={() => send.mutate(text.trim())} disabled={send.isPending}>
            {send.isPending ? <ActivityIndicator color="#0a1612" /> : <Text style={styles.sendText}>Send</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, isRecording && styles.recording]}
            onPressIn={startRecording}
            onPressOut={stopAndSend}
          >
            <Text style={styles.sendText}>{isRecording ? '● Rec' : '🎤'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={snippetsOpen} animationType="slide" transparent onRequestClose={() => setSnippetsOpen(false)}>
        <TouchableOpacity style={styles.modalBg} activeOpacity={1} onPress={() => setSnippetsOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Quick replies</Text>
            <FlatList
              data={snippets}
              keyExtractor={(s) => s.id}
              ListEmptyComponent={<Text style={styles.empty}>No snippets yet</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.snippetRow}
                  onPress={() => { setText((t) => (t ? t + ' ' : '') + item.body); setSnippetsOpen(false); }}
                >
                  <Text style={styles.snippetLabel}>/{item.slug} · {item.label}</Text>
                  <Text style={styles.snippetBody} numberOfLines={2}>{item.body}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Bubble({ m }: { m: Message }) {
  const out = m.direction === 'out';
  return (
    <View style={[styles.bubbleRow, { justifyContent: out ? 'flex-end' : 'flex-start' }]}>
      <View style={[styles.bubble, { backgroundColor: out ? theme.outBubble : theme.inBubble }]}>
        {m.file_id ? (
          <Text style={styles.bubbleText}>
            {m.msg_type === 'audio' ? '🎤 Voice note' : `📎 ${m.file_name ?? m.msg_type}`}
          </Text>
        ) : (
          <Text style={styles.bubbleText}>{m.body ?? (m.template_name ? `[template: ${m.template_name}]` : '')}</Text>
        )}
        <Text style={styles.bubbleMeta}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{out ? ` · ${m.status}` : ''}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleText: { color: theme.text, fontSize: 15 },
  bubbleMeta: { color: theme.textFaint, fontSize: 11, marginTop: 4, alignSelf: 'flex-end' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, borderTopColor: theme.border, borderTopWidth: 1, gap: 8 },
  iconBtn: { padding: 8 },
  icon: { fontSize: 20 },
  input: {
    flex: 1, backgroundColor: theme.panel2, borderColor: theme.border, borderWidth: 1, borderRadius: 18,
    color: theme.text, paddingHorizontal: 14, paddingVertical: 8, maxHeight: 120, fontSize: 15,
  },
  sendBtn: { backgroundColor: theme.accent, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  recording: { backgroundColor: theme.danger },
  sendText: { color: '#0a1612', fontWeight: '700' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.panel, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '60%' },
  sheetTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  snippetRow: { paddingVertical: 10, borderBottomColor: theme.border, borderBottomWidth: 1 },
  snippetLabel: { color: theme.accent, fontWeight: '600' },
  snippetBody: { color: theme.textDim, marginTop: 2 },
  empty: { color: theme.textDim, textAlign: 'center', padding: 20 },
});
