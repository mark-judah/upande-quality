import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { Button } from '@/src/core/ui/Button';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { formatBytes, RELEASES_PAGE_URL } from './releases';
import { openInBrowser, openUnknownAppSourcesSettings } from './install-apk';
import { useApkUpdate } from './UpdateProvider';

/**
 * The one "Check for updates" button in Settings → App. A new APK is checked
 * first, on GitHub Releases: it carries a new runtime, so it supersedes any OTA
 * bundle. Only when the APK is current does it ask expo-updates for a JS patch
 * on the installed runtime. With an APK available the same button downloads it.
 */
export function ApkUpdateSection() {
  const { check, checking, checkError, downloading, progress, installError, refresh, install } =
    useApkUpdate();
  const apk = check?.apk ?? null;
  const available = !!check?.available;
  const { showSuccess, showError } = useToast();
  const [otaChecking, setOtaChecking] = useState(false);

  const label = useMemo(() => {
    if (downloading) {
      const written = formatBytes(progress?.written) ?? '0.0 MB';
      if (progress?.fraction == null) return `Downloading… ${written}`;
      return `Downloading ${Math.round(progress.fraction * 100)}% · ${written} of ${formatBytes(progress.total)}`;
    }
    if (checking || otaChecking) return 'Checking for updates…';
    if (available && apk) {
      const size = formatBytes(apk.sizeBytes);
      return `Download v${apk.version}${size ? ` (${size})` : ''}`;
    }
    return 'Check for updates';
  }, [downloading, progress, checking, otaChecking, available, apk]);

  /** A JS patch for the runtime this APK already has, through `updates.url`. */
  const checkOta = useCallback(async () => {
    if (__DEV__) {
      showSuccess('This APK is up to date. OTA updates are off in development.');
      return;
    }
    setOtaChecking(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      const fetched = result.isAvailable ? await Updates.fetchUpdateAsync() : null;
      if (!fetched?.isNew) {
        showSuccess("You're on the latest version.");
        return;
      }
      Alert.alert('Update ready', 'Reload now to apply it?', [
        { text: 'Later', style: 'cancel' },
        { text: 'Reload', onPress: () => Updates.reloadAsync() },
      ]);
    } catch (err) {
      // expo-updates wraps the real reason as "Call to function … has been rejected. → Caused by: …".
      const message = err instanceof Error ? err.message : '';
      const cause = message.split('Caused by:').pop()?.trim();
      showError(cause ? `Could not check for updates: ${cause}` : 'Could not check for updates.');
    } finally {
      setOtaChecking(false);
    }
  }, [showSuccess, showError]);

  const onPress = useCallback(async () => {
    if (downloading || checking || otaChecking) return;
    if (available) {
      // Failures surface through `installError` below.
      await install();
      return;
    }
    const result = await refresh();
    // A newer APK turns this button into its download; the status line says so.
    if (result?.available) return;
    await checkOta();
  }, [downloading, checking, otaChecking, available, install, refresh, checkOta]);

  const onInstallErrorHelp = useCallback(() => {
    if (!installError) return;
    const blocked = installError.kind === 'blocked';
    Alert.alert('Update failed', installError.message, [
      { text: 'Close', style: 'cancel' },
      blocked
        ? { text: 'Allow installs', onPress: () => openUnknownAppSourcesSettings().catch(() => {}) }
        : {
            text: 'Open in browser',
            onPress: () => openInBrowser(apk?.downloadUrl ?? RELEASES_PAGE_URL).catch(() => {}),
          },
    ]);
  }, [installError, apk]);

  let status: string | null = null;
  if (check) {
    if (available && apk) status = `v${apk.version} is available as a new APK.`;
    else if (apk) status = `Latest APK is v${apk.version} — this build is up to date.`;
    else status = 'No APK has been published yet.';
  }

  return (
    <View>
      {status ? <Text style={[s.hint, available && s.accent]}>{status}</Text> : null}
      {checkError ? (
        <Text style={s.error}>
          {checkError.message}
          {checkError.kind === 'rate_limited' ? (
            <Text style={s.link} onPress={() => Linking.openURL(RELEASES_PAGE_URL)}>
              {'  '}Open releases
            </Text>
          ) : null}
        </Text>
      ) : null}
      {installError ? (
        <Text style={s.error} onPress={onInstallErrorHelp}>
          {installError.message} <Text style={s.link}>What now?</Text>
        </Text>
      ) : null}
      <View style={{ height: spacing.sm }} />
      <Button
        label={label}
        variant={available || downloading ? 'primary' : 'outline'}
        onPress={onPress}
        loading={checking || otaChecking}
        disabled={downloading}
        iconLeft={available ? 'download-outline' : 'cloud-download-outline'}
      />
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted, marginTop: spacing.sm },
  accent: { fontFamily: fontFamily.semiBold, color: COLORS.primary },
  error: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.danger, marginTop: spacing.sm },
  link: { fontFamily: fontFamily.semiBold, color: COLORS.primary, textDecorationLine: 'underline' },
});
