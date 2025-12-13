import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useClientApi, ClientInfo } from '../../api/clientApi';

export default function AdminUserEditScreen({ route, navigation }: any) {
  const { adminUsersApi } = useClientApi();

  const client: ClientInfo | undefined = route.params?.client;
  const user = route.params?.user;

  const [display_name, setDisplayName] = useState(user?.display_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [role, setRole] = useState<'client' | 'admin'>(user?.role === 'admin' ? 'admin' : 'client');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    try {
      if (!user?.id) {
        Alert.alert('Error', 'Missing user id');
        return;
      }
      setSaving(true);

      const body = await adminUsersApi('PATCH', {
        userId: user.id,
        display_name: display_name || null,
        phone: phone || null,
        role,
      });

      if (!body?.ok) throw new Error(body?.error || 'Failed to update user');

      Alert.alert('Saved', 'User updated.');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '800' }}>Edit user</Text>
      <Text style={{ opacity: 0.7 }}>
        Business: <Text style={{ fontWeight: '700' }}>{client?.business_name || '—'}</Text>
      </Text>

      <View style={{ padding: 12, borderWidth: 1, borderRadius: 12 }}>
        <Text style={{ fontWeight: '900' }}>{user?.email}</Text>
        <Text style={{ opacity: 0.7, marginTop: 4 }}>id: {user?.id}</Text>
      </View>

      <Text style={{ fontWeight: '700' }}>Name</Text>
      <TextInput
        value={display_name}
        onChangeText={setDisplayName}
        placeholder="Full name"
        style={{ borderWidth: 1, borderRadius: 12, padding: 12 }}
      />

      <Text style={{ fontWeight: '700' }}>Phone</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="+15195551234"
        keyboardType="phone-pad"
        style={{ borderWidth: 1, borderRadius: 12, padding: 12 }}
      />

      <Text style={{ fontWeight: '700' }}>Role</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={() => setRole('client')}
          style={{
            flex: 1,
            padding: 12,
            borderWidth: 1,
            borderRadius: 12,
            opacity: role === 'client' ? 1 : 0.6,
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '800' }}>Client</Text>
        </Pressable>

        <Pressable
          onPress={() => setRole('admin')}
          style={{
            flex: 1,
            padding: 12,
            borderWidth: 1,
            borderRadius: 12,
            opacity: role === 'admin' ? 1 : 0.6,
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '800' }}>Admin</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={save}
        disabled={saving}
        style={{
          marginTop: 8,
          padding: 14,
          borderRadius: 999,
          backgroundColor: saving ? '#9CA3AF' : '#7C3AED',
          alignItems: 'center',
        }}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900' }}>Save</Text>}
      </Pressable>
    </View>
  );
}

