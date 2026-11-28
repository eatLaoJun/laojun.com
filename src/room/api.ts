import type { LayoutStyle, LayoutVariant, RoomDraft, RoomItem, RoomSpec } from "./core/model";

export type RoomRecordDTO = {
	id: string;
	name: string;
	spec: RoomSpec;
	items: RoomItem[];
	createdAt: number;
	updatedAt: number;
};

export type StudioSnapshotDTO = {
	rooms: RoomRecordDTO[];
	activeRoom: RoomRecordDTO;
	variants: LayoutVariant[];
	draft: RoomDraft | null;
};

export type ChatMessageDTO = {
	role: "user" | "assistant";
	text: string;
	timestamp: number;
};

export type AgentSSEEvent =
	| { type: "status"; phase: "thinking" | "tooling" | "answering"; message: string }
	| { type: "thinking_delta"; delta: string }
	| { type: "text_delta"; delta: string }
	| { type: "tool_start"; toolCallId: string; toolName: string; label: string; args?: Record<string, unknown> }
	| { type: "tool_end"; toolCallId: string; toolName: string; label: string; isError: boolean; durationMs: number; summary: string }
	| { type: "draft_updated"; draft: RoomDraft | null }
	| { type: "scene_sync"; snapshot: StudioSnapshotDTO }
	| { type: "done"; reply: string }
	| { type: "error"; message: string };

const SESSION_ID = "public-default";

function getApiBase(): string {
	const configured = (import.meta.env as Record<string, string | undefined>).PUBLIC_STUDIO_API_BASE;
	if (configured) return configured.replace(/\/+$/, "");
	if (typeof window !== "undefined") {
		const { hostname, port } = window.location;
		if ((hostname === "localhost" || hostname === "127.0.0.1") && port !== "8787") {
			return `http://${hostname}:8787`;
		}
	}
	return "";
}

const apiUrl = (path: string): string => `${getApiBase()}${path}`;

export async function fetchStudioState(): Promise<{ snapshot: StudioSnapshotDTO; messages: ChatMessageDTO[] } | null> {
	try {
		const res = await fetch(apiUrl(`/api/rooms?sessionId=${encodeURIComponent(SESSION_ID)}`));
		if (!res.ok) return null;
		return (await res.json()) as { snapshot: StudioSnapshotDTO; messages: ChatMessageDTO[] };
	} catch {
		return null;
	}
}

export async function activateRoomApi(roomId: string): Promise<StudioSnapshotDTO | null> {
	try {
		const res = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/activate?sessionId=${encodeURIComponent(SESSION_ID)}`), {
			method: "POST",
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { snapshot: StudioSnapshotDTO };
		return data.snapshot;
	} catch {
		return null;
	}
}

export async function saveRoomLayoutApi(roomId: string, items: RoomItem[]): Promise<boolean> {
	try {
		const res = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/layout`), {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ items }),
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function saveVariantApi(roomId: string, name: string, items: RoomItem[], style: LayoutStyle | "custom" = "custom"): Promise<LayoutVariant[] | null> {
	try {
		const res = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/variants`), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, items, style }),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { variants: LayoutVariant[] };
		return data.variants;
	} catch {
		return null;
	}
}

export async function applyVariantApi(roomId: string, variantId: string): Promise<StudioSnapshotDTO | null> {
	try {
		const res = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/variants/${encodeURIComponent(variantId)}/apply?sessionId=${encodeURIComponent(SESSION_ID)}`), {
			method: "POST",
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { snapshot: StudioSnapshotDTO };
		return data.snapshot;
	} catch {
		return null;
	}
}

export async function deleteVariantApi(roomId: string, variantId: string): Promise<LayoutVariant[] | null> {
	try {
		const res = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/variants/${encodeURIComponent(variantId)}`), {
			method: "DELETE",
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { variants: LayoutVariant[] };
		return data.variants;
	} catch {
		return null;
	}
}

export async function confirmDraftApi(): Promise<StudioSnapshotDTO> {
	const res = await fetch(apiUrl("/api/agent/draft/confirm"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ sessionId: SESSION_ID, populateStarterFurniture: true }),
	});
	const data = (await res.json()) as { snapshot?: StudioSnapshotDTO; error?: string };
	if (!res.ok || !data.snapshot) {
		throw new Error(data.error || "确认创建房间失败。");
	}
	return data.snapshot;
}

export async function cancelDraftApi(): Promise<void> {
	await fetch(apiUrl(`/api/agent/draft?sessionId=${encodeURIComponent(SESSION_ID)}`), { method: "DELETE" });
}

export async function clearChatApi(): Promise<void> {
	await fetch(apiUrl(`/api/agent/messages?sessionId=${encodeURIComponent(SESSION_ID)}`), { method: "DELETE" });
}

export async function streamAgentChat(
	roomId: string,
	message: string,
	onEvent: (event: AgentSSEEvent) => void,
	signal?: AbortSignal,
): Promise<void> {
	const res = await fetch(apiUrl("/api/agent/chat"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ sessionId: SESSION_ID, roomId, message }),
		signal,
	});
	if (!res.ok || !res.body) {
		throw new Error(`后端 Agent 服务未连接（HTTP ${res.status}），请确认已运行 pnpm dev:server。`);
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const dispatchBlock = (block: string): void => {
		const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
		if (!dataLine) return;
		const raw = dataLine.slice(5).trim();
		if (!raw) return;
		try {
			onEvent(JSON.parse(raw) as AgentSSEEvent);
		} catch {
			// Ignore malformed chunks
		}
	};

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
		const blocks = buffer.split("\n\n");
		buffer = blocks.pop() ?? "";
		for (const block of blocks) {
			dispatchBlock(block);
		}
	}
	buffer += decoder.decode().replaceAll("\r\n", "\n");
	if (buffer.trim()) {
		for (const block of buffer.split("\n\n")) {
			dispatchBlock(block);
		}
	}
}
