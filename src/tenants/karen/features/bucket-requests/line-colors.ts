import type { OplSchedule } from '@/src/tenants/karen/repository/karen-bucket-requests-repository';

/** One colour per packing line (schedule team): every picklist on the same line
 *  carries the same colour. Teams are coloured in name order, so the same schedule
 *  gives the same colours on every device. */
export const LINE_COLORS = ['#2E90FA', '#F79009', '#12B76A', '#9E77ED', '#EE46BC', '#06AED4', '#F04438', '#669F2A', '#6172F3', '#DD2590'];
export type LineColor = { team: string; color: string };

export function lineColors(schedules: OplSchedule[]): { byOpl: Record<string, LineColor>; lines: LineColor[] } {
  const teams = [...new Set(schedules.filter((sc) => sc.team).map((sc) => sc.team))].sort();
  const lines = teams.map((team, i) => ({ team, color: LINE_COLORS[i % LINE_COLORS.length] }));
  const color = new Map(lines.map((l) => [l.team, l]));
  const byOpl: Record<string, LineColor> = {};
  for (const sc of schedules) {
    const l = sc.team ? color.get(sc.team) : undefined;
    if (l) byOpl[sc.oplName] = l;
  }
  return { byOpl, lines };
}
