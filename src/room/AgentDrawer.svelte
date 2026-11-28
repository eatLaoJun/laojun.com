<script lang="ts">
	import { tick } from "svelte";
	import type { RoomDraft } from "./core/model";
	import { renderChatMarkdown } from "./chat-markdown";
	import {
		cancelDraftApi,
		clearChatApi,
		confirmDraftApi,
		streamAgentChat,
		type ChatMessageDTO,
		type StudioSnapshotDTO,
	} from "./api";

	type ToolReceipt = {
		id: string;
		name: string;
		label: string;
		args?: Record<string, unknown>;
		done: boolean;
		isError?: boolean;
		durationMs?: number;
		summary?: string;
	};

	type TurnTrace = {
		thinking: string;
		tools: ToolReceipt[];
	};

	let {
		roomId,
		draft,
		messages = $bindable<ChatMessageDTO[]>([]),
		onDraftUpdated,
		onSceneSync,
		onNotice,
	}: {
		roomId: string;
		draft: RoomDraft | null;
		messages: ChatMessageDTO[];
		onDraftUpdated: (draft: RoomDraft | null) => void;
		onSceneSync: (snapshot: StudioSnapshotDTO) => void;
		onNotice: (text: string) => void;
	} = $props();

	let open = $state(false);
	let input = $state("");
	let busy = $state(false);
	let statusText = $state("");
	let streamingThinking = $state("");
	let streamingText = $state("");
	let pendingReplyAt = $state<number | null>(null);
	let receipts = $state<ToolReceipt[]>([]);
	let traceByTimestamp = $state<Record<number, TurnTrace>>({});
	let errorText = $state("");
	let scrollContainer: HTMLDivElement | undefined;
	let abortController: AbortController | undefined;

	const expanded = $derived(open || Boolean(draft));
	const visibleMessages = $derived(
		pendingReplyAt === null
			? messages
			: [...messages, { role: "assistant" as const, text: streamingText, timestamp: pendingReplyAt }],
	);

	const suggestions = [
		{ tag: "建房", text: "帮我新建一个 5 米宽、4 米深、带卫生间的卧室" },
		{ tag: "摆位", text: "把书桌挪到窗户下面" },
		{ tag: "方案", text: "按居家办公优先重新布置并和当前方案对比" },
		{ tag: "体检", text: "检查一下当前布局有没有冲突" },
	];

	const wallLabel: Record<string, string> = {
		north: "北墙",
		south: "南墙",
		east: "东墙",
		west: "西墙",
	};

	async function scrollToBottom(): Promise<void> {
		await tick();
		if (scrollContainer) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
	}

	async function send(promptText?: string): Promise<void> {
		const text = (promptText ?? input).trim();
		if (!text || busy) return;
		open = true;
		input = "";
		errorText = "";
		busy = true;
		statusText = "正在连接模型…";
		streamingThinking = "";
		streamingText = "";
		receipts = [];
		const sentAt = Math.max(Date.now(), (messages.at(-1)?.timestamp ?? 0) + 1);
		const replyAt = sentAt + 1;
		pendingReplyAt = replyAt;
		messages = [...messages, { role: "user", text, timestamp: sentAt }];
		void scrollToBottom();

		let finalReply = "";
		let stopped = false;
		abortController = new AbortController();
		try {
			await streamAgentChat(
				roomId,
				text,
				(ev) => {
					if (ev.type === "status") {
						statusText = ev.message;
					} else if (ev.type === "thinking_delta") {
						streamingThinking += ev.delta;
					} else if (ev.type === "text_delta") {
						streamingText += ev.delta;
					} else if (ev.type === "tool_start") {
						receipts = [
							...receipts,
							{ id: ev.toolCallId, name: ev.toolName, label: ev.label, args: ev.args, done: false },
						];
					} else if (ev.type === "tool_end") {
						receipts = receipts.map((r) =>
							r.id === ev.toolCallId
								? { ...r, done: true, isError: ev.isError, durationMs: ev.durationMs, summary: ev.summary }
								: r,
						);
					} else if (ev.type === "draft_updated") {
						onDraftUpdated(ev.draft);
					} else if (ev.type === "scene_sync") {
						onSceneSync(ev.snapshot);
					} else if (ev.type === "error") {
						errorText = ev.message;
					} else if (ev.type === "done") {
						finalReply = ev.reply;
					}
					void scrollToBottom();
				},
				abortController.signal,
			);
		} catch (err) {
			if ((err as Error).name !== "AbortError") {
				errorText = err instanceof Error ? err.message : String(err);
			} else {
				stopped = true;
			}
		} finally {
			const reply = finalReply?.trim() ? finalReply : streamingText;
			const hasTrace = Boolean(streamingThinking || receipts.length);
			if (hasTrace) {
				traceByTimestamp = {
					...traceByTimestamp,
					[replyAt]: { thinking: streamingThinking, tools: [...receipts] },
				};
			}
			// Keep the same keyed row when a live reply becomes a transcript entry.
			if (reply.trim() || hasTrace) {
				messages = [...messages, { role: "assistant", text: reply, timestamp: replyAt }];
			} else if (!stopped && !errorText) {
				errorText = "这次没有收到回复，请重试。";
			}
			pendingReplyAt = null;
			streamingThinking = "";
			streamingText = "";
			receipts = [];
			statusText = "";
			busy = false;
			abortController = undefined;
			void scrollToBottom();
		}
	}

	function stopGeneration(): void {
		abortController?.abort();
	}

	async function handleConfirmDraft(): Promise<void> {
		if (busy || !draft?.valid) return;
		busy = true;
		statusText = "正在创建房间…";
		errorText = "";
		try {
			const snap = await confirmDraftApi();
			onDraftUpdated(null);
			onSceneSync(snap);
			messages = [
				...messages,
				{
					role: "assistant",
					text: `已正式创建新房间 **「${snap.activeRoom.name}」**（${(snap.activeRoom.spec.width / 100).toFixed(2)} × ${(snap.activeRoom.spec.depth / 100).toFixed(2)} m），并切换至新房间视图。`,
					timestamp: Date.now(),
				},
			];
			onNotice(`已创建房间「${snap.activeRoom.name}」`);
			void scrollToBottom();
		} catch (err) {
			errorText = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
			statusText = "";
		}
	}

	async function handleCancelDraft(): Promise<void> {
		try {
			await cancelDraftApi();
			onDraftUpdated(null);
			onNotice("已取消建房草稿。");
		} catch {
			onDraftUpdated(null);
		}
	}

	async function handleClearChat(): Promise<void> {
		await clearChatApi().catch(() => {});
		messages = [];
		receipts = [];
		traceByTimestamp = {};
		streamingThinking = "";
		streamingText = "";
		errorText = "";
	}
</script>

{#snippet toolList(list: ToolReceipt[])}
	<div class="tool-timeline">
		{#each list as r (r.id)}
			<details class="tool-step" class:running={!r.done} class:error={r.isError}>
				<summary>
					<span class="step-icon" aria-hidden="true">
						{#if !r.done}
							<span class="mini-spinner"></span>
						{:else if r.isError}
							<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4.5 4.5l7 7m0-7-7 7" /></svg>
						{:else}
							<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3.5 8.5 6.5 11.5 12.5 5" /></svg>
						{/if}
					</span>
					<span class="step-label">{r.label}</span>
					<code class="step-code">{r.name}</code>
					{#if r.durationMs !== undefined}
						<span class="step-time">{r.durationMs}ms</span>
					{/if}
					<svg class="step-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
				</summary>
				<div class="step-detail">
					{#if r.args && Object.keys(r.args).length > 0}
						<div class="step-kv"><span>INPUT</span><code>{JSON.stringify(r.args)}</code></div>
					{/if}
					{#if r.summary}
						<div class="step-kv"><span>OUTPUT</span><code>{r.summary}</code></div>
					{/if}
				</div>
			</details>
		{/each}
	</div>
{/snippet}

<div class="agent-dock" class:is-expanded={expanded}>
	{#if !expanded}
		<div class="floating-chips" aria-label="快捷指令">
			{#each suggestions as s}
				<button type="button" class="quick-pill" disabled={busy} onclick={() => send(s.text)}>
					<span class="quick-tag">{s.tag}</span>
					<span class="quick-text">{s.text}</span>
				</button>
			{/each}
		</div>
	{/if}

	<section class="agent-shell glass" class:expanded aria-label="PiAgent 空间助手">
		{#if expanded}
			<header class="shell-header">
				<div class="shell-brand">
					<span class="agent-orb" class:pulsing={busy} aria-hidden="true"></span>
					<span class="shell-title">PiAgent</span>
					<span class="shell-sub">空间设计助手</span>
					{#if busy && statusText}
						<span class="shell-status">
							<span class="mini-spinner"></span>
							{statusText}
						</span>
					{/if}
				</div>
				<div class="shell-controls">
					{#if messages.length > 0 && !busy}
						<button type="button" class="shell-icon-text" onclick={handleClearChat} title="清空对话记录">清空</button>
					{/if}
					<button type="button" class="shell-close" onclick={() => { open = false; }} aria-label="收起对话窗口" title="收起">
						<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
					</button>
				</div>
			</header>

			{#if draft}
				<div class="draft-sheet" role="region" aria-label="房间需求梳理卡片">
					<div class="draft-sheet-top">
						<div class="draft-sheet-title">
							<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M3 10h6v6M11 4v4h6" /></svg>
							<strong>需求梳理草稿 · {draft.input.name || "新建房间"}</strong>
						</div>
						<span class="draft-pill" class:invalid={!draft.valid}>{draft.valid ? "校验通过" : "待修正"}</span>
					</div>
					{#if draft.spec}
						<div class="draft-tiles">
							<div class="draft-tile"><span>外框尺寸</span><b>{(draft.spec.width / 100).toFixed(2)} × {(draft.spec.depth / 100).toFixed(2)}m</b></div>
							<div class="draft-tile"><span>入户门</span><b>{wallLabel[draft.spec.door.side]} · {(draft.spec.door.width / 100).toFixed(2)}m</b></div>
							<div class="draft-tile"><span>采光窗</span><b>{wallLabel[draft.spec.window.side]} · {(draft.spec.window.width / 100).toFixed(2)}m</b></div>
							<div class="draft-tile"><span>卫生间</span><b>{draft.spec.bathroom ? `${(draft.spec.bathroom.width / 100).toFixed(2)}×${(draft.spec.bathroom.depth / 100).toFixed(2)}m` : "无"}</b></div>
						</div>
					{/if}
					{#if draft.missingFields.length > 0 || draft.assumedFields.length > 0}
						<div class="draft-notes">
							{#if draft.missingFields.length > 0}
								<span class="note-tag warn">待补充：{draft.missingFields.join("、")}</span>
							{/if}
							{#if draft.assumedFields.length > 0}
								<span class="note-tag">暂定：{draft.assumedFields.join(" · ")}</span>
							{/if}
						</div>
					{/if}
					{#if draft.errors.length > 0}
						<p class="draft-error">{draft.errors.join("；")}</p>
					{/if}
					<div class="draft-footer">
						<button type="button" class="draft-btn-primary" disabled={!draft.valid || busy} onclick={handleConfirmDraft}>
							确认创建新房间
						</button>
						<button type="button" class="draft-btn-ghost" disabled={busy} onclick={handleCancelDraft}>
							取消
						</button>
					</div>
				</div>
			{/if}

			<div bind:this={scrollContainer} class="shell-stream panel-scroll">
				{#if messages.length === 0 && !busy}
					<div class="empty-state">
						<p class="empty-lead">说说你想怎么规划这个空间</p>
						<div class="empty-grid">
							{#each suggestions as s}
								<button type="button" class="empty-card" onclick={() => send(s.text)}>
									<span class="quick-tag">{s.tag}</span>
									<span>{s.text}</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#each visibleMessages as msg (msg.timestamp + msg.role)}
					{#if msg.role === "user"}
						<div class="msg-row user">
							<div class="msg-user-pill">{msg.text}</div>
						</div>
					{:else}
						{@const live = msg.timestamp === pendingReplyAt}
						{@const trace = live ? { thinking: streamingThinking, tools: receipts } : traceByTimestamp[msg.timestamp]}
						<div class="msg-row assistant" class:live>
							<span class="msg-avatar" class:pulsing={live} aria-hidden="true"></span>
							<div class="msg-assistant-body">
								{#if trace?.thinking}
									<details class="thinking-card" class:active={live} open={live}>
										<summary>
											{#if live}
												<span class="mini-spinner"></span>
											{:else}
												<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /><path d="M8 5.2v3l2 1.2" /></svg>
											{/if}
											<span>{live ? "正在思考…" : "思考过程"}</span>
											<span class="thinking-count">{trace.thinking.length} 字</span>
											<svg class="step-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
										</summary>
										<div class="thinking-content">{trace.thinking}</div>
									</details>
								{:else if live && !trace?.tools.length && !msg.text}
									<div class="thinking-placeholder">
										<span class="mini-spinner"></span>
										<span>{statusText || "正在分析需求…"}</span>
									</div>
								{/if}
								{#if trace && trace.tools.length > 0}
									{@render toolList(trace.tools)}
								{/if}
								{#if msg.text.trim()}
									<div class="msg-prose" class:streaming={live}>{@html renderChatMarkdown(msg.text)}</div>
								{:else if !live}
									<p class="msg-prose">这次没有收到最终回复。</p>
								{/if}
							</div>
						</div>
					{/if}
				{/each}

				{#if errorText}
					<div class="stream-error" role="alert">{errorText}</div>
				{/if}
			</div>
		{/if}

		<!-- Unified Composer Footer -->
		<form class="composer" onsubmit={(e) => { e.preventDefault(); void send(); }}>
			<button
				type="button"
				class="composer-orb-btn"
				title={expanded ? "收起对话面板" : "展开 PiAgent 对话面板"}
				aria-label={expanded ? "收起对话面板" : "展开 PiAgent 对话面板"}
				onclick={() => { open = !open; }}
			>
				<span class="agent-orb" class:pulsing={busy} aria-hidden="true"></span>
			</button>
			<input
				type="text"
				bind:value={input}
				placeholder="问问 PiAgent：新建房间、语义摆家具、生成对比方案…"
				disabled={busy}
				onfocus={() => { if (messages.length > 0) open = true; }}
			/>
			{#if busy}
				<button type="button" class="composer-stop" onclick={stopGeneration} title="停止生成">
					<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>
					<span>停止</span>
				</button>
			{:else}
				<button type="submit" class="composer-send" disabled={!input.trim()} aria-label="发送">
					<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 15V5m0 0-4.5 4.5M10 5l4.5 4.5" /></svg>
				</button>
			{/if}
		</form>
	</section>
</div>
