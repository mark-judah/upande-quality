import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Battery from 'expo-battery';
import * as Application from 'expo-application';
import * as Network from 'expo-network';
import * as Cellular from 'expo-cellular';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { Paths } from 'expo-file-system';

export type TelemetryPayload = {
  device_id: string;
  device_name: string;
  model: string;
  brand: string;
  os: string;
  os_version: string;
  app_name: string;
  app_version: string;
  build: string;
  ota_update_id: string;
  ota_channel: string;
  ota_created_at: string;
  is_embedded: boolean;
  battery_level: number;
  battery_state: string;
  network_type: string;
  is_connected: boolean;
  is_internet_reachable: boolean;
  cellular_generation: string;
  /** Internal storage in bytes. -1 when the platform can't report it. */
  storage_free: number;
  storage_total: number;
  captured_at: string;
};

/** Read internal disk free/total in bytes. `Paths.*DiskSpace` are synchronous
 *  getters on SDK 54's file-system API; the legacy async variants now throw at
 *  runtime. Guard each independently — a throw yields -1, matching the battery
 *  / network fail-safe convention. */
function diskSpace(): { free: number; total: number } {
  let free = -1;
  let total = -1;
  try { free = Paths.availableDiskSpace; } catch {}
  try { total = Paths.totalDiskSpace; } catch {}
  return { free, total };
}

async function deviceId(): Promise<string> {
  try {
    if (Platform.OS === 'android') return Application.getAndroidId() ?? '';
    const v = await Application.getIosIdForVendorAsync();
    return v ?? '';
  } catch {
    return '';
  }
}

const NET: Record<string, string> = {
  [Network.NetworkStateType.WIFI]: 'wifi',
  [Network.NetworkStateType.CELLULAR]: 'cellular',
  [Network.NetworkStateType.NONE]: 'none',
};
const GEN: Record<number, string> = {
  [Cellular.CellularGeneration.CELLULAR_2G]: '2g',
  [Cellular.CellularGeneration.CELLULAR_3G]: '3g',
  [Cellular.CellularGeneration.CELLULAR_4G]: '4g',
  [Cellular.CellularGeneration.CELLULAR_5G]: '5g',
};
const BATT: Record<number, string> = {
  [Battery.BatteryState.UNPLUGGED]: 'unplugged',
  [Battery.BatteryState.CHARGING]: 'charging',
  [Battery.BatteryState.FULL]: 'full',
};

export async function collectTelemetry(): Promise<TelemetryPayload> {
  const [id, level, state, net, gen] = await Promise.all([
    deviceId(),
    Battery.getBatteryLevelAsync().catch(() => -1),
    Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN),
    Network.getNetworkStateAsync().catch(() => ({}) as Network.NetworkState),
    Cellular.getCellularGenerationAsync().catch(() => Cellular.CellularGeneration.UNKNOWN),
  ]);
  const netState = net as Network.NetworkState;
  const disk = diskSpace();
  return {
    device_id: id,
    device_name: Device.deviceName ?? '',
    model: Device.modelName ?? '',
    brand: Device.brand ?? '',
    os: Platform.OS,
    os_version: String(Device.osVersion ?? Platform.Version ?? ''),
    // Match what the app UI shows (Constants.expoConfig.version); nativeApplicationVersion
    // returns the host app (e.g. Expo Go / SDK) version in some builds.
    app_name: Application.applicationName ?? Constants.expoConfig?.name ?? '',
    app_version: Constants.expoConfig?.version ?? Application.nativeApplicationVersion ?? '',
    build: Application.nativeBuildVersion ?? '',
    ota_update_id: Updates.updateId ?? '',
    ota_channel: (Updates.channel as string) ?? '',
    ota_created_at: Updates.createdAt ? Updates.createdAt.toISOString() : '',
    is_embedded: Updates.isEmbeddedLaunch ?? false,
    battery_level: typeof level === 'number' ? level : -1,
    battery_state: BATT[state] ?? 'unknown',
    network_type: NET[netState.type ?? ''] ?? 'unknown',
    is_connected: !!netState.isConnected,
    is_internet_reachable: netState.isInternetReachable !== false,
    cellular_generation: GEN[gen] ?? 'unknown',
    storage_free: disk.free,
    storage_total: disk.total,
    captured_at: new Date().toISOString(),
  };
}
