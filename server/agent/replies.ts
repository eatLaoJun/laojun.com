import type { computeLayoutMetrics } from "../../src/room/core/layout-engine.ts";

type LayoutMetrics = ReturnType<typeof computeLayoutMetrics>;

const conflictLabels: Record<LayoutMetrics["conflicts"][number]["reason"], string> = {
	door: "挡住入户门的开启空间",
	passage: "占用入户过道",
	overlap: "与其他家具重叠",
};

export function formatLayoutInspection(metrics: Pick<LayoutMetrics, "itemCount" | "occupancyPercent" | "conflictCount" | "conflicts">): string {
	return [
		metrics.conflictCount === 0 ? "**未发现布局冲突。**" : `**发现 ${metrics.conflictCount} 处布局冲突。**`,
		"",
		`- **家具数量**：${metrics.itemCount} 件`,
		`- **地面占地率**：约 ${metrics.occupancyPercent}%`,
		...(metrics.conflicts.length ? [
			"",
			"### 冲突明细",
			"",
			...metrics.conflicts.map(({ label, reason }) => `- **${label}**：${conflictLabels[reason]}。`),
		] : []),
	].join("\n");
}
