import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Dialog } from '@/src/core/ui/Dialog';
import { Button } from '@/src/core/ui/Button';
import { Input } from '@/src/core/ui/Input';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { changePassword } from './password-api';

/** Settings → Security → Change password: current password, new one twice. The
 *  server checks the current password and its password policy. */
export function ChangePasswordDialog({
  visible,
  onClose,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!current || !next) {
      setError('Fill in your current and new password.');
      return;
    }
    if (next !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    if (next === current) {
      setError('The new password must be different from the current one.');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await changePassword(current, next);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    onChanged();
  };

  return (
    <Dialog
      visible={visible}
      onClose={close}
      busy={busy}
      align="left"
      icon={{ name: 'key-outline', tone: 'info' }}
      title="Change password"
      subtitle="Use your current password to set a new one."
      actions={
        <>
          <Button label="Cancel" variant="outline" onPress={close} disabled={busy} style={{ flex: 1 }} />
          <Button label="Change" onPress={submit} loading={busy} style={{ flex: 1 }} />
        </>
      }
    >
      <View style={s.form}>
        <Input
          label="Current password"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
        />
        <Input
          label="New password"
          value={next}
          onChangeText={setNext}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
        />
        <Input
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {error ? <Text style={s.error}>{error}</Text> : null}
      </View>
    </Dialog>
  );
}

const s = StyleSheet.create({
  form: { alignSelf: 'stretch', marginTop: spacing.sm },
  error: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.danger },
});
