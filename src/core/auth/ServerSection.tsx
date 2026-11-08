import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/core/ui/Button';
import { Dialog } from '@/src/core/ui/Dialog';
import { Input } from '@/src/core/ui/Input';
import { useToast } from '@/src/core/ui/Toast';
import { useAuthStore } from '@/src/core/auth/store';
import {
  instanceKey,
  instanceLabel,
  knownInstances,
  type KnownInstance,
} from '@/src/core/auth/known-instances';
import { COLORS, borderRadius, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { countUnsent } from '@/src/core/offline/unsent';

/**
 * The server this app signs in to, one at a time. Change signs out here and
 * opens the login screen for the server picked.
 * Scans not sent yet stay with this server (its own database files) and go
 * once signed in to it again; a change with any waiting asks first.
 */
function useServerChange(onDone?: () => void) {
  const currentUrl = useAuthStore((s) => s.instanceUrl);
  const changeServer = useAuthStore((s) => s.changeServer);
  const currentKey = instanceKey(currentUrl);

  const [instances, setInstances] = useState<KnownInstance[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [unsent, setUnsent] = useState(0);

  useEffect(() => {
    knownInstances.list().then(setInstances).catch(() => {});
  }, []);

  const typed = draftUrl.trim().replace(/\/+$/, '');
  const target = typed || picked;
  const canChange = !!target && instanceKey(target) !== currentKey && !busy;

  const rows =
    currentUrl && !instances.some((i) => instanceKey(i.url) === currentKey)
      ? [{ url: currentUrl, email: null, lastUsedAt: 0 } as KnownInstance, ...instances]
      : instances;

  const { showError } = useToast();
  // A ref, not only state: a second tap lands before the re-render that disables the button.
  const running = useRef(false);
  const guarded = async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await task();
    } catch (e) {
      showError(e instanceof Error && e.message ? e.message : "Couldn't change the server");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const switchTo = async (url: string) => {
    await changeServer(url);
    setUnsent(0);
    onDone?.();
    router.replace('/login');
  };

  // "Change anyway", from the unsent-scans warning.
  const apply = () =>
    guarded(async () => {
      if (target) await switchTo(target);
    });

  const change = () =>
    guarded(async () => {
      if (!target || instanceKey(target) === currentKey) return;
      const waiting = await countUnsent();
      if (waiting > 0) {
        setUnsent(waiting);
        return;
      }
      await switchTo(target);
    });

  return {
    rows,
    currentKey,
    selectedKey: typed ? null : picked ? instanceKey(picked) : currentKey,
    pick: (url: string) => {
      setDraftUrl('');
      setPicked(url);
    },
    draftUrl,
    setDraftUrl,
    canChange,
    busy,
    change,
    apply,
    unsent,
    dismissUnsent: () => setUnsent(0),
  };
}

type ServerChange = ReturnType<typeof useServerChange>;

function ServerPicker({ sc }: { sc: ServerChange }) {
  return (
    <View>
      {sc.rows.map((inst) => {
        const key = instanceKey(inst.url);
        const selected = key === sc.selectedKey;
        return (
          <Pressable
            key={inst.url}
            onPress={() => sc.pick(inst.url)}
            style={({ pressed }) => [s.row, selected && s.rowSelected, pressed && { opacity: 0.8 }]}
          >
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={selected ? COLORS.primary : COLORS.textMuted}
            />
            <View style={s.flex}>
              <Text style={s.host} numberOfLines={1}>
                {instanceLabel(inst.url)}
              </Text>
              {inst.fullName || inst.email ? (
                <Text style={s.sub} numberOfLines={1}>
                  {inst.fullName || inst.email}
                </Text>
              ) : null}
            </View>
            {key === sc.currentKey ? <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} /> : null}
          </Pressable>
        );
      })}
      <Input
        value={sc.draftUrl}
        onChangeText={sc.setDraftUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="your-site.upande.com"
        returnKeyType="go"
        onSubmitEditing={sc.change}
      />
    </View>
  );
}

/** "N scans not sent yet": Cancel, or Change anyway. Also used by the login screen. */
export function UnsentScansConfirm({
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  count: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      visible={count > 0}
      onClose={onCancel}
      busy={busy}
      icon={{ name: 'cloud-offline-outline', tone: 'warn' }}
      title={`${count} ${count === 1 ? 'scan' : 'scans'} not sent yet`}
      actions={
        <>
          <Button label="Cancel" variant="outline" onPress={onCancel} disabled={busy} style={s.flex} />
          <Button label="Change" color={COLORS.danger} onPress={onConfirm} loading={busy} style={s.flex} />
        </>
      }
    />
  );
}

/** Only reachable by a long press (2 s) on the user's initials, in Settings or the menu. */
export function ServerDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return visible ? <ServerDialogBody onClose={onClose} /> : null;
}

function ServerDialogBody({ onClose }: { onClose: () => void }) {
  const sc = useServerChange(onClose);
  return (
    <>
      <Dialog
        visible
        onClose={onClose}
        busy={sc.busy}
        icon={{ name: 'server-outline' }}
        title="Server"
        actions={
          <>
            <Button label="Cancel" variant="outline" onPress={onClose} disabled={sc.busy} style={s.flex} />
            <Button label="Change" onPress={sc.change} disabled={!sc.canChange} loading={sc.busy} style={s.flex} />
          </>
        }
      >
        <ServerPicker sc={sc} />
      </Dialog>
      <UnsentScansConfirm count={sc.unsent} busy={sc.busy} onCancel={sc.dismissUnsent} onConfirm={sc.apply} />
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: spacing.sm,
  },
  rowSelected: { borderColor: COLORS.primary },
  host: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  sub: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: 2 },
});
